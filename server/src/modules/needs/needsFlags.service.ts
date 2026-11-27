import { Prisma } from '@prisma/client';
import {
  NEEDS_OPEN_PROPOSAL_STATUSES,
  PROPOSAL_FLAG_KIND_META,
  ceilingBreaches,
  essentialFacilityGaps,
  findDuplicateMatches,
  hasSupervisionLine,
  rateVariances,
  zoneOfState,
  type CostingStandard,
  type DuplicateCandidate,
  type NeedsPipelineConfig,
  type ParsedNeedsAssessment,
  type ProposalFlagDto,
  type ProposalFlagKind,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { projectAccessBranch } from '../../utils/accessControl';
import { recordAuditEvent } from '../audit/audit.service';
import { NEEDS_SYSTEM_ACTOR, visibleCycleWhere, type Db } from './needsAccess';
import { serializeFlag } from './needsSerializers';

/**
 * Needs pipeline wave 2 (B7): the flags a needs assessment version raises. Flags never block an
 * upload; they are resolved later (wave 3). On each new version:
 * - a kind that still applies keeps its open flag (details refreshed, raised-on version unchanged);
 * - a kind that applies with no open flag gets a new one, raised on this version;
 * - an open flag whose condition no longer holds is resolved CORRECTED by "System (needs)";
 * - SEPARATION_OVERRIDE flags are never touched.
 */

/** The kinds this module raises and clears. */
export const VERSION_FLAG_KINDS: readonly ProposalFlagKind[] = ['DUPLICATE', 'ESSENTIAL_FACILITY_GAP', 'RATE_VARIANCE', 'CEILING_EXCEEDED', 'MISSING_SUPERVISION_LINE'];

export interface FlagFinding {
  kind: ProposalFlagKind;
  details: Record<string, unknown>;
  /** One sentence for the upload preview. */
  message: string;
}

export interface FlagContext {
  tenantId: string;
  config: Pick<NeedsPipelineConfig, 'essentialFacilityGroups' | 'rateVarianceTolerancePct' | 'duplicateRadiusMeters' | 'duplicateLookbackYears'>;
  /** The costing standard the cycle uses; null skips the rate and ceiling checks. */
  standard: { version: number; standard: CostingStandard } | null;
  /** The proposal's State (zone factor of the rates). */
  stateCode: string | null;
  /** The proposal itself (never its own duplicate); null for a new one. */
  proposalId: string | null;
  /** A pre-v2 file has no breakdown: the essential-facility check cannot be read from it. */
  isLegacyTemplate: boolean;
  now?: Date;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const METRES_PER_DEGREE = 111_320;

async function duplicateCandidates(db: Db, ctx: FlagContext, parsed: ParsedNeedsAssessment): Promise<DuplicateCandidate[]> {
  if (!parsed.sites.length) return [];
  const lgaCodes = [...new Set(parsed.sites.map((s) => s.lgaCode))];
  const located = parsed.sites.filter((s) => s.latitude !== null && s.longitude !== null);
  const near: Array<{ latitude: { gte: number; lte: number }; longitude: { gte: number; lte: number } }> = located.map((s) => {
    const dLat = ctx.config.duplicateRadiusMeters / METRES_PER_DEGREE + 1e-6;
    const dLng = ctx.config.duplicateRadiusMeters / (METRES_PER_DEGREE * Math.max(0.1, Math.cos(((s.latitude as number) * Math.PI) / 180))) + 1e-6;
    return {
      latitude: { gte: (s.latitude as number) - dLat, lte: (s.latitude as number) + dLat },
      longitude: { gte: (s.longitude as number) - dLng, lte: (s.longitude as number) + dLng },
    };
  });
  const placeWhere = [{ lgaCode: { in: lgaCodes } }, ...near];

  const proposalSites = await db.needsProposalSite.findMany({
    where: {
      OR: placeWhere,
      proposal: {
        tenantId: ctx.tenantId,
        status: { in: [...NEEDS_OPEN_PROPOSAL_STATUSES] },
        ...(ctx.proposalId ? { id: { not: ctx.proposalId } } : {}),
      },
    },
    select: { siteNumber: true, schoolName: true, lgaCode: true, latitude: true, longitude: true, proposal: { select: { id: true, reference: true } } },
  });
  const since = new Date((ctx.now ?? new Date()).getTime());
  since.setUTCFullYear(since.getUTCFullYear() - ctx.config.duplicateLookbackYears);
  const projectSites = await db.projectSite.findMany({
    where: { OR: placeWhere, createdAt: { gte: since }, project: { tenantId: ctx.tenantId } },
    select: { siteNumber: true, schoolName: true, lgaCode: true, latitude: true, longitude: true, project: { select: { id: true, codePrefix: true } } },
  });
  return [
    ...proposalSites.map((s) => ({
      source: 'PROPOSAL' as const,
      id: s.proposal.id,
      reference: s.proposal.reference,
      siteNumber: s.siteNumber,
      schoolName: s.schoolName,
      lgaCode: s.lgaCode,
      latitude: s.latitude,
      longitude: s.longitude,
    })),
    ...projectSites.map((s) => ({
      source: 'PROJECT' as const,
      id: s.project.id,
      reference: s.project.codePrefix,
      siteNumber: s.siteNumber,
      schoolName: s.schoolName,
      lgaCode: s.lgaCode,
      latitude: s.latitude,
      longitude: s.longitude,
    })),
  ];
}

/** What the version raises (preview: `expectedFlags`; confirm: `applyFlagFindings`). */
export async function computeFlagFindings(db: Db, ctx: FlagContext, parsed: ParsedNeedsAssessment): Promise<FlagFinding[]> {
  const out: FlagFinding[] = [];

  // DUPLICATE (D-N.16).
  const candidates = await duplicateCandidates(db, ctx, parsed);
  const matches = parsed.sites.flatMap((site) =>
    findDuplicateMatches(site, candidates, ctx.config.duplicateRadiusMeters).map((m) => ({
      siteNumber: site.siteNumber,
      schoolName: site.schoolName,
      kind: m.candidate.source === 'PROPOSAL' ? 'PROPOSAL' : 'PROJECT_SITE',
      id: m.candidate.id,
      reference: m.candidate.reference,
      matchedSchoolName: m.candidate.schoolName,
      matchedSiteNumber: m.candidate.siteNumber,
      reason: m.sameSchool && m.withinRadius ? 'SAME_SCHOOL_AND_NEARBY' : m.sameSchool ? 'SAME_SCHOOL' : 'NEARBY',
      distanceMeters: m.distanceMeters,
    }))
  );
  if (matches.length) {
    const refs = [...new Set(matches.map((m) => m.reference))];
    out.push({
      kind: 'DUPLICATE',
      details: { matches, radiusMeters: ctx.config.duplicateRadiusMeters, lookbackYears: ctx.config.duplicateLookbackYears },
      message: `Possible duplicate of ${refs.join(', ')} (${plural(matches.length, 'matching site')}).`,
    });
  }

  // ESSENTIAL_FACILITY_GAP (D-N.17). A pre-v2 file has no breakdown to read.
  if (!ctx.isLegacyTemplate && ctx.config.essentialFacilityGroups.length) {
    const gaps = essentialFacilityGaps(parsed.breakdownRows, parsed.sites, ctx.config.essentialFacilityGroups);
    if (gaps.length) {
      const groups = [...new Set(gaps.map((g) => g.groupLabel))];
      out.push({
        kind: 'ESSENTIAL_FACILITY_GAP',
        details: { gaps },
        message: `Essential facilities missing at ${plural(new Set(gaps.map((g) => g.siteNumber)).size, 'site')}: ${groups.join(', ')}. A written justification is needed before validation.`,
      });
    }
  }

  const zone = zoneOfState(ctx.stateCode);
  if (ctx.standard) {
    // RATE_VARIANCE (D-N.8).
    const variances = rateVariances(parsed.boqLines, ctx.standard.standard, zone, ctx.config.rateVarianceTolerancePct);
    if (variances.length) {
      out.push({
        kind: 'RATE_VARIANCE',
        details: { variances, tolerancePct: ctx.config.rateVarianceTolerancePct, zone, costingStandardVersion: ctx.standard.version },
        message: `${plural(variances.length, 'BoQ rate')} differ from costing standard v${ctx.standard.version} by more than ${ctx.config.rateVarianceTolerancePct}%.`,
      });
    }
    // CEILING_EXCEEDED.
    const breaches = ceilingBreaches(parsed.breakdownRows, parsed.boqLines, ctx.standard.standard);
    if (breaches.length) {
      out.push({
        kind: 'CEILING_EXCEEDED',
        details: { breaches, costingStandardVersion: ctx.standard.version },
        message: `${plural(breaches.length, 'facility', 'facilities')} cost more per unit than the costing standard's ceiling (${breaches.map((b) => b.unitId).join(', ')}).`,
      });
    }
  }

  // MISSING_SUPERVISION_LINE (D-N.18).
  // A version is costed once it has BoQ lines or a costing summary with an amount; a draft without either is not checked.
  if ((parsed.boqLines.length > 0 || (parsed.costingSummary?.subtotalNgn ?? 0) > 0) && !hasSupervisionLine(parsed.costingSummary)) {
    out.push({
      kind: 'MISSING_SUPERVISION_LINE',
      details: { costingSummary: parsed.costingSummary },
      message: 'The costing summary has no supervision and monitoring line.',
    });
  }
  return out;
}

/**
 * Applies the findings of a new version to the proposal's flags (rule in the header), in the
 * version's transaction. Returns the proposal's open flags afterwards.
 */
export async function applyFlagFindings(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; cycleId: string; proposalId: string; reference: string; versionId: string; versionNumber: number; findings: FlagFinding[] }
): Promise<ProposalFlagDto[]> {
  const open = await tx.needsProposalFlag.findMany({ where: { proposalId: params.proposalId, resolvedAt: null, kind: { in: [...VERSION_FLAG_KINDS] } } });
  const now = new Date();
  for (const kind of VERSION_FLAG_KINDS) {
    const finding = params.findings.find((f) => f.kind === kind);
    const existing = open.filter((f) => f.kind === kind);
    if (finding) {
      if (existing.length) {
        await tx.needsProposalFlag.updateMany({ where: { id: { in: existing.map((f) => f.id) } }, data: { detailsJson: finding.details as Prisma.InputJsonValue } });
      } else {
        await tx.needsProposalFlag.create({
          data: {
            proposalId: params.proposalId,
            kind,
            detailsJson: finding.details as Prisma.InputJsonValue,
            raisedOnVersionId: params.versionId,
            raisedOnVersionNumber: params.versionNumber,
            raisedAt: now,
          },
        });
      }
    } else if (existing.length) {
      const reason = `No longer found on version ${params.versionNumber}.`;
      await tx.needsProposalFlag.updateMany({
        where: { id: { in: existing.map((f) => f.id) } },
        data: { resolvedAt: now, resolvedByUserId: null, resolvedByName: NEEDS_SYSTEM_ACTOR.actorDisplayName, resolution: 'CORRECTED', resolutionReason: reason },
      });
      for (const flag of existing) {
        await recordAuditEvent(tx, {
          tenantId: params.tenantId,
          projectId: null,
          ...NEEDS_SYSTEM_ACTOR,
          action: 'NEEDS_FLAG_RESOLVED',
          summaryText: `${PROPOSAL_FLAG_KIND_META[kind].label} on ${params.reference} resolved as corrected: ${reason}`,
          payload: { cycleId: params.cycleId, proposalId: params.proposalId, reference: params.reference, flagId: flag.id, kind, resolution: 'CORRECTED', versionNumber: params.versionNumber },
        });
      }
    }
  }
  const after = await tx.needsProposalFlag.findMany({ where: { proposalId: params.proposalId, resolvedAt: null }, orderBy: { raisedAt: 'asc' } });
  return after.map(serializeFlag);
}


// ---------------------------------------------------------------------------
// Review fix (wave 2): duplicate matches are found across the tenant (D-N.16: the same school must
// not be funded twice, whichever cycle or project has it), but a viewer only sees the reference,
// id and school of a match they can open. The rest read "a proposed project in another cycle" /
// "a project you cannot open"; the flag, its reason and distance stay.
// ---------------------------------------------------------------------------

interface DuplicateMatchDetail {
  kind?: unknown;
  id?: unknown;
  reference?: unknown;
  [key: string]: unknown;
}

const HIDDEN_PROPOSAL = 'a proposed project in a cycle you cannot open';
const HIDDEN_PROJECT = 'a project you cannot open';

async function visibleMatchIds(user: WebJwtPayload, matches: DuplicateMatchDetail[]): Promise<Set<string>> {
  const proposalIds = [...new Set(matches.filter((m) => m.kind === 'PROPOSAL' && typeof m.id === 'string').map((m) => m.id as string))];
  const projectIds = [...new Set(matches.filter((m) => m.kind === 'PROJECT_SITE' && typeof m.id === 'string').map((m) => m.id as string))];
  const visible = new Set<string>();
  if (proposalIds.length) {
    const rows = await prisma.needsProposal.findMany({ where: { id: { in: proposalIds }, cycle: visibleCycleWhere(user) }, select: { id: true } });
    rows.forEach((r) => visible.add(r.id));
  }
  if (projectIds.length) {
    const branch = projectAccessBranch(user);
    const rows = await prisma.project.findMany({
      where: { AND: [{ id: { in: projectIds }, tenantId: user.tenantId }, ...(branch ? [branch] : [])] },
      select: { id: true },
    });
    rows.forEach((r) => visible.add(r.id));
  }
  return visible;
}

function redactMatch(m: DuplicateMatchDetail, visible: Set<string>): DuplicateMatchDetail {
  if (typeof m.id === 'string' && visible.has(m.id)) return m;
  return {
    ...m,
    id: null,
    reference: null,
    matchedSchoolName: null,
    matchedSiteNumber: null,
    hidden: true,
    label: m.kind === 'PROJECT_SITE' ? HIDDEN_PROJECT : HIDDEN_PROPOSAL,
  };
}

const matchesOf = (details: Record<string, unknown>): DuplicateMatchDetail[] =>
  Array.isArray(details.matches) ? (details.matches as DuplicateMatchDetail[]).filter((m) => m && typeof m === 'object') : [];

/** Flags as one viewer may see them (duplicate matches outside their reach redacted). */
export async function redactFlagsForViewer(user: WebJwtPayload, flags: ProposalFlagDto[]): Promise<ProposalFlagDto[]> {
  const all = flags.filter((f) => f.kind === 'DUPLICATE').flatMap((f) => matchesOf(f.details));
  if (!all.length) return flags;
  const visible = await visibleMatchIds(user, all);
  return flags.map((f) => (f.kind === 'DUPLICATE' ? { ...f, details: { ...f.details, matches: matchesOf(f.details).map((m) => redactMatch(m, visible)) } } : f));
}

/** The preview's flag sentences for the uploader (references they cannot open are not named). */
export async function expectedFlagsForViewer(user: WebJwtPayload, findings: FlagFinding[]): Promise<Array<{ kind: ProposalFlagKind; message: string }>> {
  const out: Array<{ kind: ProposalFlagKind; message: string }> = [];
  for (const f of findings) {
    if (f.kind !== 'DUPLICATE') {
      out.push({ kind: f.kind, message: f.message });
      continue;
    }
    const matches = matchesOf(f.details);
    const visible = await visibleMatchIds(user, matches);
    const names = [...new Set(matches.map((m) => (typeof m.id === 'string' && visible.has(m.id) ? String(m.reference) : m.kind === 'PROJECT_SITE' ? HIDDEN_PROJECT : HIDDEN_PROPOSAL)))];
    out.push({ kind: f.kind, message: `Possible duplicate of ${names.join(', ')} (${plural(matches.length, 'matching site')}).` });
  }
  return out;
}
