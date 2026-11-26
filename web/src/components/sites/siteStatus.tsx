import React from "react";
import { SITE_STATUS_LABELS, type SiteStatus } from "@insite/shared";

/**
 * Client demo updates C2 (wave 2): one colour per site status, shared by the status chip, the
 * register sub-rows and the portfolio map pins (same hues as the project schedule pins).
 */
export const SITE_STATUS_COLOR: Record<SiteStatus, string> = {
  NOT_STARTED: "#94a3b8",
  ONGOING: "#12915c",
  BEHIND: "#e11d48",
  COMPLETED: "#122f2a",
  HANDED_OVER: "#0369a1",
};

/** A site status as a dot plus words (UBEC: no filled pills). */
export function SiteStatusChip({ status, className = "" }: { status: SiteStatus; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-slate-700 ${className}`}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SITE_STATUS_COLOR[status] }} aria-hidden="true" />
      {SITE_STATUS_LABELS[status]}
    </span>
  );
}

/** "42%" or "–" when the site has no BoQ lines yet. */
export function sitePercentText(progressPct: number | null): string {
  return progressPct === null ? "–" : `${Math.round(progressPct)}%`;
}
