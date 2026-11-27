import {
  NEEDS_STAGE_ORDER,
  NEEDS_TEMPLATE_FIELD_LABELS,
  NEEDS_TEMPLATE_VERSION,
  PROPOSAL_FLAG_KIND_META,
  minimumFieldsFor,
  missingMinimumFields,
  type NeedsPipelineConfig,
  type NeedsStage,
  type ParsedNeedsAssessment,
  type ProposalFlagKind,
} from '@insite/shared';
import { AppError } from '../../../middleware/error.middleware';
import type { Db } from '../needsAccess';
import { parsedOf } from '../needsSupport';

/**
 * Needs pipeline wave 3 (A1, A2): the gate on leaving a stage, and the batch problem list (D-N.4:
 * all or nothing, every item checked first, the first problem's status and code, all problems in
 * `details.items`).
 *
 * Leaving stage S (SUBMIT from Identification or Design; ADVANCE at Validation or Costing):
 * - from Design on, the current version is template v2 (422 NEEDS_TEMPLATE_V2_REQUIRED);
 * - the current version has the minimum fields of S, DRAWINGS counted from the proposal's current
 *   DRAWING documents (422 NEEDS_MINIMUM_FIELDS_MISSING);
 * - no open flag blocks S (`PROPOSAL_FLAG_KIND_META[kind].blocksStage === S`; 409 NEEDS_FLAGS_UNRESOLVED).
 */

export interface Problem {
  proposalId: string;
  reference: string;
  code: string;
  message: string;
  status: number;
}

export const problem = (p: { id: string; reference: string }, status: number, code: string, message: string): Problem => ({
  proposalId: p.id,
  reference: p.reference,
  code,
  message,
  status,
});

/** Throws the first problem's status and code with every problem in `details.items`. */
export function throwProblems(problems: Problem[]): never {
  const first = problems[0];
  throw new AppError(first.message, first.status, first.code, { items: problems.map(({ proposalId, reference, code, message }) => ({ proposalId, reference, code, message })) });
}

export interface GateFacts {
  parsed: ParsedNeedsAssessment | null;
  templateVersion: string | null;
  drawingCount: number;
  openFlagKinds: string[];
}

const idx = (s: NeedsStage) => NEEDS_STAGE_ORDER.indexOf(s);

export function gateProblems(config: NeedsPipelineConfig, stage: NeedsStage, p: { id: string; reference: string }, facts: GateFacts): Problem[] {
  const out: Problem[] = [];
  if (!facts.parsed) {
    out.push(problem(p, 422, 'NEEDS_MINIMUM_FIELDS_MISSING', `${p.reference} has no readable needs assessment.`));
    return out;
  }
  if (idx(stage) >= idx('DESIGN') && facts.templateVersion !== NEEDS_TEMPLATE_VERSION) {
    out.push(problem(p, 422, 'NEEDS_TEMPLATE_V2_REQUIRED', `${p.reference}: upload the needs assessment on template ${NEEDS_TEMPLATE_VERSION} first.`));
  }
  const missing = missingMinimumFields(facts.parsed, minimumFieldsFor(config, stage), { drawingCount: facts.drawingCount });
  if (missing.length) {
    out.push(problem(p, 422, 'NEEDS_MINIMUM_FIELDS_MISSING', `${p.reference} is missing: ${missing.map((k) => NEEDS_TEMPLATE_FIELD_LABELS[k]).join(', ')}.`));
  }
  const blocking = [...new Set(facts.openFlagKinds)].filter((k) => PROPOSAL_FLAG_KIND_META[k as ProposalFlagKind]?.blocksStage === stage);
  if (blocking.length) {
    out.push(
      problem(p, 409, 'NEEDS_FLAGS_UNRESOLVED', `${p.reference}: resolve first: ${blocking.map((k) => PROPOSAL_FLAG_KIND_META[k as ProposalFlagKind].label.toLowerCase()).join(', ')}.`)
    );
  }
  return out;
}

/** Current DRAWING documents (not superseded) per proposal. */
export function drawingCounts(docs: ReadonlyArray<{ id: string; proposalId: string; kind: string; supersedesId: string | null }>): Map<string, number> {
  const superseded = new Set(docs.map((d) => d.supersedesId).filter((id): id is string => Boolean(id)));
  const out = new Map<string, number>();
  for (const d of docs) if (d.kind === 'DRAWING' && !superseded.has(d.id)) out.set(d.proposalId, (out.get(d.proposalId) ?? 0) + 1);
  return out;
}

export interface LoadedGateProposal {
  id: string;
  reference: string;
  title: string;
  stage: string;
  status: string;
  currentVersionId: string | null;
  currentVersion: { id: string; source: string; templateVersion: string; costedTotalNgn: unknown; uploadedByUserId: string; parsedJson: unknown } | null;
}

/** The gate facts of many proposals (three queries). */
export async function loadGateFacts(db: Db, proposals: readonly LoadedGateProposal[]): Promise<Map<string, GateFacts>> {
  const ids = proposals.map((p) => p.id);
  const [docs, flags] = await Promise.all([
    db.needsProposalDocument.findMany({ where: { proposalId: { in: ids } }, select: { id: true, proposalId: true, kind: true, supersedesId: true } }),
    db.needsProposalFlag.findMany({ where: { proposalId: { in: ids }, resolvedAt: null }, select: { proposalId: true, kind: true } }),
  ]);
  const drawings = drawingCounts(docs);
  return new Map(
    proposals.map((p) => [
      p.id,
      {
        parsed: parsedOf(p.currentVersion?.parsedJson as never),
        templateVersion: p.currentVersion?.templateVersion ?? null,
        drawingCount: drawings.get(p.id) ?? 0,
        openFlagKinds: flags.filter((f) => f.proposalId === p.id).map((f) => f.kind),
      },
    ])
  );
}
