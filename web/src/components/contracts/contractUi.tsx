import React from "react";
import type { ContractMilestoneStatus, DefaultCaseStatus, KickoffNoticeStatus } from "@insite/shared";

/** Phase 13 display helpers shared by the documents, milestones, kick-off and default-case screens. */

/** Who sees the Milestones and Kick-off pages (the server answers 403 to anyone else). */
export const MILESTONE_VIEW_PERMISSIONS = [
  "milestones:manage",
  "milestones:waive",
  "kickoff:manage",
  "documents:view",
  "contracts:raise_default",
  "contracts:decide_default",
];

/** Who sees default cases. */
export const DEFAULT_CASE_VIEW_PERMISSIONS = ["contracts:raise_default", "contracts:decide_default"];

export const MILESTONE_STATUS_META: Record<ContractMilestoneStatus, { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  DUE: { label: "Due today", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  OVERDUE: { label: "Overdue", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  DONE: { label: "Done", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  WAIVED: { label: "Waived", cls: "bg-sky-50 text-sky-800 border-sky-200" },
};

export const DEFAULT_CASE_STATUS_META: Record<DefaultCaseStatus, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  IN_REVIEW: { label: "In review", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  CURE_PERIOD: { label: "Cure period", cls: "bg-sky-50 text-sky-800 border-sky-200" },
  EXTENSION_GRANTED: { label: "Extension granted", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  TERMINATED: { label: "Terminated", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  CLOSED: { label: "Closed", cls: "bg-slate-100 text-slate-700 border-slate-200" },
};

/** Notice wording: the platform knows what it handed to the mail service, never whether it was read. */
export const NOTICE_STATUS_META: Record<KickoffNoticeStatus, { label: string; cls: string }> = {
  SENT: { label: "Sent", cls: "text-emerald-700" },
  QUEUED: { label: "Queued", cls: "text-amber-700" },
  FAILED: { label: "Failed", cls: "text-rose-700" },
  NO_EMAIL: { label: "No email address", cls: "text-slate-500" },
  NOT_SENT: { label: "Not sent", cls: "text-slate-500" },
};

export function StatusChip({ label, cls, title }: { label: string; cls: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

/** "3 days left", "Due today", "4 days overdue". */
export function daysLeftLabel(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft === 0) return "Due today";
  if (daysLeft > 0) return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  const n = Math.abs(daysLeft);
  return `${n} day${n === 1 ? "" : "s"} overdue`;
}

export function DaysLeft({ daysLeft }: { daysLeft: number | null }) {
  const label = daysLeftLabel(daysLeft);
  if (!label) return <span className="text-slate-400">—</span>;
  return <span className={daysLeft! < 0 ? "font-semibold text-rose-700" : daysLeft! <= 3 ? "font-semibold text-amber-700" : "text-slate-700"}>{label}</span>;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** First 12 characters of a hash, for display next to a sign-off. */
export const shortHash = (hash: string) => (hash.length > 12 ? `${hash.slice(0, 12)}…` : hash);

export const sectionClass = "bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3";
export const smallInput =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary disabled:bg-slate-50 disabled:text-slate-500";
export const primaryButton =
  "inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed";
export const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed";
export const dangerButton =
  "inline-flex items-center gap-1.5 rounded-xl border border-rose-300 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed";
