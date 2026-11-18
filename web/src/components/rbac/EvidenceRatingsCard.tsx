import React, { useEffect, useState } from "react";
import {
  EVIDENCE_RATING_ORDER,
  RATING_DESCRIPTION_MAX_LENGTH,
  RATING_LABEL_MAX_LENGTH,
  type EvidenceRatingLabels,
  type EvidenceStrengthRating,
} from "@insite/shared";
import { useEvidenceRatingLabelsQuery } from "../../queries/rbac/useRbacQueries";
import { useUpdateEvidenceRatingLabelsMutation } from "../../mutations/rbac/useRbacMutations";
import { ratingTone } from "../EvidenceBadge";
import Loader from "../Loader";

type Draft = Record<EvidenceStrengthRating, { label: string; description: string }>;

/**
 * Tenant wording for the four canonical evidence ratings (decision B). The meaning and colour
 * are fixed and shown read-only; only the label and description change. Empty fields fall back
 * to the defaults.
 */
export function EvidenceRatingsCard() {
  const { data, isLoading } = useEvidenceRatingLabelsQuery(true);
  const saveMutation = useUpdateEvidenceRatingLabelsMutation();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft(
      Object.fromEntries(
        EVIDENCE_RATING_ORDER.map((r) => [
          r,
          { label: data.labels[r]?.label ?? "", description: data.labels[r]?.description ?? "" },
        ]),
      ) as Draft,
    );
  }, [data]);

  if (isLoading || !data || !draft) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex justify-center">
        <Loader size="sm" />
      </div>
    );
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const labels: EvidenceRatingLabels = {};
    for (const r of EVIDENCE_RATING_ORDER) {
      const label = draft[r].label.trim();
      const description = draft[r].description.trim();
      // A rating with no custom label uses the default label and description.
      if (label) labels[r] = { label, description };
    }
    saveMutation.mutate({ labels });
  };

  const resetOne = (r: EvidenceStrengthRating) =>
    setDraft((d) => (d ? { ...d, [r]: { label: "", description: "" } } : d));

  return (
    <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Evidence ratings</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Change how the four evidence ratings are worded across the workbench, PDFs and summaries. The meaning and
          colour of each rating are fixed, and stored data always uses the canonical value.
        </p>
      </div>

      <div className="space-y-3">
        {EVIDENCE_RATING_ORDER.map((r) => {
          const resolved = data.resolved[r];
          return (
            <div key={r} className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3 rounded-xl border border-slate-200 p-3">
              <div className="text-xs space-y-1">
                <span className={`inline-flex px-2.5 py-0.5 rounded-full border font-medium ${ratingTone(r).badge}`}>{r}</span>
                <div className="text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700">Fixed meaning:</span> {resolved.defaultDescription}
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <label className="block font-medium text-slate-700">
                  Label
                  <input
                    value={draft[r].label}
                    maxLength={RATING_LABEL_MAX_LENGTH}
                    placeholder={resolved.defaultLabel}
                    onChange={(e) => setDraft((d) => (d ? { ...d, [r]: { ...d[r], label: e.target.value } } : d))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </label>
                <label className="block font-medium text-slate-700">
                  Description (shown on hover)
                  <textarea
                    rows={2}
                    value={draft[r].description}
                    maxLength={RATING_DESCRIPTION_MAX_LENGTH}
                    placeholder={resolved.defaultDescription}
                    disabled={!draft[r].label.trim()}
                    onChange={(e) => setDraft((d) => (d ? { ...d, [r]: { ...d[r], description: e.target.value } } : d))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 disabled:bg-slate-50"
                  />
                </label>
                {(draft[r].label || draft[r].description) && (
                  <button type="button" onClick={() => resetOne(r)} className="text-[11px] font-semibold text-slate-600 hover:text-slate-900">
                    Reset to default
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving..." : "Save rating labels"}
        </button>
      </div>
    </form>
  );
}
