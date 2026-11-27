import { Prisma } from '@prisma/client';
import {
  NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS,
  NeedsSiteCoordinateCorrectionSchema,
  distanceMeters,
  normaliseSchoolName,
  type NeedsSiteCoordinateCorrection,
  type ParsedNeedsAssessment,
} from '@insite/shared';

/**
 * Needs pipeline wave 5 (N8): coordinate corrections from accepted field verifications outlive later
 * versions. A version rewrites the proposal's current sites from its file (`replaceCurrentTables`), so
 * a site corrected at Validation would lose its fix at the Design or Costing upload. After every such
 * rewrite the accepted corrections are applied again to the same site (site number and school name),
 * but only while the file still carries the uncorrected point (no point, or within the tolerance of the
 * correction's `from`): a file that gives a new point for the site wins. Conversion then reads the
 * current sites' coordinates (`overlayCurrentSiteCoordinates`).
 *
 * This file imports nothing from the needs services (needsVersions imports it).
 */

type Db = Prisma.TransactionClient;

const siteKey = (siteNumber: number, schoolName: string) => `${siteNumber}|${normaliseSchoolName(schoolName)}`;

/** The corrections stored on the proposal's accepted submissions, oldest first (a later one wins). */
export async function acceptedSiteCorrections(db: Db, proposalId: string): Promise<NeedsSiteCoordinateCorrection[]> {
  const rows = await db.needsVerificationSubmission.findMany({
    where: { status: 'ACCEPTED', verification: { proposalId }, siteCorrectionsJson: { not: Prisma.DbNull } },
    select: { siteCorrectionsJson: true },
    orderBy: { reviewedAt: 'asc' },
  });
  return rows.flatMap((r) => {
    const parsed = NeedsSiteCoordinateCorrectionSchema.array().safeParse(r.siteCorrectionsJson);
    return parsed.success ? parsed.data : [];
  });
}

/** Re-applies accepted corrections to the current sites (call after the sites were rewritten). Returns how many moved. */
export async function reapplyAcceptedSiteCorrectionsInTx(tx: Db, proposalId: string): Promise<number> {
  const corrections = await acceptedSiteCorrections(tx, proposalId);
  if (!corrections.length) return 0;
  const latest = new Map<string, NeedsSiteCoordinateCorrection>();
  for (const c of corrections) latest.set(siteKey(c.siteNumber, c.schoolName), c);
  const sites = await tx.needsProposalSite.findMany({ where: { proposalId } });
  let moved = 0;
  for (const site of sites) {
    const c = latest.get(`${site.siteNumber}|${site.schoolNameKey}`);
    if (!c) continue;
    const point = site.latitude !== null && site.longitude !== null ? { latitude: site.latitude, longitude: site.longitude } : null;
    const stale = !point || (c.from !== null && distanceMeters(c.from, point) <= NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS);
    if (!stale) continue;
    if (point && distanceMeters(point, c.to) < 0.01) continue;
    await tx.needsProposalSite.update({ where: { id: site.id }, data: { latitude: c.to.latitude, longitude: c.to.longitude } });
    moved += 1;
  }
  return moved;
}

/**
 * Conversion (N8): the version's parse with each site's coordinates taken from the proposal's current
 * site rows (same site number and school name), which carry the field corrections. A site without a
 * stored point keeps the file's.
 */
export async function overlayCurrentSiteCoordinates(tx: Db, proposalId: string, parsed: ParsedNeedsAssessment): Promise<ParsedNeedsAssessment> {
  const rows = await tx.needsProposalSite.findMany({ where: { proposalId }, select: { siteNumber: true, schoolNameKey: true, latitude: true, longitude: true } });
  if (!rows.length) return parsed;
  const byKey = new Map(rows.map((r) => [`${r.siteNumber}|${r.schoolNameKey}`, r]));
  return {
    ...parsed,
    sites: parsed.sites.map((s) => {
      const row = byKey.get(siteKey(s.siteNumber, s.schoolName));
      return row && row.latitude !== null && row.longitude !== null ? { ...s, latitude: row.latitude, longitude: row.longitude } : s;
    }),
  };
}
