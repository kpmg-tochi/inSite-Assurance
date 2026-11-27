import { Prisma } from '@prisma/client';
import {
  NeedsDeadlineSchema,
  PROPOSAL_FLAG_KIND_META,
  type CycleDocumentKind,
  type NeedsAssessmentVersionDto,
  type NeedsCycleDocumentDto,
  type NeedsCycleSummaryDto,
  type NeedsDeadline,
  type NeedsFundingGate,
  type NeedsPipelineConfig,
  type NeedsProposalDocumentDto,
  type NeedsVersionSource,
  type ProposalDocumentKind,
  type ProposalFlagDto,
  type ProposalFlagKind,
  type ProposalFlagResolution,
} from '@insite/shared';
import { dec } from './needsSupport';

/** Needs pipeline wave 2: explicit serializers (never spread Prisma rows; Decimal → number). */

type FlagRow = Prisma.NeedsProposalFlagGetPayload<object>;

export function serializeFlag(f: FlagRow): ProposalFlagDto {
  const kind = f.kind as ProposalFlagKind;
  return {
    id: f.id,
    proposalId: f.proposalId,
    kind,
    label: PROPOSAL_FLAG_KIND_META[kind]?.label ?? f.kind,
    details: f.detailsJson && typeof f.detailsJson === 'object' && !Array.isArray(f.detailsJson) ? (f.detailsJson as Record<string, unknown>) : {},
    raisedOnVersion: f.raisedOnVersionNumber,
    raisedAt: f.raisedAt.toISOString(),
    resolved: f.resolvedAt !== null,
    resolution: (f.resolution as ProposalFlagResolution | null) ?? null,
    resolutionReason: f.resolutionReason,
    resolvedByName: f.resolvedByName,
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
  };
}

type VersionRow = Prisma.NeedsAssessmentVersionGetPayload<{ include: { costingStandardVersion: { select: { version: true } } } }>;

export function serializeVersion(v: VersionRow, currentVersionId: string | null): NeedsAssessmentVersionDto {
  return {
    id: v.id,
    proposalId: v.proposalId,
    number: v.number,
    source: v.source as NeedsVersionSource,
    fileName: v.fileName,
    byteSize: v.byteSize,
    sha256: v.sha256,
    templateVersion: v.templateVersion,
    costingStandardVersion: v.costingStandardVersion?.version ?? null,
    siteCount: v.siteCount,
    breakdownRowCount: v.breakdownRowCount,
    boqLineCount: v.boqLineCount,
    preliminaryCostNgn: dec(v.preliminaryCostNgn),
    costedTotalNgn: dec(v.costedTotalNgn),
    uploadedByUserId: v.uploadedByUserId,
    uploadedByName: v.uploadedByName,
    uploadedAt: v.uploadedAt.toISOString(),
    isCurrent: v.id === currentVersionId,
  };
}

type CycleDocRow = Prisma.NeedsCycleDocumentGetPayload<object>;

export function serializeCycleDocument(d: CycleDocRow): NeedsCycleDocumentDto {
  return {
    id: d.id,
    kind: d.kind as CycleDocumentKind,
    title: d.title,
    generated: d.generated,
    fileName: d.fileName,
    mimeType: d.mimeType,
    byteSize: d.byteSize,
    sha256: d.sha256,
    supersedesId: d.supersedesId,
    proposalIds: d.coveredProposalIds,
    uploadedByName: d.uploadedByName,
    uploadedAt: d.createdAt.toISOString(),
  };
}

type ProposalDocRow = Prisma.NeedsProposalDocumentGetPayload<object>;

export function serializeProposalDocument(d: ProposalDocRow): NeedsProposalDocumentDto {
  return {
    id: d.id,
    kind: d.kind as ProposalDocumentKind,
    title: d.title,
    fileName: d.fileName,
    mimeType: d.mimeType,
    byteSize: d.byteSize,
    sha256: d.sha256,
    supersedesId: d.supersedesId,
    uploadedByName: d.uploadedByName,
    uploadedAt: d.createdAt.toISOString(),
  };
}

/** Current versions first (not superseded by another row of the list), each group newest first. */
export function currentFirst<T extends { id: string; supersedesId: string | null; createdAt: Date }>(rows: T[]): T[] {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter((id): id is string => Boolean(id)));
  const newest = (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();
  return [...rows.filter((r) => !superseded.has(r.id)).sort(newest), ...rows.filter((r) => superseded.has(r.id)).sort(newest)];
}

type CycleSummaryRow = Prisma.NeedsCycleGetPayload<{
  include: { projectType: { select: { name: true } }; owningOrganization: { select: { name: true } }; _count: { select: { proposals: true } } };
}>;

export function serializeCycleSummary(c: CycleSummaryRow, config: NeedsPipelineConfig): NeedsCycleSummaryDto {
  return {
    id: c.id,
    projectTypeId: c.projectTypeId,
    projectTypeName: c.projectType.name,
    interventionYear: c.interventionYear,
    stateCode: c.stateCode,
    owningOrganizationId: c.owningOrganizationId,
    owningOrganizationName: c.owningOrganization.name,
    status: c.status as NeedsCycleSummaryDto['status'],
    fundingGate: config.fundingGate as NeedsFundingGate,
    proposalCount: c._count.proposals,
    openedAt: c.openedAt ? c.openedAt.toISOString() : null,
    closedAt: c.closedAt ? c.closedAt.toISOString() : null,
  };
}

export function deadlinesOf(json: Prisma.JsonValue): NeedsDeadline[] {
  const r = NeedsDeadlineSchema.array().safeParse(json ?? []);
  return r.success ? r.data : [];
}
