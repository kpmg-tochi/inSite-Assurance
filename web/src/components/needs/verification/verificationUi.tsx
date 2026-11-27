import React from "react";
import { AlertTriangle, Ban, CheckCircle2, Clock, Hourglass, Undo2 } from "lucide-react";
import { formatDateShort } from "../../../lib/formatters";
import type { NeedsVerificationDto, NeedsVerificationStatus } from "@insite/shared";

/**
 * Needs pipeline wave 5 (N8): small pieces for field verifications. Status is always an icon plus a
 * label (the server's `statusLabel`), never colour alone.
 */

const STATUS_META: Record<NeedsVerificationStatus, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  ASSIGNED: { icon: Clock, cls: "border-brand-primary/25 bg-brand-primary/5 text-brand-primary" },
  SUBMITTED: { icon: Hourglass, cls: "border-amber-200 bg-amber-50 text-amber-800" },
  ACCEPTED: { icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  RETURNED: { icon: Undo2, cls: "border-amber-200 bg-amber-50 text-amber-800" },
  CANCELLED: { icon: Ban, cls: "border-slate-200 bg-slate-100 text-slate-700" },
};

export function VerificationStatusTag({ status, label }: { status: NeedsVerificationStatus; label: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** "Due 4 Dec 2026", or the overdue state (icon + words) while the officer still has work. */
export function VerificationDue({ v }: { v: Pick<NeedsVerificationDto, "dueDate" | "overdue"> }) {
  if (v.overdue) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
        Overdue since {formatDateShort(v.dueDate)}
      </span>
    );
  }
  return <span>Due {formatDateShort(v.dueDate)}</span>;
}

/** "12 m", "1.4 km". */
export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined) return "–";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export const formatCoordinate = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/** Sites as "Sites 1, 2 and 4" (or the school name when only one). */
export function sitesText(sites: NeedsVerificationDto["sites"]): string {
  if (sites.length === 0) return "No site";
  if (sites.length === 1) return `Site ${sites[0].siteNumber}: ${sites[0].schoolName}`;
  const nums = sites.map((s) => s.siteNumber);
  return `Sites ${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
}

/** Statuses that hold a submission a reviewer may open. */
export const hasSubmission = (v: NeedsVerificationDto) => v.submission !== null;
