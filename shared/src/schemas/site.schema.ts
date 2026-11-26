import { z } from 'zod';
import { NigeriaLgaCodeSchema } from '../data/nigeriaAdminAreas';
import { ProjectGeofenceSchema } from './geofence.schema';

/**
 * Client demo updates C2 (wave 2, light version): multi-site projects. A project is one lot/batch
 * (one contract, one contractor, one state) delivered at several sites (schools). Sites carry the
 * school, its level, the LGA and a location; facility units name their site, so each site's
 * progress and status are computed from its units' lines (budget-weighted, as projects are).
 * Visits, check-in and handover stay per project in wave 2 (follow-ups).
 */

export const SchoolLevelEnum = z.enum(['ECCDE', 'PRIMARY', 'JSS']);
export type SchoolLevel = z.infer<typeof SchoolLevelEnum>;

export const SCHOOL_LEVEL_LABELS: Record<SchoolLevel, string> = {
  ECCDE: 'ECCDE',
  PRIMARY: 'Primary',
  JSS: 'Junior Secondary (JSS)',
};

export const SiteStatusEnum = z.enum(['NOT_STARTED', 'ONGOING', 'BEHIND', 'COMPLETED', 'HANDED_OVER']);
export type SiteStatus = z.infer<typeof SiteStatusEnum>;

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  NOT_STARTED: 'Not started',
  ONGOING: 'Ongoing',
  BEHIND: 'Behind',
  COMPLETED: 'Completed',
  HANDED_OVER: 'Handed over',
};

export const SITES_MAX = 50;

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);

/** One site in `PUT /projects/:id/setup/sites` (the full list; omitted sites are removed). */
export const ProjectSiteInputSchema = z.object({
  /** Existing site; omit to add. */
  id: z.string().uuid().optional(),
  schoolName: z.string().trim().min(3, 'Enter the school name').max(200),
  schoolLevel: SchoolLevelEnum,
  lgaCode: NigeriaLgaCodeSchema,
  /** Address as people write it (shown on reports; not geocoded in wave 2). */
  address: z.string().trim().max(300).nullable().optional(),
  latitude: Latitude.nullable().optional(),
  longitude: Longitude.nullable().optional(),
});
export type ProjectSiteInput = z.infer<typeof ProjectSiteInputSchema>;

/**
 * Section `sites` save. Rules (server): every LGA must be in the project's state (422
 * SITE_LGA_NOT_IN_STATE); a site a facility unit names cannot be removed (409 SITE_IN_USE); site
 * numbers follow list order; a located site gets a radial boundary of the workspace default radius.
 */
export const SaveProjectSitesRequestSchema = z
  .object({
    sites: z.array(ProjectSiteInputSchema).max(SITES_MAX, `Up to ${SITES_MAX} sites`),
  })
  .superRefine((v, ctx) => {
    v.sites.forEach((s, i) => {
      if ((s.latitude == null) !== (s.longitude == null)) {
        ctx.addIssue({ code: 'custom', path: ['sites', i, 'latitude'], message: 'Enter both latitude and longitude' });
      }
    });
  });
export type SaveProjectSitesRequest = z.infer<typeof SaveProjectSitesRequestSchema>;

/** A site on the register, the map and the overview. */
export const ProjectSiteSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  siteNumber: z.number().int(),
  schoolName: z.string(),
  schoolLevel: SchoolLevelEnum,
  lgaCode: z.string(),
  lgaName: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  /** Budget-weighted over the site's units' lines; null when the site has no lines. */
  progressPct: z.number().nullable(),
  status: SiteStatusEnum,
});
export type ProjectSiteSummaryDto = z.infer<typeof ProjectSiteSummaryDtoSchema>;

export const ProjectSiteDtoSchema = ProjectSiteSummaryDtoSchema.extend({
  address: z.string().nullable(),
  /** Radial boundary around the site (workspace default radius) when located. */
  boundary: ProjectGeofenceSchema.nullable(),
  located: z.boolean(),
  unitCount: z.number().int(),
  lineCount: z.number().int(),
  /** Planned amount of the site's lines (NGN). */
  amountNgn: z.number(),
});
export type ProjectSiteDto = z.infer<typeof ProjectSiteDtoSchema>;

/** GET /projects/:id/sites and the setup DTO's `sites` section. */
export const ProjectSitesDtoSchema = z.object({
  projectId: z.string().uuid(),
  stateCode: z.string().nullable(),
  defaultRadiusMeters: z.number().int(),
  sites: z.array(ProjectSiteDtoSchema),
});
export type ProjectSitesDto = z.infer<typeof ProjectSitesDtoSchema>;

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** Budget-weighted % complete of lines (`amount` × `pct`); null when there are no lines or no amount. */
export function weightedProgressPct(lines: { amountNgn: number; progressPct: number }[]): number | null {
  if (lines.length === 0) return null;
  const total = lines.reduce((s, l) => s + Math.max(0, l.amountNgn), 0);
  if (total <= 0) {
    const avg = lines.reduce((s, l) => s + l.progressPct, 0) / lines.length;
    return Math.round(avg * 100) / 100;
  }
  const done = lines.reduce((s, l) => s + Math.max(0, l.amountNgn) * Math.min(100, Math.max(0, l.progressPct)), 0);
  return Math.round((done / total) * 100) / 100;
}

export interface SiteStatusInput {
  /** Site % complete (null = no lines). */
  progressPct: number | null;
  /** A unit of the site whose end work phase has ended still has a line below 100%. */
  hasUnitBehind: boolean;
  /** The project has started work (activated and past its first work phase start, or progress > 0). */
  started: boolean;
  /** The project's handover has been accepted (handover is per project in wave 2). */
  handedOver: boolean;
}

/** Not started / Ongoing / Behind / Completed / Handed over (owner, against the client's register). */
export function deriveSiteStatus(input: SiteStatusInput): SiteStatus {
  if (input.handedOver) return 'HANDED_OVER';
  if (input.progressPct !== null && input.progressPct >= 100) return 'COMPLETED';
  if (input.hasUnitBehind) return 'BEHIND';
  if (!input.started && (input.progressPct ?? 0) <= 0) return 'NOT_STARTED';
  return 'ONGOING';
}

/**
 * Reads coordinates from what people paste: "9.0765, 7.3986", a Google Maps URL with `@lat,lng`,
 * `?q=lat,lng`, `ll=lat,lng`, `query=lat,lng` or `!3dlat!4dlng`. Short links (maps.app.goo.gl,
 * goo.gl/maps) cannot be read without following them: null (the form asks for the full link or
 * the coordinates).
 */
export function parseMapsLink(text: string | null | undefined): { latitude: number; longitude: number } | null {
  if (!text) return null;
  const t = decodeURIComponentSafe(text.trim());
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},\\s*${num}`),
    new RegExp(`[?&](?:q|query|ll|destination|center)=${num},\\s*${num}`),
    new RegExp(`^${num}\\s*[, ]\\s*${num}$`),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const latitude = Number(m[1]);
      const longitude = Number(m[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
        return { latitude, longitude };
      }
    }
  }
  return null;
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
