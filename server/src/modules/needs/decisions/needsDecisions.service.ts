import { Prisma } from '@prisma/client';
import {
  NEEDS_SEPARATION_ERROR_MESSAGES,
  STAGE_DECISION_OUTCOMES,
  hasSupervisionLine,
  nextStage,
  proposalStatusLabel,
  returnTarget,
  stageConfigOf,
  type NeedsCycleDocumentDto,
  type NeedsDecisionResultDto,
  type NeedsPipelineConfig,
  type NeedsProposalStatus,
  type NeedsStage,
  type ProposalBatchActionRequest,
  type StageDecisionRequest,
  type StageOutcome,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { loadWritableCycle, PROPOSAL_NOT_FOUND, webActor, type CycleRow } from '../needsAccess';
import { cycleConfig, dec, parsedOf } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { generateStageReport, type StageReportKind } from '../reports/needsReports.service';
import { emailReturned, emailStageActors } from './needsEmails';
import { gateProblems, loadGateFacts, problem, throwProblems, type LoadedGateProposal, type Problem } from './needsGate';
import { recordOverrideUseInTx } from './needsOverrides.service';
import { holds, loadRuleFacts, narrowActions, separationFor, type OverrideFlagFact, type RuleFacts } from './proposalRules';

/**
 * Needs pipeline wave 3 (A1, A3, A4): the submitter's batch actions and the stage decisions, both all
 * or nothing (D-N.4) under the cycle lock. Every item is checked first; one item that may not move
 * refuses the request with the first problem's status and code and every problem in
 * `details.items`; nothing is written.
 *
 * Batch actions (`POST /cycles/:cycleId/proposal-actions`), offered by `narrowActions`:
 * - SUBMIT (Identification, Design): the gate of the stage it leaves (`needsGate`), then the next
 *   stage, IN_PROGRESS; audit NEEDS_PROPOSAL_SUBMITTED.
 * - RESUBMIT: RETURNED → IN_PROGRESS in the same stage; audit NEEDS_PROPOSAL_SUBMITTED (resubmitted).
 * - WITHDRAW (reason): closed WITHDRAWN; audit NEEDS_PROPOSAL_WITHDRAWN.
 *
 * Stage decisions (`POST /cycles/:cycleId/decisions`) by the stage's actor, on proposals IN_PROGRESS in
 * that stage, outcomes from `STAGE_DECISION_OUTCOMES`:
 * - VALIDATION ADVANCE: separation VALIDATE, an ADVANCE validation record on the current version
 *   (409 NEEDS_VALIDATION_RECORD_REQUIRED), the gate; NOT_VALIDATED: separation VALIDATE, closed.
 * - COSTING ADVANCE (sign-off): separation COST, the current version is a costed one (409
 *   NEEDS_COSTED_VERSION_REQUIRED) with the supervision and monitoring line (422
 *   NEEDS_SUPERVISION_LINE_MISSING), the gate; stores the costed amount.
 * - RETURN (any of the three): RETURNED with the reason, stage unchanged.
 * Each item writes NEEDS_STAGE_DECIDED (and NEEDS_PROPOSAL_RETURNED when returned). After the commit:
 * the Validated Project List / Cost Estimate Report when something advanced, then the emails.
 */

type Tx = Prisma.TransactionClient;

const PROPOSAL_SELECT = {
  id: true,
  cycleId: true,
  reference: true,
  title: true,
  stage: true,
  status: true,
  currentVersionId: true,
  currentVersion: { select: { id: true, source: true, templateVersion: true, costedTotalNgn: true, uploadedByUserId: true, parsedJson: true } },
} satisfies Prisma.NeedsProposalSelect;

type LoadedProposal = Prisma.NeedsProposalGetPayload<{ select: typeof PROPOSAL_SELECT }>;

/** The listed proposals of the URL cycle, in the order asked (404 for the first one that is not). */
async function loadItems(tx: Tx, cycleId: string, ids: readonly string[]): Promise<LoadedProposal[]> {
  const rows = await tx.needsProposal.findMany({ where: { cycleId, id: { in: [...ids] } }, select: PROPOSAL_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw PROPOSAL_NOT_FOUND();
    return row;
  });
}

async function writableLockedCycle(tx: Tx, user: WebJwtPayload, cycleId: string): Promise<CycleRow> {
  const cycle = await loadWritableCycle(user, cycleId, tx);
  await lockCycle(tx, cycle.id);
  const fresh = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycle.id } });
  if (fresh.status !== 'OPEN') throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
  return fresh;
}

const label = (config: NeedsPipelineConfig, stage: NeedsStage) => stageConfigOf(config, stage)?.label ?? stage;

function resultItem(config: NeedsPipelineConfig, p: { id: string; reference: string }, outcome: string, stage: NeedsStage, status: NeedsProposalStatus) {
  return { proposalId: p.id, reference: p.reference, outcome, stage, status, statusLabel: proposalStatusLabel({ stage, status }, config) };
}

interface Arrival {
  stage: NeedsStage;
  proposals: Array<{ reference: string; title: string }>;
}

function addArrival(arrivals: Arrival[], stage: NeedsStage, p: { reference: string; title: string }) {
  const a = arrivals.find((x) => x.stage === stage);
  if (a) a.proposals.push({ reference: p.reference, title: p.title });
  else arrivals.push({ stage, proposals: [{ reference: p.reference, title: p.title }] });
}

async function sendArrivalEmails(cycle: CycleRow, config: NeedsPipelineConfig, arrivals: Arrival[], actorUserId: string) {
  for (const a of arrivals) await emailStageActors({ cycle, config, stage: a.stage, kind: 'WAITING', proposals: a.proposals, excludeUserId: actorUserId });
}

// ---------------------------------------------------------------------------
// Batch actions
// ---------------------------------------------------------------------------

export async function applyProposalActions(user: WebJwtPayload, cycleId: string, input: ProposalBatchActionRequest): Promise<NeedsDecisionResultDto> {
  const arrivals: Arrival[] = [];
  const result = await prisma.$transaction(
    async (tx) => {
      const cycle = await writableLockedCycle(tx, user, cycleId);
      const config = cycleConfig(cycle);
      const items = await loadItems(tx, cycle.id, input.proposalIds);
      const facts = await loadRuleFacts(tx, user, [cycle], items.map((p) => p.id));
      const gates = input.action === 'SUBMIT' ? await loadGateFacts(tx, items as LoadedGateProposal[]) : null;

      const problems: Problem[] = [];
      for (const p of items) {
        const stage = p.stage as NeedsStage;
        const status = p.status as NeedsProposalStatus;
        const { allowed } = narrowActions(user, cycle, config, p, facts);
        if (!allowed.includes(input.action)) {
          const verb = input.action === 'SUBMIT' ? 'submit' : input.action === 'RESUBMIT' ? 'resubmit' : 'withdraw';
          problems.push(problem(p, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED', `You cannot ${verb} ${p.reference} while it is "${proposalStatusLabel({ stage, status }, config)}".`));
          continue;
        }
        if (input.action === 'SUBMIT') {
          problems.push(...gateProblems(config, stage, p, gates!.get(p.id)!));
          if (!nextStage(config, stage)) problems.push(problem(p, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED', `${p.reference} is at the last stage.`));
        }
      }
      if (problems.length) throwProblems(problems);

      const actor = webActor(user);
      const out = [];
      for (const p of items) {
        const stage = p.stage as NeedsStage;
        if (input.action === 'SUBMIT') {
          const to = nextStage(config, stage)!;
          await tx.needsProposal.update({ where: { id: p.id }, data: { stage: to, status: 'IN_PROGRESS', statusReason: null } });
          await recordAuditEvent(tx, {
            tenantId: user.tenantId,
            projectId: null,
            ...actor,
            action: 'NEEDS_PROPOSAL_SUBMITTED',
            summaryText: `Submitted ${p.reference} for ${label(config, to).toLowerCase()}.`,
            payload: { cycleId: cycle.id, proposalId: p.id, reference: p.reference, fromStage: stage, toStage: to, versionId: p.currentVersionId },
          });
          addArrival(arrivals, to, p);
          out.push(resultItem(config, p, 'SUBMIT', to, 'IN_PROGRESS'));
        } else if (input.action === 'RESUBMIT') {
          await tx.needsProposal.update({ where: { id: p.id }, data: { status: 'IN_PROGRESS', statusReason: null } });
          await recordAuditEvent(tx, {
            tenantId: user.tenantId,
            projectId: null,
            ...actor,
            action: 'NEEDS_PROPOSAL_SUBMITTED',
            summaryText: `Resubmitted ${p.reference} at ${label(config, stage).toLowerCase()}${input.reason ? `: ${input.reason}` : '.'}`,
            payload: { cycleId: cycle.id, proposalId: p.id, reference: p.reference, resubmitted: true, stage, reason: input.reason, versionId: p.currentVersionId },
          });
          addArrival(arrivals, stage, p);
          out.push(resultItem(config, p, 'RESUBMIT', stage, 'IN_PROGRESS'));
        } else {
          await tx.needsProposal.update({ where: { id: p.id }, data: { status: 'WITHDRAWN', statusReason: input.reason } });
          await recordAuditEvent(tx, {
            tenantId: user.tenantId,
            projectId: null,
            ...actor,
            action: 'NEEDS_PROPOSAL_WITHDRAWN',
            summaryText: `Withdrew ${p.reference}: ${input.reason}`,
            payload: { cycleId: cycle.id, proposalId: p.id, reference: p.reference, stage, reason: input.reason },
          });
          out.push(resultItem(config, p, 'WITHDRAW', stage, 'WITHDRAWN'));
        }
      }
      return { cycle, config, dto: { decisionId: null, items: out, generatedDocuments: [] } satisfies NeedsDecisionResultDto };
    },
    { timeout: 30_000 }
  );
  await sendArrivalEmails(result.cycle, result.config, arrivals, user.userId);
  return result.dto;
}

// ---------------------------------------------------------------------------
// Stage decisions
// ---------------------------------------------------------------------------

function separationProblem(facts: RuleFacts, p: LoadedProposal, action: 'VALIDATE' | 'COST', userId: string): { problem: Problem | null; flag: OverrideFlagFact | null } {
  const { check, flag } = separationFor(facts, p, action, userId);
  if (check.allowed) return { problem: null, flag };
  return { problem: problem(p, 409, check.violation!, `${p.reference}: ${NEEDS_SEPARATION_ERROR_MESSAGES[check.violation!]}`), flag: null };
}

export async function decideStage(user: WebJwtPayload, cycleId: string, input: StageDecisionRequest): Promise<NeedsDecisionResultDto> {
  const arrivals: Arrival[] = [];
  const returned: Array<{ proposalId: string; reference: string; title: string; reason: string | null; uploaderUserId: string | null }> = [];
  const result = await prisma.$transaction(
    async (tx) => {
      const cycle = await writableLockedCycle(tx, user, cycleId);
      const config = cycleConfig(cycle);
      const stage = input.stage;
      const outcomes = STAGE_DECISION_OUTCOMES[stage];
      const stageConfig = stageConfigOf(config, stage);
      if (!outcomes || !stageConfig) {
        throw new AppError(`${stageConfig?.label ?? stage} has no stage decision: proposals move on by submission or by their own step`, 422, 'NEEDS_OUTCOME_NOT_ALLOWED');
      }
      const actorKey = stageConfig.actorPermissionKey;
      if (!actorKey || !holds(user, actorKey)) throw new AppError(`Access requires permission(s): ${actorKey ?? 'the stage actor'}`, 403, 'FORBIDDEN_PERMISSION');
      if (input.evidenceDocumentIds.length) {
        const found = await tx.needsCycleDocument.count({ where: { cycleId: cycle.id, id: { in: input.evidenceDocumentIds } } });
        if (found !== new Set(input.evidenceDocumentIds).size) throw new AppError('Evidence must be documents of this cycle', 422, 'NEEDS_EVIDENCE_INVALID');
      }

      const items = await loadItems(
        tx,
        cycle.id,
        input.items.map((i) => i.proposalId)
      );
      const facts = await loadRuleFacts(tx, user, [cycle], items.map((p) => p.id));
      // Review fix (wave 3): at Prioritisation only the committee's chair returns proposals, and only
      // before the ranking is finalised.
      if (stage === 'PRIORITISATION') {
        if (cycle.rankingFinalisedAt) throw new AppError('The ranking of this cycle is finalised', 409, 'NEEDS_RANKING_FINALISED');
        if (facts.committees.get(cycle.id)?.me?.role !== 'CHAIR') throw new AppError('Only the chair of the committee returns a proposed project at Prioritisation', 403, 'NEEDS_NOT_COMMITTEE_CHAIR');
      }
      const gates = await loadGateFacts(tx, items as LoadedGateProposal[]);
      const records = await tx.needsValidationRecord.findMany({
        where: { proposalId: { in: items.map((p) => p.id) } },
        orderBy: { recordedAt: 'desc' },
        select: { proposalId: true, versionId: true, outcome: true },
      });

      const problems: Problem[] = [];
      const overrideUses = new Map<string, OverrideFlagFact>();
      input.items.forEach((item, i) => {
        const p = items[i];
        const outcome = item.outcome as StageOutcome;
        if (!outcomes.includes(outcome)) {
          problems.push(problem(p, 422, 'NEEDS_OUTCOME_NOT_ALLOWED', `${p.reference}: "${outcome}" is not an outcome of ${stageConfig.label}.`));
          return;
        }
        if (p.stage !== stage || p.status !== 'IN_PROGRESS') {
          problems.push(
            problem(p, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED', `${p.reference} is "${proposalStatusLabel({ stage: p.stage as NeedsStage, status: p.status as NeedsProposalStatus }, config)}", not waiting for ${stageConfig.label.toLowerCase()}.`)
          );
          return;
        }
        if (outcome === 'RETURN') {
          if (!returnTarget(config, stage)) problems.push(problem(p, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED', `${p.reference} cannot be returned from ${stageConfig.label}.`));
          return;
        }
        const sepAction = stage === 'VALIDATION' ? 'VALIDATE' : stage === 'COSTING' ? 'COST' : null;
        if (sepAction) {
          const sep = separationProblem(facts, p, sepAction, user.userId);
          if (sep.problem) {
            problems.push(sep.problem);
            return;
          }
          if (sep.flag) overrideUses.set(p.id, sep.flag);
        }
        if (outcome !== 'ADVANCE') return;
        // Review fix (wave 3): a proposal cannot join a ranking that is already final (wave 4 decides
        // how late proposals re-enter); it waits here instead of at Prioritisation with no way on.
        if (nextStage(config, stage) === 'PRIORITISATION' && cycle.rankingFinalisedAt) {
          problems.push(problem(p, 409, 'NEEDS_RANKING_FINALISED', `${p.reference}: the ranking of this cycle is finalised, so it cannot go to Prioritisation.`));
          return;
        }
        if (stage === 'VALIDATION') {
          const latest = records.find((r) => r.proposalId === p.id && r.versionId === p.currentVersionId);
          if (!latest || latest.outcome !== 'ADVANCE') {
            problems.push(problem(p, 409, 'NEEDS_VALIDATION_RECORD_REQUIRED', `${p.reference}: record a validation that advances the current version first.`));
          }
        }
        if (stage === 'COSTING') {
          if (p.currentVersion?.source !== 'COSTING') {
            problems.push(problem(p, 409, 'NEEDS_COSTED_VERSION_REQUIRED', `${p.reference}: upload the costed version first.`));
          } else if (!hasSupervisionLine(parsedOf(p.currentVersion.parsedJson as Prisma.JsonValue)?.costingSummary)) {
            problems.push(problem(p, 422, 'NEEDS_SUPERVISION_LINE_MISSING', `${p.reference}: the costed version has no supervision and monitoring line.`));
          }
        }
        problems.push(...gateProblems(config, stage, p, gates.get(p.id)!));
      });
      if (problems.length) throwProblems(problems);

      const decision = await tx.needsStageDecision.create({
        data: {
          cycleId: cycle.id,
          stage,
          reason: input.reason,
          evidenceDocumentIds: input.evidenceDocumentIds,
          decidedByUserId: user.userId,
          decidedByName: user.fullName,
        },
      });
      const actor = webActor(user);
      const out = [];
      let advanced = 0;
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        const item = input.items[i];
        const reason = item.reason ?? input.reason;
        let toStage: NeedsStage = stage;
        let toStatus: NeedsProposalStatus;
        const data: Prisma.NeedsProposalUpdateInput = {};
        if (item.outcome === 'ADVANCE') {
          toStage = nextStage(config, stage)!;
          toStatus = 'IN_PROGRESS';
          Object.assign(data, { stage: toStage, status: toStatus, statusReason: null });
          if (stage === 'COSTING') data.costedAmountNgn = dec(p.currentVersion?.costedTotalNgn as Prisma.Decimal | null);
          advanced += 1;
          addArrival(arrivals, toStage, p);
        } else if (item.outcome === 'RETURN') {
          toStatus = 'RETURNED';
          Object.assign(data, { status: toStatus, statusReason: reason });
          // Review fix (wave 3): a proposal returned at Prioritisation leaves the ranking: its sheets,
          // score, rank and any placement go; it is scored again when it comes back.
          if (stage === 'PRIORITISATION') {
            await tx.needsScoreSheet.deleteMany({ where: { proposalId: p.id } });
            Object.assign(data, { scoreImpact: null, scoreEase: null, scoreTotal: null, rank: null, aboveLine: null, lineOverrideReason: null });
          }
          returned.push({ proposalId: p.id, reference: p.reference, title: p.title, reason, uploaderUserId: p.currentVersion?.uploadedByUserId ?? null });
        } else {
          toStatus = 'NOT_VALIDATED';
          Object.assign(data, { status: toStatus, statusReason: reason });
        }
        await tx.needsProposal.update({ where: { id: p.id }, data });
        await tx.needsStageDecisionItem.create({ data: { decisionId: decision.id, proposalId: p.id, outcome: item.outcome, reason, toStage, toStatus } });
        const flag = overrideUses.get(p.id);
        if (flag) await recordOverrideUseInTx(tx, user, cycle, p, flag, stage === 'COSTING' ? 'Signed off the costing' : 'Decided the validation');
        const outcomeWords =
          item.outcome === 'ADVANCE' ? `advanced to ${label(config, toStage).toLowerCase()}` : item.outcome === 'RETURN' ? 'returned for correction' : 'not validated';
        await recordAuditEvent(tx, {
          tenantId: user.tenantId,
          projectId: null,
          ...actor,
          action: 'NEEDS_STAGE_DECIDED',
          summaryText: `${stageConfig.label}: ${p.reference} ${outcomeWords}${reason && item.outcome !== 'ADVANCE' ? `: ${reason}` : '.'}`,
          payload: {
            cycleId: cycle.id,
            decisionId: decision.id,
            proposalId: p.id,
            reference: p.reference,
            stage,
            outcome: item.outcome,
            toStage,
            toStatus,
            reason,
            versionId: p.currentVersionId,
            ...(stage === 'COSTING' && item.outcome === 'ADVANCE' ? { costedAmountNgn: dec(p.currentVersion?.costedTotalNgn as Prisma.Decimal | null) } : {}),
          },
        });
        if (item.outcome === 'RETURN') {
          await recordAuditEvent(tx, {
            tenantId: user.tenantId,
            projectId: null,
            ...actor,
            action: 'NEEDS_PROPOSAL_RETURNED',
            summaryText: `Returned ${p.reference} at ${stageConfig.label.toLowerCase()}: ${reason ?? ''}`,
            payload: { cycleId: cycle.id, decisionId: decision.id, proposalId: p.id, reference: p.reference, stage, reason },
          });
        }
        out.push(resultItem(config, p, item.outcome, toStage, toStatus));
      }
      return { cycle, config, advanced, dto: { decisionId: decision.id, items: out, generatedDocuments: [] as NeedsCycleDocumentDto[] } };
    },
    { timeout: 30_000 }
  );

  const { cycle, config } = result;
  const reportKind: StageReportKind | null =
    result.advanced > 0 ? (input.stage === 'VALIDATION' ? 'VALIDATED_PROJECT_LIST' : input.stage === 'COSTING' ? 'COST_ESTIMATE_REPORT' : null) : null;
  if (reportKind) {
    try {
      result.dto.generatedDocuments = await generateStageReport({
        cycle,
        kind: reportKind,
        by: { userId: user.userId, name: user.fullName, actor: webActor(user) },
      });
    } catch (error) {
      console.error('[needs decisions] report generation failed', error);
    }
  }
  if (returned.length) await emailReturned({ cycle, config, stage: input.stage, items: returned });
  await sendArrivalEmails(cycle, config, arrivals, user.userId);
  return result.dto;
}
