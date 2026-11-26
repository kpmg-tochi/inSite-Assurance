import { Flag, Scale } from "lucide-react";
import {
  CONTRACTOR_FLAG_ACTION_STATUS_LABELS,
  type ContractorFlagActionDto,
  type ContractorFlagActionStatus,
  type ContractorFlagStatus,
} from "@insite/shared";
import { formatNaira } from "../../lib/formatters";

/** Client demo updates F.4: chips and wording shared by the flag drawer, cards and lists. */

const ACTION_STATUS_STYLE: Record<ContractorFlagActionStatus, string> = {
  RECORDED: "bg-slate-50 text-slate-700 border-slate-200",
  IN_EFFECT: "bg-amber-50 text-amber-800 border-amber-200",
  SENT_TO_LEGAL_REVIEW: "bg-brand-primary/5 text-brand-primary border-brand-primary/30",
  LIFTED: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

export function ActionStatusChip({ status }: { status: ContractorFlagActionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ACTION_STATUS_STYLE[status]}`}
    >
      {status === "SENT_TO_LEGAL_REVIEW" && <Scale className="h-3 w-3" aria-hidden="true" />}
      {CONTRACTOR_FLAG_ACTION_STATUS_LABELS[status]}
    </span>
  );
}

export function FlagStatusChip({ status }: { status: ContractorFlagStatus }) {
  return status === "OPEN" ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
      <Flag className="h-3 w-3" aria-hidden="true" /> Open
    </span>
  ) : (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      Closed
    </span>
  );
}

/** "2 open flags" chip for the register; nothing when there is none. */
export function OpenFlagCountChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      title="Open performance flags"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"
    >
      <Flag className="h-3 w-3" aria-hidden="true" />
      {count} open flag{count === 1 ? "" : "s"}
    </span>
  );
}

/** The decided parameters of an action in words ("3 visits", "₦2,500,000 under clause 14.2"). */
export function actionParamsText(action: ContractorFlagActionDto): string | null {
  const p = action.params as { visitCount?: unknown; visitKind?: unknown; deductionAmountNgn?: unknown; clause?: unknown };
  const parts: string[] = [];
  if (action.kind === "ADDITIONAL_VISITS") {
    const n = action.visitIds.length || (typeof p.visitCount === "number" ? p.visitCount : 0);
    if (n) parts.push(`${n} monitoring visit${n === 1 ? "" : "s"} proposed`);
  }
  if (action.kind === "DEDUCTION") {
    if (typeof p.deductionAmountNgn === "number") parts.push(formatNaira(p.deductionAmountNgn));
    if (typeof p.clause === "string" && p.clause) parts.push(`clause ${p.clause}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** "24 Nov 2026" from YYYY-MM-DD (calendar date, no zone shift). */
export function fmtCalendarDay(date: string): string {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
