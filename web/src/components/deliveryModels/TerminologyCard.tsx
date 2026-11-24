import React, { useEffect, useState } from "react";
import {
  TERM_MAX_LENGTH,
  TERMINOLOGY_DEFAULTS,
  TERMINOLOGY_KEY_META,
  TERMINOLOGY_KEYS,
  type TerminologyKey,
  type TerminologyLabels,
} from "@insite/shared";
import { useTerminologyQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { useUpdateTerminologyMutation } from "../../mutations/deliveryModels/useDeliveryModelMutations";
import Loader from "../Loader";

type Draft = Record<TerminologyKey, { singular: string; plural: string }>;

/**
 * Phase 11: tenant wording for domain terms. Display only: stored values and API fields
 * keep the canonical names. Empty fields use the default word.
 */
export function TerminologyCard() {
  const { data, isLoading } = useTerminologyQuery(true);
  const save = useUpdateTerminologyMutation();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft(
      Object.fromEntries(
        TERMINOLOGY_KEYS.map((k) => [k, { singular: data.labels[k]?.singular ?? "", plural: data.labels[k]?.plural ?? "" }])
      ) as Draft
    );
  }, [data]);

  if (isLoading || !data || !draft) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex justify-center">
        <Loader size="sm" />
      </div>
    );
  }

  const set = (k: TerminologyKey, field: "singular" | "plural", value: string) =>
    setDraft((d) => (d ? { ...d, [k]: { ...d[k], [field]: value } } : d));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const labels: TerminologyLabels = {};
    for (const k of TERMINOLOGY_KEYS) {
      const singular = draft[k].singular.trim();
      const plural = draft[k].plural.trim();
      if (singular) labels[k] = plural ? { singular, plural } : { singular };
    }
    save.mutate({ labels });
  };

  // Live preview of a few sentences with the draft words.
  const word = (k: TerminologyKey, plural = false) => {
    const d = draft[k];
    const singular = d.singular.trim() || TERMINOLOGY_DEFAULTS[k].singular;
    return plural ? d.plural.trim() || (d.singular.trim() ? singular : TERMINOLOGY_DEFAULTS[k].plural) : singular;
  };

  return (
    <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Terminology</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Change the words the portal, PDFs and messages use for these terms. Stored data and exports keep the standard
          names. Leave a field empty to use the default.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {TERMINOLOGY_KEYS.map((k) => (
          <div key={k} className="grid grid-cols-1 md:grid-cols-[220px_1fr_1fr] gap-2 items-start rounded-xl border border-slate-200 p-3 text-xs">
            <div>
              <p className="font-semibold text-slate-800">{TERMINOLOGY_KEY_META[k].label}</p>
              <p className="text-[11px] text-slate-500">{TERMINOLOGY_KEY_META[k].description}</p>
            </div>
            <label className="block font-medium text-slate-700">
              Singular
              <input
                value={draft[k].singular}
                maxLength={TERM_MAX_LENGTH}
                placeholder={TERMINOLOGY_DEFAULTS[k].singular}
                onChange={(e) => set(k, "singular", e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </label>
            <label className="block font-medium text-slate-700">
              Plural
              <input
                value={draft[k].plural}
                maxLength={TERM_MAX_LENGTH}
                placeholder={draft[k].singular.trim() || TERMINOLOGY_DEFAULTS[k].plural}
                disabled={!draft[k].singular.trim()}
                onChange={(e) => set(k, "plural", e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 disabled:bg-slate-50"
              />
            </label>
          </div>
        ))}
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
        <button
          type="submit"
          disabled={save.isPending}
          className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
        >
          {save.isPending ? "Saving..." : "Save terminology"}
        </button>
      </div>
    </form>
  );
}
