import {
  formatProjectCode,
  type AssignLotsRequest,
  type LotChoice,
  type NeedsCycleDocumentDto,
  type NeedsDocumentPresignRequest,
  type NeedsPresignedUploadDto,
  type NeedsProcurementPlanDto,
  type RegisterCycleDocumentRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { assignLotBatchCode } from '../../projectLots/projectLots.service';
import { actorName, loadVisibleCycle, loadWritableCycle, webActor } from '../needsAccess';
import { presignNeedsDocument, registerCycleDocument } from '../needsCycles.service';
import { currentFirst, serializeCycleDocument } from '../needsSerializers';
import { dec } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { assertFundingGate, assertOwningOrganisation, fundingGateOf, holds } from './fundingSupport';

/**
 * Needs pipeline wave 4, Track B (B3, D-N.15): the Direct Intervention procurement plan. A converted
 * DI draft keeps the proposal reference as its code until Procurement assigns a lot; then it takes
 * `<year>-LOT-n-BATCH-m` through the same lot code path as the basics section (`assignLotBatchCode`,
 * per-tenant lot lock). Only DRAFT projects converted from this cycle that have no lot yet; the whole
 * request is one transaction (all or nothing). Items naming the same new lot title in one request share
 * that lot. The approved plan is uploaded as a cycle document of kind PROCUREMENT_PLAN.
 *
 * Who: `procurement:plan_lots` in the cycle's owning organisation. Lots are assigned on an open or a
 * closed cycle (the drafts live on after the cycle closes); plan documents follow the cycle-document
 * rule (open cycle).
 */

export async function getProcurementPlan(user: WebJwtPayload, cycleId: string): Promise<NeedsProcurementPlanDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const [proposals, lots, docs] = await Promise.all([
    prisma.needsProposal.findMany({
      where: { cycleId: cycle.id, project: { isNot: null } },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        reference: true,
        title: true,
        project: {
          select: {
            id: true,
            codePrefix: true,
            status: true,
            stateCode: true,
            totalBudgetNgn: true,
            batchNumber: true,
            lot: { select: { id: true, number: true, title: true } },
          },
        },
      },
    }),
    prisma.projectLot.findMany({
      where: { tenantId: user.tenantId, interventionYear: cycle.interventionYear },
      orderBy: { number: 'asc' },
      select: { id: true, number: true, title: true, _count: { select: { projects: true } } },
    }),
    prisma.needsCycleDocument.findMany({ where: { cycleId: cycle.id, kind: 'PROCUREMENT_PLAN' } }),
  ]);
  return {
    cycleId: cycle.id,
    interventionYear: cycle.interventionYear,
    rows: proposals.map((p) => {
      const project = p.project!;
      return {
        projectId: project.id,
        proposalId: p.id,
        reference: p.reference,
        title: p.title,
        projectCode: formatProjectCode(project.codePrefix),
        projectStatus: project.status,
        stateCode: project.stateCode,
        budgetNgn: dec(project.totalBudgetNgn),
        lotId: project.lot?.id ?? null,
        lotNumber: project.lot?.number ?? null,
        lotTitle: project.lot?.title ?? null,
        batchNumber: project.batchNumber,
      };
    }),
    lots: lots.map((l) => ({ id: l.id, number: l.number, title: l.title, batchCount: l._count.projects })),
    planDocuments: currentFirst(docs).map(serializeCycleDocument),
    canPlan:
      fundingGateOf(cycle) === 'APPROPRIATION' &&
      holds(user, 'procurement:plan_lots') &&
      (user.isPlatformSuperAdmin || user.organizationId === cycle.owningOrganizationId),
  };
}

/** `POST /cycles/:cycleId/procurement-plan/lots` */
export async function assignLots(user: WebJwtPayload, cycleId: string, input: AssignLotsRequest): Promise<NeedsProcurementPlanDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertOwningOrganisation(user, cycle);
  assertFundingGate(cycle, 'APPROPRIATION');
  const ids = input.items.map((i) => i.projectId);
  if (new Set(ids).size !== ids.length) throw new AppError('A project is listed twice', 422, 'NEEDS_LOT_ITEMS_INVALID');

  await prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, cycle.id);
      const projects = await tx.project.findMany({
        where: { id: { in: ids }, tenantId: user.tenantId },
        select: { id: true, name: true, codePrefix: true, status: true, lotId: true, interventionYear: true, needsProposal: { select: { id: true, cycleId: true, reference: true } } },
      });
      const byId = new Map(projects.map((p) => [p.id, p]));
      for (const id of ids) {
        const p = byId.get(id);
        if (!p || p.needsProposal?.cycleId !== cycle.id) {
          throw new AppError('Project not found among the projects converted from this cycle', 404, 'NEEDS_PROJECT_NOT_IN_CYCLE', { projectId: id });
        }
        if (p.status !== 'DRAFT') throw new AppError(`${formatProjectCode(p.codePrefix)} is no longer a draft: its code cannot change.`, 409, 'NEEDS_PROJECT_NOT_DRAFT', { projectId: id });
        if (p.lotId) throw new AppError(`${formatProjectCode(p.codePrefix)} already has a lot.`, 409, 'NEEDS_LOT_ALREADY_ASSIGNED', { projectId: id });
      }
      // New lots named twice in one request are one lot: the first item creates it.
      const newLots = new Map<string, string>();
      const assigned: Array<{ projectId: string; reference: string; from: string; to: string; lotId: string; lotNumber: number; batchNumber: number }> = [];
      for (const item of input.items) {
        const p = byId.get(item.projectId)!;
        const year = p.interventionYear ?? cycle.interventionYear;
        let choice: LotChoice = item.lotChoice;
        const key = 'newLotTitle' in choice ? choice.newLotTitle.trim().toLowerCase() : null;
        if (key && newLots.has(key)) choice = { lotId: newLots.get(key)! };
        const lot = await assignLotBatchCode(tx, { tenantId: user.tenantId, interventionYear: year, lotChoice: choice, userId: user.userId, actorDisplayName: actorName(user) });
        if (key && !newLots.has(key)) newLots.set(key, lot.lotId);
        const clash = await tx.project.findUnique({ where: { tenantId_codePrefix: { tenantId: user.tenantId, codePrefix: lot.codePrefix } }, select: { id: true } });
        if (clash && clash.id !== p.id) throw new AppError(`A project with code "${formatProjectCode(lot.codePrefix)}" already exists`, 409, 'DUPLICATE_PROJECT_PREFIX');
        await tx.project.update({ where: { id: p.id }, data: { lotId: lot.lotId, batchNumber: lot.batchNumber, codePrefix: lot.codePrefix } });
        await recordAuditEvent(tx, {
          projectId: p.id,
          ...webActor(user),
          action: 'NEEDS_LOTS_ASSIGNED',
          summaryText: `Procurement plan: assigned lot ${lot.lot.number} ("${lot.lot.title}"), batch ${lot.batchNumber}; the code is now ${formatProjectCode(lot.codePrefix)} (was ${formatProjectCode(p.codePrefix)}).`,
          payload: { cycleId: cycle.id, proposalId: p.needsProposal!.id, reference: p.needsProposal!.reference, lotId: lot.lotId, lotNumber: lot.lot.number, batchNumber: lot.batchNumber, previousCodePrefix: p.codePrefix, codePrefix: lot.codePrefix },
        });
        assigned.push({ projectId: p.id, reference: p.needsProposal!.reference, from: p.codePrefix, to: lot.codePrefix, lotId: lot.lotId, lotNumber: lot.lot.number, batchNumber: lot.batchNumber });
      }
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_LOTS_ASSIGNED',
        summaryText: `Procurement plan: assigned lots to ${assigned.length} draft project(s): ${assigned.map((a) => `${a.reference} → ${formatProjectCode(a.to)}`).join(', ')}.`,
        payload: { cycleId: cycle.id, items: assigned, proposalIds: projects.map((p) => p.needsProposal!.id) },
      });
    },
    { timeout: 60_000 }
  );
  return getProcurementPlan(user, cycleId);
}

export async function presignPlanDocument(user: WebJwtPayload, cycleId: string, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  assertFundingGate(await loadWritableCycle(user, cycleId), 'APPROPRIATION');
  return presignNeedsDocument(user, cycleId, input);
}

export async function registerPlanDocument(user: WebJwtPayload, cycleId: string, input: RegisterCycleDocumentRequest): Promise<NeedsCycleDocumentDto> {
  if (input.kind !== 'PROCUREMENT_PLAN') throw new AppError('Only the procurement plan is filed here', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  assertFundingGate(await loadWritableCycle(user, cycleId), 'APPROPRIATION');
  return registerCycleDocument(user, cycleId, input);
}
