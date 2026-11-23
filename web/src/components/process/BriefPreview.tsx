import React, { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { BriefPersona } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useMorningBriefsQuery } from "../../queries/briefs/useBriefQueries";
import { useGenerateMorningBriefMutation } from "../../mutations/briefs/useBriefMutations";

const PERSONA_LABEL: Record<BriefPersona, string> = {
  CONTRACTOR_EXECUTOR: "Contractor",
  INDEPENDENT_VERIFIER: "Inspector",
};

/**
 * Today's morning brief for one BOQ item, as each persona sees it (Phase 7). The inspector's
 * brief is about what to verify; the contractor's is about what to execute.
 */
export function BriefPreview({
  projectId,
  boqItemId,
  contractorReportingOn,
}: {
  projectId: string;
  boqItemId: string;
  /** With contractor field reporting off, every brief is written for the inspector. */
  contractorReportingOn: boolean;
}) {
  const { hasPermission } = useAuth();
  const [persona, setPersona] = useState<BriefPersona>(contractorReportingOn ? "CONTRACTOR_EXECUTOR" : "INDEPENDENT_VERIFIER");
  const effective: BriefPersona = contractorReportingOn ? persona : "INDEPENDENT_VERIFIER";
  const briefsQuery = useMorningBriefsQuery(projectId, effective);
  const generate = useGenerateMorningBriefMutation(projectId);
  const brief = briefsQuery.data?.find((b) => b.boqItemId === boqItemId && b.targetPersona === effective) ?? null;
  const canGenerate = hasPermission("projects:edit_baseline");

  return (
    <div className="rounded-xl border border-slate-200 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Today's morning brief</span>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Brief persona">
          {(["CONTRACTOR_EXECUTOR", "INDEPENDENT_VERIFIER"] as const).map((p) => {
            const disabled = p === "CONTRACTOR_EXECUTOR" && !contractorReportingOn;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={effective === p}
                disabled={disabled}
                title={disabled ? "Contractor field reporting is off on this project." : undefined}
                onClick={() => setPersona(p)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  effective === p ? "bg-white text-brand-primary shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {PERSONA_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>

      {briefsQuery.isLoading ? (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading brief…
        </p>
      ) : briefsQuery.isError ? (
        <p className="text-[11px] text-amber-700">The brief could not be loaded.</p>
      ) : brief ? (
        <div className="space-y-2">
          <p className="font-semibold text-slate-900">{brief.headline}</p>
          <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-line">{brief.expectedDeliverable}</p>
          {brief.reportingChecklist.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-slate-600 space-y-0.5">
              {brief.reportingChecklist.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {brief.appliedStandards.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" aria-label="Applied standards">
              {brief.appliedStandards.map((s) => (
                <span
                  key={s.code}
                  title={`${s.title}: ${s.summaryRule}`}
                  className="inline-flex items-center rounded-full border border-brand-primary/25 bg-brand-primary/5 px-2 py-0.5 text-[10px] font-semibold text-brand-primary"
                >
                  {s.code}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">No project standard applies to this item.</p>
          )}
          <p className="text-[10px] text-slate-400">
            Written from the template for the{" "}
            {PERSONA_LABEL[brief.targetPersona].toLowerCase()}.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">No {PERSONA_LABEL[effective].toLowerCase()} brief for this item today yet.</p>
          {canGenerate && (
            <button
              type="button"
              disabled={generate.isPending}
              onClick={() => generate.mutate({ boqItemId, persona: effective })}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3" /> {generate.isPending ? "Preparing…" : "Prepare preview"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
