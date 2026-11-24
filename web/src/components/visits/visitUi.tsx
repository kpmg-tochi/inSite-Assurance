import React from "react";
import {
  VISIT_CONFIRMATION_LABELS,
  VISIT_KIND_META,
  VISIT_STATUS_LABELS,
  type VisitConfirmation,
  type VisitDto,
  type VisitKind,
  type VisitStatus,
  type VisitWarning,
} from "@insite/shared";
import { AlertTriangle } from "lucide-react";

/** Redesign R4: small shared pieces of the visit pages (labels, chips, warnings). */

export const visitKindLabel = (kind: string) => VISIT_KIND_META[kind as VisitKind]?.label ?? kind;

const STATUS_TONE: Record<VisitStatus, string> = {
  PROPOSED: "bg-slate-100 text-slate-700",
  PLANNED: "bg-sky-50 text-sky-800",
  IN_PROGRESS: "bg-indigo-50 text-indigo-800",
  SUBMITTED: "bg-amber-50 text-amber-800",
  RETURNED: "bg-orange-50 text-orange-800",
  APPROVED: "bg-emerald-50 text-emerald-700",
  MISSED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500 line-through",
};

const CONFIRMATION_TONE: Record<VisitConfirmation, string> = {
  UNCONFIRMED: "text-slate-500",
  CONFIRMED: "text-emerald-700",
  DECLINED: "text-red-700",
};

export function VisitStatusChip({ status }: { status: VisitStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>{VISIT_STATUS_LABELS[status]}</span>;
}

export function ConfirmationText({ visit }: { visit: Pick<VisitDto, "status" | "confirmation"> }) {
  if (visit.status !== "PLANNED") return null;
  return <span className={`text-[11px] font-semibold ${CONFIRMATION_TONE[visit.confirmation]}`}>{VISIT_CONFIRMATION_LABELS[visit.confirmation]}</span>;
}

export function officersText(visit: Pick<VisitDto, "assignees">): string {
  if (visit.assignees.length === 0) return "No officer";
  return visit.assignees.map((a) => (a.isLead ? `${a.fullName} (lead)` : a.fullName)).join(", ");
}

export function WarningsList({ warnings, max = 8 }: { warnings: VisitWarning[]; max?: number }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-semibold inline-flex items-center gap-1">
        <AlertTriangle className="w-3.5 h-3.5" /> Planning warnings ({warnings.length})
      </p>
      <ul className="mt-1 list-disc pl-5 space-y-0.5">
        {warnings.slice(0, max).map((w, i) => (
          <li key={`${w.code}-${w.visitId ?? w.userId ?? i}-${w.date ?? ""}`}>{w.message}</li>
        ))}
      </ul>
      {warnings.length > max && <p className="mt-1">and {warnings.length - max} more.</p>}
    </div>
  );
}

export const toneButton = "rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
export const primaryButton = `${toneButton} bg-brand-primary text-white hover:bg-brand-hover`;
export const secondaryButton = `${toneButton} border border-slate-300 text-slate-700 hover:bg-slate-50`;
