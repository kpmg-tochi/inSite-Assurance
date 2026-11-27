import { Prisma } from '@prisma/client';
import { formatProjectCode, type CreateProjectDraftRequest } from '@insite/shared';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { createProjectDraftInTx, markStepSaved } from '../../projects/projectSetup.service';
import { replaceProjectSitesInTx } from '../../sites/sites.service';
import { actorName, webActor } from '../needsAccess';
import { parsedOf } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { needsToScopeImport } from './needsToScopeImport';

/**
 * Needs pipeline wave 3, N7a (M2): a funded proposal becomes a draft project, in the caller's
 * transaction (wave 4's funding gates call it: DI appropriation, MG BEAP approval, out-of-cycle
 * approval). Nothing checks who may convert here: the gate that calls it does.
 *
 * One transaction: the cycle lock and a row lock on the proposal (a second call answers 409
 * NEEDS_PROPOSAL_ALREADY_CONVERTED); the draft through `createProjectDraftInTx` (type of the cycle
 * applied, owner and funder derived from the State as for any typed draft, year = the cycle's,
 * budget = the funded amount, code = the proposal reference unless a lot is given, D-N.15; a State
 * cycle's proposals are owned by the cycle's owner, its SUBEB); the
 * current version's sites, units and BoQ lines (`needsToScopeImport`; no work phases); the
 * justification, assumptions and the first school as primary beneficiary; `origin = NEEDS_PIPELINE`
 * and `needsProposalId`; the proposal CONVERTED with its funded amount; ledger entries on both sides
 * (`PROJECT_CREATED_FROM_PROPOSAL` on the project, `NEEDS_PROPOSAL_CONVERTED` on the tenant ledger).
 */

type Tx = Prisma.TransactionClient;

export interface ConvertProposalOptions {
  fundedAmountNgn: number;
  /** A lot to number the code in (`{ lotId }` or `{ newLotTitle }`); without one the code is the reference. */
  lot?: CreateProjectDraftRequest['lotChoice'];
  /** Who converts (the person whose decision funds the proposal). */
  by: WebJwtPayload;
}

export interface ConvertedProposal {
  projectId: string;
  codePrefix: string;
  siteCount: number;
  unitCount: number;
  lineCount: number;
}

export async function convertProposalToProject(tx: Tx, proposal: { id: string }, options: ConvertProposalOptions): Promise<ConvertedProposal> {
  const by = options.by;
  if (!(options.fundedAmountNgn > 0)) throw new AppError('The funded amount must be above zero.', 422, 'NEEDS_FUNDED_AMOUNT_REQUIRED');
  const head = await tx.needsProposal.findFirst({ where: { id: proposal.id, tenantId: by.tenantId }, select: { cycleId: true } });
  if (!head) throw new AppError('Proposed project not found', 404, 'NEEDS_PROPOSAL_NOT_FOUND');
  await lockCycle(tx, head.cycleId);
  await tx.$queryRaw`SELECT id FROM needs_proposals WHERE id = ${proposal.id}::uuid FOR UPDATE`;

  const p = await tx.needsProposal.findUniqueOrThrow({
    where: { id: proposal.id },
    include: { cycle: true, currentVersion: true, project: { select: { id: true, codePrefix: true } } },
  });
  if (p.status === 'CONVERTED' || p.project) {
    throw new AppError(`${p.reference} is already a project${p.project ? ` (${formatProjectCode(p.project.codePrefix)})` : ''}.`, 409, 'NEEDS_PROPOSAL_ALREADY_CONVERTED');
  }
  if (!['IN_PROGRESS', 'DRAFT', 'RETURNED'].includes(p.status)) {
    throw new AppError(`${p.reference} is closed and cannot be funded.`, 409, 'NEEDS_PROPOSAL_CLOSED');
  }
  const parsed = parsedOf(p.currentVersion?.parsedJson);
  if (!p.currentVersion || !parsed) throw new AppError(`${p.reference} has no needs assessment version.`, 422, 'NEEDS_CONVERSION_INVALID');

  const facilities = await tx.facility.findMany({ where: { tenantId: by.tenantId }, select: { id: true, code: true, name: true } });
  const facilityByCode = new Map(facilities.map((f) => [f.code.toUpperCase(), f]));
  const plan = needsToScopeImport(parsed, new Map(facilities.map((f) => [f.code.toUpperCase(), f.name])));
  const unknown = [...new Set(plan.units.map((u) => u.facilityCode).filter((c) => !facilityByCode.has(c)))];
  const issues = [...plan.issues.map((i) => i.message), ...unknown.map((c) => `Facility ${c} is not in the workspace catalogue.`)];
  if (issues.length) {
    throw new AppError(`${p.reference} cannot become a project: ${issues[0]}`, 422, 'NEEDS_CONVERSION_INVALID', { issues });
  }

  const stateCode = p.stateCode ?? parsed.project.stateCode ?? null;
  const lgas = [...new Set(plan.sites.map((s) => s.lgaCode))];
  const projectId = await createProjectDraftInTx(
    tx,
    by,
    {
      name: p.title,
      codePrefix: options.lot ? undefined : p.reference,
      lotChoice: options.lot,
      description: null,
      totalBudgetNgn: options.fundedAmountNgn,
      projectTypeId: p.cycle.projectTypeId,
      interventionYear: p.cycle.interventionYear,
      stateCode,
      lgaCode: lgas.length === 1 ? lgas[0] : null,
    },
    { interventionYearFromCycle: true }
  );

  // The owner: a State cycle's proposals belong to its SUBEB (plan 4.2, the cycle's owner); a national
  // one keeps the owner derived when the type was applied, else the cycle's owner (UBEC HQ). The D2
  // derivation finds a SUBEB by `stateCode`, which the normal seed's SUBEBs do not carry (wave 2 item 16).
  const derived = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { owningOrganizationId: true } });
  const owningOrganizationId = p.cycle.scopeKey !== 'NATIONAL' ? p.cycle.owningOrganizationId : (derived.owningOrganizationId ?? p.cycle.owningOrganizationId);
  await tx.project.update({
    where: { id: projectId },
    data: {
      owningOrganizationId,
      origin: 'NEEDS_PIPELINE',
      needsProposalId: p.id,
      strategicJustification: parsed.project.justification ?? null,
      assumptions: parsed.project.assumptions ?? null,
    },
  });

  const siteIdByNumber = await replaceProjectSitesInTx(tx, projectId, plan.sites);
  const unitIdByCode = new Map<string, { id: string; facilityName: string }>();
  for (const u of plan.units) {
    const facility = facilityByCode.get(u.facilityCode)!;
    const row = await tx.facilityUnit.create({
      data: {
        projectId,
        facilityId: facility.id,
        code: u.code,
        label: u.label,
        plannedQuantity: u.plannedQuantity,
        quantityUnit: u.quantityUnit,
        siteId: siteIdByNumber.get(u.siteNumber) ?? null,
        sortOrder: u.sortOrder,
      },
    });
    unitIdByCode.set(u.code, { id: row.id, facilityName: facility.name });
  }
  if (plan.lines.length) {
    await tx.boqItem.createMany({
      data: plan.lines.map((l) => ({
        projectId,
        facilityUnitId: unitIdByCode.get(l.unitCode)!.id,
        wbsCode: l.wbsCode,
        section: unitIdByCode.get(l.unitCode)!.facilityName,
        description: l.description,
        unit: l.unit,
        totalQuantity: l.totalQuantity,
        rateNgn: l.rateNgn,
        budgetedCostNgn: l.amountNgn,
      })),
    });
  }
  if (plan.sites[0]) {
    await tx.projectBeneficiary.create({ data: { projectId, name: plan.sites[0].schoolName, beneficiaryType: 'SCHOOL', isPrimary: true } });
  }
  // The wizard shows sites and scope as filled in; scope stays incomplete until work phases are set.
  await markStepSaved(tx, projectId, 'sites', by.userId);
  await markStepSaved(tx, projectId, 'scope', by.userId);

  await tx.needsProposal.update({
    where: { id: p.id },
    data: { status: 'CONVERTED', fundedAmountNgn: options.fundedAmountNgn, statusReason: null },
  });

  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { codePrefix: true } });
  const lastProposalEntry = await tx.auditLog.findFirst({
    where: { tenantId: by.tenantId, projectId: null, payload: { path: ['proposalId'], equals: p.id } },
    orderBy: { seq: 'desc' },
    select: { seq: true, id: true },
  });
  const history = {
    proposalId: p.id,
    reference: p.reference,
    cycleId: p.cycleId,
    interventionYear: p.cycle.interventionYear,
    versionNumber: p.currentVersion.number,
    versionSha256: p.currentVersion.sha256,
    // The proposal's history is on the tenant ledger (entries whose payload names the proposal).
    tenantLedgerLastSeq: lastProposalEntry ? Number(lastProposalEntry.seq) : null,
  };
  const code = formatProjectCode(project.codePrefix);
  await recordAuditEvent(tx, {
    projectId,
    actorType: 'WEB_USER',
    actorId: by.userId,
    actorDisplayName: actorName(by),
    action: 'PROJECT_CREATED_FROM_PROPOSAL',
    summaryText:
      `Created from proposed project ${p.reference} (needs assessment version ${p.currentVersion.number}): ` +
      `${plan.totals.siteCount} site(s), ${plan.totals.unitCount} facility unit(s), ${plan.totals.lineCount} BoQ line(s); funded amount NGN ${options.fundedAmountNgn.toLocaleString('en-NG')}.`,
    payload: { ...history, fundedAmountNgn: options.fundedAmountNgn, codePrefix: project.codePrefix, totals: plan.totals },
  });
  await recordAuditEvent(tx, {
    tenantId: by.tenantId,
    projectId: null,
    ...webActor(by),
    action: 'NEEDS_PROPOSAL_CONVERTED',
    summaryText: `${p.reference} became draft project ${code}.`,
    payload: { cycleId: p.cycleId, proposalId: p.id, reference: p.reference, projectId, codePrefix: project.codePrefix, fundedAmountNgn: options.fundedAmountNgn },
  });

  return { projectId, codePrefix: project.codePrefix, siteCount: plan.totals.siteCount, unitCount: plan.totals.unitCount, lineCount: plan.totals.lineCount };
}
