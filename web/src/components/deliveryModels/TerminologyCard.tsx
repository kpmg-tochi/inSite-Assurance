import { useEffect } from "react";
import { z } from "zod";
import {
  TERM_MAX_LENGTH,
  TERMINOLOGY_DEFAULTS,
  TERMINOLOGY_KEY_META,
  TERMINOLOGY_KEYS,
  UpdateTerminologyRequestSchema,
  type TerminologyKey,
  type TerminologyLabels,
} from "@insite/shared";
import { useTerminologyQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { useUpdateTerminologyMutation } from "../../mutations/deliveryModels/useDeliveryModelMutations";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import Loader from "../Loader";

const TermInput = z.string().trim().max(TERM_MAX_LENGTH, `Use at most ${TERM_MAX_LENGTH} characters`);

/** One singular/plural pair per key; empty fields use the default word. Mapped to UpdateTerminologyRequestSchema. */
const TerminologyFormSchema = z
  .object(
    Object.fromEntries(TERMINOLOGY_KEYS.map((k) => [k, z.object({ singular: TermInput, plural: TermInput })])) as Record<
      TerminologyKey,
      z.ZodObject<{ singular: typeof TermInput; plural: typeof TermInput }>
    >
  )
  .transform((draft) => {
    const labels: TerminologyLabels = {};
    for (const k of TERMINOLOGY_KEYS) {
      const { singular, plural } = draft[k];
      if (singular) labels[k] = plural ? { singular, plural } : { singular };
    }
    return { labels };
  })
  .pipe(UpdateTerminologyRequestSchema);
type Draft = z.input<typeof TerminologyFormSchema>;

const emptyDraft = (labels?: TerminologyLabels): Draft =>
  Object.fromEntries(
    TERMINOLOGY_KEYS.map((k) => [k, { singular: labels?.[k]?.singular ?? "", plural: labels?.[k]?.plural ?? "" }])
  ) as Draft;

/**
 * Phase 11: tenant wording for domain terms. Display only: stored values and API fields
 * keep the canonical names. Empty fields use the default word.
 */
export function TerminologyCard() {
  const { data, isLoading } = useTerminologyQuery(true);
  const save = useUpdateTerminologyMutation();
  const form = useZodForm(TerminologyFormSchema, { defaultValues: emptyDraft() });
  const { register, reset, watch, handleSubmit } = form;
  const draft = watch();

  useEffect(() => {
    if (!data) return;
    reset(emptyDraft(data.labels));
  }, [data, reset]);

  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex justify-center">
        <Loader size="sm" inline />
      </div>
    );
  }

  const onSave = handleSubmit((payload) => save.mutate(payload));

  // Live preview of a few sentences with the draft words.
  const word = (k: TerminologyKey, plural = false) => {
    const d = draft[k] ?? { singular: "", plural: "" };
    const singular = d.singular.trim() || TERMINOLOGY_DEFAULTS[k].singular;
    return plural ? d.plural.trim() || (d.singular.trim() ? singular : TERMINOLOGY_DEFAULTS[k].plural) : singular;
  };

  return (
    <form onSubmit={onSave} noValidate className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Terminology</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Change the words the portal, PDFs and messages use for these terms. Stored data and exports keep the standard
          names. Leave a field empty to use the default.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {TERMINOLOGY_KEYS.map((k) => {
          const singularName = `${k}.singular` as const;
          const pluralName = `${k}.plural` as const;
          const hasSingular = Boolean(draft[k]?.singular.trim());
          return (
            <div key={k} className="grid grid-cols-1 md:grid-cols-[220px_1fr_1fr] gap-2 items-start rounded-xl border border-slate-200 p-3 text-xs">
              <div>
                <p className="font-semibold text-slate-800">{TERMINOLOGY_KEY_META[k].label}</p>
                <p className="text-[11px] text-slate-500">{TERMINOLOGY_KEY_META[k].description}</p>
              </div>
              <label className="block font-medium text-slate-700">
                Singular
                <input
                  {...register(singularName)}
                  {...fieldA11y(form, singularName)}
                  maxLength={TERM_MAX_LENGTH}
                  placeholder={TERMINOLOGY_DEFAULTS[k].singular}
                  className={`mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 ${invalidClass(form, singularName)}`}
                />
                <FieldError form={form} name={singularName} />
              </label>
              <label className="block font-medium text-slate-700">
                Plural
                <input
                  {...register(pluralName)}
                  {...fieldA11y(form, pluralName)}
                  maxLength={TERM_MAX_LENGTH}
                  placeholder={draft[k]?.singular.trim() || TERMINOLOGY_DEFAULTS[k].plural}
                  readOnly={!hasSingular}
                  aria-disabled={!hasSingular || undefined}
                  className={`mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 read-only:bg-slate-50 ${invalidClass(form, pluralName)}`}
                />
                <FieldError form={form} name={pluralName} />
              </label>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
        <p className="font-semibold text-slate-800">Preview</p>
        <p>
          The {word("monitorParty")} visits the site to check the {word("contractor").toLowerCase()}'s work. The{" "}
          {word("funderParty")} records each payment, less {word("retention").toLowerCase()}, and the works are handed over to the{" "}
          {word("beneficiary").toLowerCase()}.
        </p>
      </div>

      <div className="flex justify-end">
        <SubmitButton
          form={form}
          pending={save.isPending}
          pendingLabel="Saving..."
          className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
        >
          Save terminology
        </SubmitButton>
      </div>
    </form>
  );
}
