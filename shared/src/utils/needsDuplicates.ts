import { distanceMeters } from '../geo/geofence';

/**
 * Needs pipeline N1: duplicate detection (D-N.16), pure. A site of a new needs assessment version is
 * compared with the sites of other open proposals and of projects created in the look-back period:
 * the same school (normalised name and LGA) or a location within the radius is a match. A match
 * raises a flag, never a block; the validator resolves it.
 */

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bpri\b|\bprim\b|\bpry\b/g, 'primary'],
  [/\bsch\b|\bschl\b/g, 'school'],
  [/\bsec\b/g, 'secondary'],
  [/\bjnr\b|\bjr\b/g, 'junior'],
  [/\bsnr\b|\bsr\b/g, 'senior'],
  [/\bjss\b/g, 'junior secondary school'],
  [/\bcomm\b/g, 'community'],
  [/\bgovt\b|\bgov\b/g, 'government'],
  [/\bst\b/g, 'saint'],
  [/\bl\s*g\s*e\s*a\b/g, 'lgea'],
  [/\bl\s*e\s*a\b/g, 'lea'],
];

/**
 * A school name reduced for comparison: lower case, accents and punctuation removed, common
 * abbreviations spelt out, spaces collapsed. "L.E.A. Pri. Sch., Garki" → "lea primary school garki".
 */
export function normaliseSchoolName(name: string | null | undefined): string {
  let n = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (const [pattern, full] of ABBREVIATIONS) n = n.replace(pattern, full);
  return n.replace(/\s+/g, ' ').trim();
}

export interface DuplicateSite {
  schoolName: string;
  lgaCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DuplicateCandidate extends DuplicateSite {
  /** Where the candidate site is: another proposed project or a project. */
  source: 'PROPOSAL' | 'PROJECT';
  /** Proposal or project id. */
  id: string;
  /** Proposal reference or project code, for the flag text. */
  reference: string;
  siteNumber: number | null;
}

export interface DuplicateMatch {
  candidate: DuplicateCandidate;
  sameSchool: boolean;
  /** Metres between the two locations; null when either has none. */
  distanceMeters: number | null;
  withinRadius: boolean;
}

/**
 * The candidates that match `site`: same normalised school name in the same LGA, or a location
 * within `radiusMeters`. Same-school matches come first, then the nearest.
 */
export function findDuplicateMatches(site: DuplicateSite, candidates: readonly DuplicateCandidate[], radiusMeters: number): DuplicateMatch[] {
  const name = normaliseSchoolName(site.schoolName);
  const located = site.latitude !== null && site.longitude !== null;
  const out: DuplicateMatch[] = [];
  for (const candidate of candidates) {
    const sameSchool =
      name.length > 0 &&
      Boolean(site.lgaCode) &&
      site.lgaCode === candidate.lgaCode &&
      normaliseSchoolName(candidate.schoolName) === name;
    const distance =
      located && candidate.latitude !== null && candidate.longitude !== null
        ? Math.round(
            distanceMeters(
              { latitude: site.latitude as number, longitude: site.longitude as number },
              { latitude: candidate.latitude, longitude: candidate.longitude }
            )
          )
        : null;
    const withinRadius = distance !== null && distance <= radiusMeters;
    if (sameSchool || withinRadius) out.push({ candidate, sameSchool, distanceMeters: distance, withinRadius });
  }
  return out.sort(
    (a, b) => Number(b.sameSchool) - Number(a.sameSchool) || (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY)
  );
}
