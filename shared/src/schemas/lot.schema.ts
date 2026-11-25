import { z } from 'zod';

/**
 * Project lots (client demo updates C3). A lot is a category of project within an intervention
 * year ("Renovation, Equipment and Furnishings of Public Schools"); lots are numbered in order per
 * year, and the projects of a lot are its batches. The project code is
 * `{year}-LOT-{lot}-BATCH-{batch}` (see utils/projectCode.ts), assigned by the server in a
 * per-tenant advisory lock when a draft is created with a `lotChoice`.
 */

export const LOT_TITLE_MAX = 200;

export const ProjectLotDtoSchema = z.object({
  id: z.string().uuid(),
  interventionYear: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  /** Projects (drafts included) in the lot. */
  projectCount: z.number().int(),
  /** The batch number the next project in this lot would take. */
  nextBatchNumber: z.number().int(),
});
export type ProjectLotDto = z.infer<typeof ProjectLotDtoSchema>;

/** Pick an existing lot of the project's intervention year, or create the next one with a title. */
export const LotChoiceSchema = z.union([
  z.object({ lotId: z.string().uuid() }).strict(),
  z
    .object({
      newLotTitle: z.string().trim().min(3, 'Enter the lot title, e.g. Renovation of Public Schools').max(LOT_TITLE_MAX),
    })
    .strict(),
]);
export type LotChoice = z.infer<typeof LotChoiceSchema>;

/** GET /api/v1/project-lots?interventionYear= (optional: adds that year to the allowed ones). */
export const ProjectLotsQuerySchema = z.object({
  interventionYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type ProjectLotsQuery = z.infer<typeof ProjectLotsQuerySchema>;

export const ProjectLotYearDtoSchema = z.object({
  interventionYear: z.number().int(),
  /** The number a new lot of this year would take. */
  nextLotNumber: z.number().int(),
  lots: z.array(ProjectLotDtoSchema),
});
export type ProjectLotYearDto = z.infer<typeof ProjectLotYearDtoSchema>;

export const ProjectLotListDtoSchema = z.object({
  /** Today in the tenant zone (YYYY-MM-DD). */
  today: z.string(),
  fiscalYearStartMonth: z.number().int(),
  /** The years a new project may take (allowedInterventionYears). */
  allowedInterventionYears: z.array(z.number().int()),
  /** One entry per allowed year, plus the requested year when given. */
  years: z.array(ProjectLotYearDtoSchema),
});
export type ProjectLotListDto = z.infer<typeof ProjectLotListDtoSchema>;

/** A project's lot, on the setup DTO. */
export const ProjectLotRefSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  title: z.string(),
  interventionYear: z.number().int(),
});
export type ProjectLotRef = z.infer<typeof ProjectLotRefSchema>;
