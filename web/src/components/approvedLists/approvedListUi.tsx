import React from "react";
import { AlertTriangle, CheckCircle2, Copy, Link2Off } from "lucide-react";
import {
  formatProjectCode,
  lgaByCode,
  stateByCode,
  type ApprovedListKind,
  type ApprovedListRowDto,
  type ApprovedListSummaryDto,
  type BudgetMismatchDto,
} from "@insite/shared";
import { formatDateShort } from "../../lib/formatters";

/** Client demo updates E3 (wave 3): shared bits of the Needs assessment page, the overview card and the row picker. */

/** Short kind label for cards and chips. */
export const APPROVED_LIST_KIND_SHORT: Record<ApprovedListKind, string> = {
  DI_SCHEDULE: "Direct Intervention schedule",
  MG_BEAP: "Matching Grants BEAP",
};

/** The project type each kind of list approves (the Needs assessment "Project type" filter). */
export const APPROVED_LIST_PROJECT_TYPE: Record<ApprovedListKind, string> = {
  DI_SCHEDULE: "Direct Intervention",
  MG_BEAP: "Matching Grants",
};

/** Shortest kind label, for table cells ("BEAP · Kano"). */
export const APPROVED_LIST_KIND_ABBR: Record<ApprovedListKind, string> = {
  DI_SCHEDULE: "DI schedule",
  MG_BEAP: "BEAP",
};

/** "Approved by UBEC Board on 21 Oct 2025 · Uploaded 26 Nov 2026 by Ada Obi · BEAP Kano 2026.xlsx" */
export function listProvenance(list: ApprovedListSummaryDto): string {
  const parts = [`Approved by ${list.approvedBy}${list.approvedOn ? ` on ${formatDateShort(list.approvedOn)}` : ""}`];
  if (list.importedAt) {
    parts.push(`Uploaded ${formatDateShort(list.importedAt)}${list.importedByName ? ` by ${list.importedByName}` : ""}`);
    if (list.sourceFileName) parts.push(list.sourceFileName);
  }
  return parts.join(" · ");
}

export const stateName =(code: string | null | undefined) => (code ? stateByCode(code)?.name ?? code : "");

/** LGA names for a row ("Dala, Gwale"). */
export const lgaNames = (codes: string[]) => codes.map((c) => lgaByCode(c)?.name ?? c).join(", ");

/** "LOT 5 BATCH 7 · 2026" (the code people read, with the intervention year). */
export function projectLabel(p: { codePrefix: string; interventionYear: number | null }) {
  const code = formatProjectCode(p.codePrefix);
  return p.interventionYear ? `${code} · ${p.interventionYear}` : code;
}

const MATCH_META: Record<ApprovedListRowDto["matchStatus"], { label: string; style: string; icon: React.ReactNode }> = {
  NOT_LINKED: {
    label: "Not linked",
    style: "border-slate-200 bg-slate-50 text-slate-600",
    icon: <Link2Off className="h-3 w-3" aria-hidden="true" />,
  },
  LINKED: {
    label: "Linked",
    style: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  },
  MISMATCH: {
    label: "Budget mismatch",
    style: "border-rose-200 bg-rose-50 text-rose-700",
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
  },
  MULTIPLE: {
    label: "Linked to several projects",
    style: "border-amber-200 bg-amber-50 text-amber-800",
    icon: <Copy className="h-3 w-3" aria-hidden="true" />,
  },
};

export function MatchStatusChip({ status }: { status: ApprovedListRowDto["matchStatus"] }) {
  const meta = MATCH_META[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.style}`}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

/** The budget check under a link: a red flag outside the tolerance, a quiet line inside it. */
export function BudgetCheckLine({ mismatch }: { mismatch: BudgetMismatchDto }) {
  if (mismatch.flagged) {
    return (
      <p role="status" className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Red flag: {mismatch.summary}. Outside the ±{mismatch.tolerancePct}% tolerance.
        </span>
      </p>
    );
  }
  return (
    <p className="text-[11px] text-slate-500">
      {mismatch.summary}
      {mismatch.differencePct !== null && `: within ±${mismatch.tolerancePct}%.`}
    </p>
  );
}
