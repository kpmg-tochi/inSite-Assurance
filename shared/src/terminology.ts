import { z } from 'zod';

/**
 * Tenant terminology (Phase 11). The words the UI, PDFs and messages use for a few domain terms can
 * be changed per tenant ("Funder" → "Funding authority"). Keys are fixed here, values are tenant
 * text, and canonical values, enum names and API fields never change.
 */

export const TERMINOLOGY_DEFAULTS = {
  funderParty: { singular: 'Funder', plural: 'Funders' },
  monitorParty: { singular: 'Independent monitor', plural: 'Independent monitors' },
  contractor: { singular: 'Contractor', plural: 'Contractors' },
  beneficiary: { singular: 'Beneficiary', plural: 'Beneficiaries' },
  retention: { singular: 'Retention', plural: 'Retention' },
  // UBEC IRL: the client's own project ID (Project.externalReference).
  externalReference: { singular: 'Client project ID', plural: 'Client project IDs' },
} as const satisfies Record<string, { singular: string; plural: string }>;

export type TerminologyKey = keyof typeof TERMINOLOGY_DEFAULTS;
export const TERMINOLOGY_KEYS = Object.keys(TERMINOLOGY_DEFAULTS) as TerminologyKey[];

/** What each key means, for the settings editor. */
export const TERMINOLOGY_KEY_META: Record<TerminologyKey, { label: string; description: string }> = {
  funderParty: { label: 'Funding party', description: 'The organisation that funds the project.' },
  monitorParty: { label: 'Monitoring party', description: 'The independent organisation that monitors and certifies progress.' },
  contractor: { label: 'Contractor', description: 'The firm that builds the works.' },
  beneficiary: { label: 'Beneficiary', description: 'Who the project is for (a school, a community).' },
  retention: { label: 'Retention', description: 'The part of each payment held back until defects are cleared.' },
  externalReference: { label: 'Client project ID', description: "Your organisation's own reference for a project, kept beside its code (e.g. UBEC project ID)." },
};

export const TERM_MAX_LENGTH = 40;

const TermText = z.string().trim().min(1).max(TERM_MAX_LENGTH);

export const TerminologyEntrySchema = z
  .object({
    singular: TermText,
    /** Omitted: the singular is used for the plural too. */
    plural: TermText.optional(),
  })
  .strict();
export type TerminologyEntry = z.infer<typeof TerminologyEntrySchema>;

/** Partial map: a missing key falls back to the default. Unknown keys are rejected. */
export const TerminologyLabelsSchema = z
  .object(
    Object.fromEntries(TERMINOLOGY_KEYS.map((k) => [k, TerminologyEntrySchema.optional()])) as Record<
      TerminologyKey,
      z.ZodOptional<typeof TerminologyEntrySchema>
    >
  )
  .strict();
export type TerminologyLabels = z.infer<typeof TerminologyLabelsSchema>;

export const UpdateTerminologyRequestSchema = z.object({ labels: TerminologyLabelsSchema });
export type UpdateTerminologyRequest = z.infer<typeof UpdateTerminologyRequestSchema>;

export type ResolvedTerminology = Record<TerminologyKey, { singular: string; plural: string; isCustomized: boolean }>;

export const ResolvedTerminologySchema = z.object(
  Object.fromEntries(
    TERMINOLOGY_KEYS.map((k) => [k, z.object({ singular: z.string(), plural: z.string(), isCustomized: z.boolean() })])
  ) as Record<TerminologyKey, z.ZodObject<{ singular: z.ZodString; plural: z.ZodString; isCustomized: z.ZodBoolean }>>
);

export const TerminologySettingsDtoSchema = z.object({
  labels: TerminologyLabelsSchema,
  resolved: ResolvedTerminologySchema,
});
export type TerminologySettingsDto = z.infer<typeof TerminologySettingsDtoSchema>;

/** Stored JSON → validated overrides. Invalid entries are dropped rather than failing a page. */
export function parseTerminologyLabels(raw: unknown): TerminologyLabels {
  if (!raw || typeof raw !== 'object') return {};
  const out: TerminologyLabels = {};
  for (const key of TERMINOLOGY_KEYS) {
    const parsed = TerminologyEntrySchema.safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export function resolveTerminology(raw: unknown): ResolvedTerminology {
  const labels = parseTerminologyLabels(raw);
  return Object.fromEntries(
    TERMINOLOGY_KEYS.map((key) => {
      const custom = labels[key];
      const def = TERMINOLOGY_DEFAULTS[key];
      return [
        key,
        custom
          ? { singular: custom.singular, plural: custom.plural ?? custom.singular, isCustomized: true }
          : { singular: def.singular, plural: def.plural, isCustomized: false },
      ];
    })
  ) as ResolvedTerminology;
}

/** Lower-cases the first letter for use mid-sentence, leaving acronyms ("M&E") alone. */
export function termMidSentence(term: string): string {
  const firstWord = term.split(/\s+/)[0] ?? '';
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase()) return term;
  return term.charAt(0).toLowerCase() + term.slice(1);
}

/**
 * One term for display. `labels` is either the stored overrides or an already resolved map.
 * `lower` gives the mid-sentence form ("the funding authority").
 */
export function resolveTerm(
  labels: unknown,
  key: TerminologyKey,
  options: { plural?: boolean; lower?: boolean } = {}
): string {
  const entry = isResolved(labels) ? labels[key] : resolveTerminology(labels)[key];
  const term = options.plural ? entry.plural : entry.singular;
  return options.lower ? termMidSentence(term) : term;
}

function isResolved(v: unknown): v is ResolvedTerminology {
  if (!v || typeof v !== 'object') return false;
  const first = (v as Record<string, unknown>)[TERMINOLOGY_KEYS[0]];
  return Boolean(first && typeof first === 'object' && 'isCustomized' in (first as object));
}
