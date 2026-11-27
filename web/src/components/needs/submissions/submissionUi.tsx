import React, { useMemo, useState } from "react";
import { CheckCircle2, Circle, CircleDot, Clock, FileText, Undo2 } from "lucide-react";
import { needsDistribution, type NeedsDistributionLevel, type NeedsSubmissionDto, type NeedsSubmissionStatus } from "@insite/shared";
import { TAB_LIST_CLASS, tabItemClass } from "../../common/Tabs";
import { formatDateTimeShort } from "../../../lib/formatters";
import { money, plural } from "../needsUi";

/**
 * Needs pipeline wave 4 (C1): pieces shared by the portfolio / State approval review and the
 * out-of-cycle request page. Status is always an icon plus a label, never colour alone.
 */

const chipBase = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold";

const STATUS_META: Record<NeedsSubmissionStatus, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  DRAFT: { icon: FileText, cls: "border-slate-200 bg-slate-50 text-slate-700" },
  IN_REVIEW: { icon: Clock, cls: "border-brand-primary/25 bg-brand-primary/5 text-brand-primary" },
  RETURNED: { icon: Undo2, cls: "border-amber-200 bg-amber-50 text-amber-800" },
  APPROVED: { icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

export function SubmissionStatusTag({ status, label }: { status: NeedsSubmissionStatus; label: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`${chipBase} ${meta.cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** True when the current step is the chain's last one (the portfolio's memo is required there). */
export function isLastStep(s: Pick<NeedsSubmissionDto, "steps" | "currentStepOrder">): boolean {
  if (!s.currentStepOrder) return false;
  const max = Math.max(...s.steps.map((x) => x.stepOrder));
  return s.currentStepOrder === max;
}

/** The chain's steps: done, current (waiting), pending. */
export function ChainSteps({ submission }: { submission: Pick<NeedsSubmissionDto, "steps" | "status"> }) {
  if (submission.steps.length === 0) return <p className="text-xs text-slate-500">This programme has no approval steps set.</p>;
  return (
    <ol className="space-y-1.5" aria-label="Approval steps">
      {[...submission.steps]
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map((step) => {
          const waiting = step.state === "CURRENT" && submission.status === "IN_REVIEW";
          const Icon = step.state === "DONE" ? CheckCircle2 : waiting ? CircleDot : Circle;
          const text = step.state === "DONE" ? "Done" : waiting ? "Waiting" : step.state === "CURRENT" ? "Next" : "Not yet";
          return (
            <li key={step.id} className="flex items-start gap-2 text-xs">
              <Icon
                className={`mt-px h-4 w-4 shrink-0 ${step.state === "DONE" ? "text-emerald-700" : waiting ? "text-brand-primary" : "text-slate-400"}`}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className={`font-semibold ${step.state === "PENDING" ? "text-slate-600" : "text-slate-900"}`}>
                  {step.stepOrder}. {step.label}
                </span>
                <span className={`ml-1.5 text-[11px] ${waiting ? "font-semibold text-brand-primary" : "text-slate-500"}`}>{text}</span>
              </span>
            </li>
          );
        })}
    </ol>
  );
}

const DECISION_TEXT: Record<"APPROVE" | "RETURN" | "REJECT", string> = { APPROVE: "Approved", RETURN: "Returned", REJECT: "Rejected" };

/** Who decided what at which step, oldest first. */
export function ActionsHistory({ actions }: { actions: NeedsSubmissionDto["actions"] }) {
  if (actions.length === 0) return <p className="text-xs text-slate-500">No decision yet.</p>;
  return (
    <ul className="space-y-2">
      {[...actions]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((a, i) => (
          <li key={`${a.createdAt}-${i}`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className={`font-semibold ${a.decision === "APPROVE" ? "text-emerald-800" : "text-amber-800"}`}>{DECISION_TEXT[a.decision]}</span>
                <span className="text-slate-700"> at {a.stepLabel}</span>
                <span className="text-slate-500"> · {a.actorName}</span>
              </span>
              <span className="text-[11px] text-slate-500">{formatDateTimeShort(a.createdAt)}</span>
            </p>
            {a.notes && <p className="mt-1 whitespace-pre-line text-slate-700">{a.notes}</p>}
          </li>
        ))}
    </ul>
  );
}

const LEVEL_LABELS: Record<NeedsDistributionLevel, string> = { ZONE: "Zone", STATE: "State", LGA: "LGA" };

/**
 * Where the included proposed projects land, by zone, State or LGA (`needsDistribution`). A bar per
 * group shows its share of the amount; the figures are written beside it.
 */
export function DistributionPanel({
  items,
  levels = ["ZONE", "STATE", "LGA"],
}: {
  items: Array<{ stateCode: string | null; lgaCodes: readonly string[]; amountNgn: number | null }>;
  levels?: NeedsDistributionLevel[];
}) {
  const [level, setLevel] = useState<NeedsDistributionLevel>(levels.includes("STATE") ? "STATE" : levels[0]);
  const result = useMemo(() => needsDistribution(items, level), [items, level]);
  const shared = result.groups.some((g) => g.sharedAcrossGroups);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Group by" className={TAB_LIST_CLASS}>
          {levels.map((l) => (
            <button key={l} type="button" aria-pressed={level === l} className={tabItemClass(level === l)} onClick={() => setLevel(l)}>
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          {plural(result.count, "proposed project")} · {money(result.amountNgn)}
        </p>
      </div>
      {result.groups.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing included.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[480px] text-xs">
            <caption className="sr-only">Included proposed projects by {LEVEL_LABELS[level]}</caption>
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-1.5">{LEVEL_LABELS[level]}</th>
                <th scope="col" className="px-3 py-1.5 text-right">Projects</th>
                <th scope="col" className="px-3 py-1.5 text-right">Amount</th>
                <th scope="col" className="w-2/5 px-3 py-1.5">Share of the amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.groups.map((g) => (
                <tr key={g.key}>
                  <td className="px-3 py-1.5 font-semibold text-slate-900">
                    {g.label}
                    {g.sharedAcrossGroups && (
                      <span className="text-slate-500" title="Includes a proposed project that is also counted in other LGAs">
                        {" "}
                        *
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{g.count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{money(g.amountNgn)}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                        <div className="h-full rounded-full bg-brand-primary" style={{ width: `${Math.min(100, g.sharePct)}%` }} />
                      </div>
                      <span className="w-12 text-right tabular-nums text-slate-700">{g.sharePct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {level === "LGA" && shared && (
        <p className="text-[11px] text-slate-500">
          * A proposed project with sites in several LGAs counts in full in each of them, so these rows add up to more than the total. The total counts each proposed
          project once.
        </p>
      )}
    </div>
  );
}
