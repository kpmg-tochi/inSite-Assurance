import {
  CYCLE_DOCUMENT_KIND_META,
  NEEDS_OPEN_PROPOSAL_STATUSES,
  OUT_OF_CYCLE_REASON_LABELS,
  OutOfCycleReasonEnum,
  PROJECT_ORIGIN_LABELS,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  formatProjectCode,
  proposalStatusLabel,
  type CycleDocumentKind,
  type NeedsFileLinkDto,
  type NeedsPipelineQuery,
  type NeedsPipelineRow,
  type NeedsProposalRoute,
  type NeedsProposalStatus,
  type NeedsStage,
  type ProjectNeedsDocument,
  type ProjectNeedsOriginDto,
  type ProjectOrigin,
  type ProposalDocumentKind,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { isUuid, visibleCycleWhere } from '../needsAccess';
import { fileLink } from '../needsCycles.service';
import { currentFirst } from '../needsSerializers';
import { cycleConfig, dec, parsedOf } from '../needsSupport';
import { holds } from '../decisions/proposalRules';

/**
 * Needs pipeline wave 4, Track A (C5 server side):
 * - `GET /api/v1/needs/pipeline` (Portfolio → Pipeline): proposals of the viewer's visible cycles at
 *   Approval or Funding with an open status, and converted proposals whose project is still a draft.
 * - `GET /api/v1/projects/:projectId/needs-origin` (any web reader of the project, through the
 *   project guard): the Origin card, the Documents "Needs assessment" group (read-through, wave 4
 *   section 0 item 3: the proposal's current documents, every needs assessment version, and the
 *   cycle's current documents that cover the proposal) and the current version's breakdown rows.
 *   Files: `GET /projects/:projectId/needs-origin/files/:scope/:id`, only files of that project's
 *   proposal and cycle (404 NEEDS_DOCUMENT_NOT_FOUND otherwise). Project readers who cannot see the
 *   cycle still read these (the project carries them); `canOpenProposal` says whether the proposal
 *   page opens for them.
 */

const STAGES_ON_PIPELINE: NeedsStage[] = ['APPROVAL', 'FUNDING'];

export async function listPipeline(user: WebJwtPayload, query: NeedsPipelineQuery): Promise<NeedsPipelineRow[]> {
  const rows = await prisma.needsProposal.findMany({
    where: {
      tenantId: user.tenantId,
      cycle: {
        AND: [
          visibleCycleWhere(user),
          {
            ...(query.projectTypeId ? { projectTypeId: query.projectTypeId } : {}),
            ...(query.interventionYear ? { interventionYear: query.interventionYear } : {}),
          },
        ],
      },
      ...(query.stateCode ? { stateCode: query.stateCode.toUpperCase() } : {}),
      OR: [
        { stage: { in: STAGES_ON_PIPELINE }, status: { in: [...NEEDS_OPEN_PROPOSAL_STATUSES] } },
        { status: 'CONVERTED', project: { is: { status: 'DRAFT' } } },
      ],
    },
    include: {
      cycle: { include: { projectType: { select: { name: true } } } },
      project: { select: { id: true, codePrefix: true, status: true } },
    },
    orderBy: [{ cycle: { interventionYear: 'desc' } }, { reference: 'asc' }],
  });
  return rows.map((p) => {
    const stage = p.stage as NeedsStage;
    const status = p.status as NeedsProposalStatus;
    const amount = dec(p.fundedAmountNgn) ?? dec(p.approvedAmountNgn) ?? dec(p.costedAmountNgn) ?? dec(p.preliminaryAmountNgn);
    return {
      proposalId: p.id,
      reference: p.reference,
      title: p.title,
      cycleId: p.cycleId,
      interventionYear: p.cycle.interventionYear,
      projectTypeName: p.cycle.projectType.name,
      route: p.route as NeedsProposalRoute,
      stateCode: p.stateCode,
      lgaCodes: p.lgaCodes,
      stage,
      status,
      statusLabel: proposalStatusLabel({ stage, status }, cycleConfig(p.cycle)),
      amountNgn: amount,
      projectId: p.project?.id ?? null,
      projectCode: p.project ? formatProjectCode(p.project.codePrefix) : null,
      projectStatus: p.project?.status ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// The project's origin
// ---------------------------------------------------------------------------

async function projectWithProposal(user: WebJwtPayload, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantId: user.tenantId },
    select: { id: true, origin: true, needsProposalId: true },
  });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  return project;
}

const VERSION_KIND = 'NEEDS_ASSESSMENT_VERSION';

export async function getProjectNeedsOrigin(user: WebJwtPayload, projectId: string): Promise<ProjectNeedsOriginDto> {
  const project = await projectWithProposal(user, projectId);
  const origin = (project.origin as ProjectOrigin | null) ?? null;
  const base: ProjectNeedsOriginDto = { projectId: project.id, origin, originLabel: origin ? PROJECT_ORIGIN_LABELS[origin] : 'No origin', proposal: null, documents: [], breakdown: [] };
  if (!project.needsProposalId) return base;
  const p = await prisma.needsProposal.findUnique({
    where: { id: project.needsProposalId },
    include: {
      cycle: { include: { projectType: { select: { name: true } } } },
      currentVersion: { select: { parsedJson: true } },
      versions: { orderBy: { number: 'asc' } },
      documents: true,
    },
  });
  if (!p || p.tenantId !== user.tenantId) return base;
  const cycleDocs = await prisma.needsCycleDocument.findMany({ where: { cycleId: p.cycleId, coveredProposalIds: { has: p.id } } });
  const canSeeCycle = holds(user, 'needs:view') && (await prisma.needsCycle.count({ where: { AND: [{ id: p.cycleId }, visibleCycleWhere(user)] } })) > 0;
  const stage = p.stage as NeedsStage;
  const status = p.status as NeedsProposalStatus;
  const reason = OutOfCycleReasonEnum.safeParse(p.outOfCycleReason);

  const superseded = (rows: Array<{ supersedesId: string | null }>) => new Set(rows.map((r) => r.supersedesId).filter((id): id is string => Boolean(id)));
  const replacedProposalDocs = superseded(p.documents);
  const replacedCycleDocs = superseded(cycleDocs);
  const documents: ProjectNeedsDocument[] = [
    ...currentFirst(p.documents)
      .filter((d) => !replacedProposalDocs.has(d.id))
      .map((d) => ({
        id: d.id,
        scope: 'PROPOSAL' as const,
        kind: d.kind,
        kindLabel: PROPOSAL_DOCUMENT_KIND_LABELS[d.kind as ProposalDocumentKind] ?? d.kind,
        title: d.title,
        fileName: d.fileName,
        mimeType: d.mimeType,
        byteSize: d.byteSize,
        uploadedByName: d.uploadedByName,
        uploadedAt: d.createdAt.toISOString(),
      })),
    ...p.versions.map((v) => ({
      id: v.id,
      scope: 'VERSION' as const,
      kind: VERSION_KIND,
      kindLabel: 'Needs assessment',
      title: `${p.reference} needs assessment, version ${v.number}`,
      fileName: v.fileName,
      mimeType: v.mimeType,
      byteSize: v.byteSize,
      uploadedByName: v.uploadedByName,
      uploadedAt: v.uploadedAt.toISOString(),
    })),
    ...currentFirst(cycleDocs)
      .filter((d) => !replacedCycleDocs.has(d.id))
      .map((d) => ({
        id: d.id,
        scope: 'CYCLE' as const,
        kind: d.kind,
        kindLabel: CYCLE_DOCUMENT_KIND_META[d.kind as CycleDocumentKind]?.label ?? d.kind,
        title: d.title,
        fileName: d.fileName,
        mimeType: d.mimeType,
        byteSize: d.byteSize,
        uploadedByName: d.uploadedByName,
        uploadedAt: d.createdAt.toISOString(),
      })),
  ];
  return {
    ...base,
    proposal: {
      id: p.id,
      reference: p.reference,
      title: p.title,
      route: p.route as NeedsProposalRoute,
      cycleId: p.cycleId,
      interventionYear: p.cycle.interventionYear,
      projectTypeName: p.cycle.projectType.name,
      status,
      statusLabel: proposalStatusLabel({ stage, status }, cycleConfig(p.cycle)),
      costedAmountNgn: dec(p.costedAmountNgn),
      approvedAmountNgn: dec(p.approvedAmountNgn),
      fundedAmountNgn: dec(p.fundedAmountNgn),
      rank: p.rank,
      versionCount: p.versions.length,
      outOfCycleReason: reason.success ? reason.data : null,
      outOfCycleReasonLabel: reason.success ? OUT_OF_CYCLE_REASON_LABELS[reason.data] : null,
      canOpenProposal: canSeeCycle,
    },
    documents,
    breakdown: parsedOf(p.currentVersion?.parsedJson)?.breakdownRows ?? [],
  };
}

const DOCUMENT_NOT_FOUND = () => new AppError('Document not found', 404, 'NEEDS_DOCUMENT_NOT_FOUND');

export async function projectNeedsOriginFile(user: WebJwtPayload, projectId: string, scope: string, id: string): Promise<NeedsFileLinkDto> {
  const project = await projectWithProposal(user, projectId);
  if (!project.needsProposalId || !isUuid(id)) throw DOCUMENT_NOT_FOUND();
  const proposal = await prisma.needsProposal.findFirst({ where: { id: project.needsProposalId, tenantId: user.tenantId }, select: { id: true, cycleId: true } });
  if (!proposal) throw DOCUMENT_NOT_FOUND();
  if (scope === 'PROPOSAL') {
    const d = await prisma.needsProposalDocument.findFirst({ where: { id, proposalId: proposal.id } });
    if (d) return fileLink(d.objectKey, d.fileName);
  } else if (scope === 'VERSION') {
    const v = await prisma.needsAssessmentVersion.findFirst({ where: { id, proposalId: proposal.id } });
    if (v) return fileLink(v.objectKey, v.fileName);
  } else if (scope === 'CYCLE') {
    const d = await prisma.needsCycleDocument.findFirst({ where: { id, cycleId: proposal.cycleId, coveredProposalIds: { has: proposal.id } } });
    if (d) return fileLink(d.objectKey, d.fileName);
  }
  throw DOCUMENT_NOT_FOUND();
}
