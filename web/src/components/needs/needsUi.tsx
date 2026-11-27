import React from "react";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  GitMerge,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  NEEDS_STAGE_LABELS,
  PROPOSAL_FLAG_KIND_META,
  stageConfigOf,
  zonedCalendarDate,
  type NeedsCycleDto,
  type NeedsCycleSummaryDto,
  type NeedsDeadlineState,
  type NeedsProposalStatus,
  type NeedsStage,
  type ProposalFlagKind,
} from "@insite/shared";
import { displayTimeZone, formatNaira } from "../../lib/formatters";
import { lgaNames, stateName } from "../approvedLists/approvedListUi";

/**
 * Needs pipeline wave 2: small pieces shared by the Needs assessment page, the proposal page and
 * their dialogs. Status is always an icon plus a label, never colour alone.
 */

export const NEEDS_FILE_ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCUMENT_FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xlsx,.txt";

export const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-slate-50 disabled:text-slate-500";
export const labelCls = "block text-xs font-semibold text-slate-700 mb-1";
export const cardCls = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

/** Today in the tenant's zone (YYYY-MM-DD), for deadline states. */
export function todayInTenant(): string {
  return zonedCalendarDate(new Date(), displayTimeZone());
}

/** Reads a file as base64 (without the data URL prefix). */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export const money = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatNaira(n));

/** "Kano · Dala, Gwale" (State, then LGAs). */
export function locationText(stateCode: string | null | undefined, lgaCodes: readonly string[] = []): string {
  const parts = [stateCode ? stateName(stateCode) : null, lgaCodes.length ? lgaNames([...lgaCodes]) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "–";
}

/** "2027 · Direct Intervention" or "2027 · Matching Grants · Kano". */
export function cycleLabel(c: Pick<NeedsCycleSummaryDto, "interventionYear" | "projectTypeName" | "stateCode">): string {
  return [String(c.interventionYear), c.projectTypeName, c.stateCode ? stateName(c.stateCode) : null].filter(Boolean).join(" · ");
}

/** The stage's name in this cycle (a programme may rename stages). */
export function stageLabel(cycle: Pick<NeedsCycleDto, "config">, stage: NeedsStage): string {
  return stageConfigOf(cycle.config, stage)?.label ?? NEEDS_STAGE_LABELS[stage];
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ---------------------------------------------------------------------------
// Status, flags, deadlines
// ---------------------------------------------------------------------------

const STATUS_META: Record<NeedsProposalStatus, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  DRAFT: { icon: FileText, cls: "border-slate-200 bg-slate-50 text-slate-700" },
  IN_PROGRESS: { icon: Clock, cls: "border-brand-primary/25 bg-brand-primary/5 text-brand-primary" },
  RETURNED: { icon: Undo2, cls: "border-amber-200 bg-amber-50 text-amber-800" },
  CONVERTED: { icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  NOT_VALIDATED: { icon: XCircle, cls: "border-rose-200 bg-rose-50 text-rose-700" },
  NOT_SELECTED: { icon: XCircle, cls: "border-slate-200 bg-slate-100 text-slate-700" },
  WITHDRAWN: { icon: Ban, cls: "border-slate-200 bg-slate-100 text-slate-700" },
  MERGED: { icon: GitMerge, cls: "border-slate-200 bg-slate-100 text-slate-700" },
};

/** The proposal's status label (from the server's `statusLabel`) with an icon. */
export function ProposalStatusTag({ status, label }: { status: NeedsProposalStatus; label: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Open flags as chips (icon + label). */
export function FlagChips({ kinds, empty = "–" }: { kinds: readonly ProposalFlagKind[]; empty?: string }) {
  const unique = [...new Set(kinds)];
  if (unique.length === 0) return <span className="text-slate-400">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {unique.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {PROPOSAL_FLAG_KIND_META[k].label}
        </span>
      ))}
    </span>
  );
}

export const DEADLINE_STATE_META: Record<NeedsDeadlineState, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  NOT_SET: { label: "No date", icon: Circle, cls: "text-slate-500" },
  UPCOMING: { label: "Upcoming", icon: CalendarClock, cls: "text-slate-600" },
  DUE_SOON: { label: "Due soon", icon: Clock, cls: "text-amber-800" },
  DUE_TODAY: { label: "Due today", icon: AlertTriangle, cls: "text-amber-900" },
  OVERDUE: { label: "Overdue", icon: AlertTriangle, cls: "text-rose-700" },
};

/** A past deadline nothing is waiting on any more. */
export const DEADLINE_PASSED_META = { label: "Passed", icon: CheckCircle2, cls: "text-slate-500" };

/** An empty state for a tab a later step fills (plain words, no promise of dates). */
export function EmptyPanel({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-xl text-xs text-slate-500">{children}</div>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV (error lists built in the browser)
// ---------------------------------------------------------------------------

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Saves rows as a UTF-8 CSV (with a BOM so Excel reads the ₦ and accents). */
export function downloadCsv(fileName: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
