import React from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpToLine, CheckCircle2, Circle, Clock, Lock, Minus, PlayCircle, ShieldCheck, UserCheck, UserX } from "lucide-react";
import type { CommitteeRole, CycleDocumentKind, DivergentCriterionDto, NeedsCommitteeDto, NeedsCycleDocumentDto, NeedsCycleDto, RecusalReason } from "@insite/shared";

/**
 * Needs pipeline wave 3, Track D: small pieces shared by the Prioritisation tab and the proposal
 * page's Scores tab. Status is always an icon plus a label, never colour alone.
 */

export const RECUSAL_REASON_LABELS: Record<RecusalReason, string> = {
  UPLOADED: "Uploaded it",
  VALIDATED: "Validated it",
  COSTED: "Costed it",
  DECLARED_CONFLICT: "Declared a conflict of interest",
};

export const COMMITTEE_ROLE_LABELS: Record<CommitteeRole, string> = { CHAIR: "Chair", MEMBER: "Member" };

const chipBase = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold";

export type ScoringState = "NOT_OPENED" | "OPEN" | "CLOSED" | "FINALISED";

/** Where scoring stands (a re-opened scoring has an opening later than its last closing). */
export function scoringState(c: Pick<NeedsCommitteeDto, "scoringOpenedAt" | "scoringClosedAt" | "rankingFinalisedAt">): ScoringState {
  if (c.rankingFinalisedAt) return "FINALISED";
  if (!c.scoringOpenedAt) return "NOT_OPENED";
  if (c.scoringClosedAt && c.scoringClosedAt >= c.scoringOpenedAt) return "CLOSED";
  return "OPEN";
}

const SCORING_STATE_META: Record<ScoringState, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  NOT_OPENED: { label: "Scoring not opened", icon: Circle, cls: "border-slate-200 bg-slate-50 text-slate-700" },
  OPEN: { label: "Scoring open", icon: PlayCircle, cls: "border-brand-primary/25 bg-brand-primary/5 text-brand-primary" },
  CLOSED: { label: "Scoring closed", icon: Lock, cls: "border-amber-200 bg-amber-50 text-amber-800" },
  FINALISED: { label: "Ranking finalised", icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

export function ScoringStateChip({ state }: { state: ScoringState }) {
  const meta = SCORING_STATE_META[state];
  const Icon = meta.icon;
  return (
    <span className={`${chipBase} ${meta.cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function RoleChip({ role }: { role: CommitteeRole }) {
  return (
    <span className={`${chipBase} ${role === "CHAIR" ? "border-brand-primary/25 bg-brand-primary/5 text-brand-primary" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
      {role === "CHAIR" ? <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" /> : <UserCheck className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {COMMITTEE_ROLE_LABELS[role]}
    </span>
  );
}

export function DeclaredChip({ declared, conflicts }: { declared: boolean; conflicts: number }) {
  if (!declared) {
    return (
      <span className={`${chipBase} border-amber-200 bg-amber-50 text-amber-800`}>
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        Not declared
      </span>
    );
  }
  return conflicts > 0 ? (
    <span className={`${chipBase} border-amber-200 bg-amber-50 text-amber-900`}>
      <UserX className="h-3 w-3 shrink-0" aria-hidden="true" />
      Declared: {conflicts} {conflicts === 1 ? "conflict" : "conflicts"}
    </span>
  ) : (
    <span className={`${chipBase} border-emerald-200 bg-emerald-50 text-emerald-800`}>
      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      Declared: no conflict
    </span>
  );
}

export function RecusedChip({ reason }: { reason: RecusalReason }) {
  return (
    <span className={`${chipBase} border-slate-200 bg-slate-100 text-slate-700`}>
      <UserX className="h-3 w-3 shrink-0" aria-hidden="true" />
      Recused: {RECUSAL_REASON_LABELS[reason].toLowerCase()}
    </span>
  );
}

/** Above or below the funding line (icon + label). */
export function LineChip({ above }: { above: boolean | null }) {
  if (above === null) {
    return (
      <span className={`${chipBase} border-slate-200 bg-slate-50 text-slate-600`}>
        <Minus className="h-3 w-3 shrink-0" aria-hidden="true" />
        Not ranked
      </span>
    );
  }
  return above ? (
    <span className={`${chipBase} border-emerald-200 bg-emerald-50 text-emerald-800`}>
      <ArrowUpToLine className="h-3 w-3 shrink-0" aria-hidden="true" />
      Above the line
    </span>
  ) : (
    <span className={`${chipBase} border-slate-200 bg-slate-100 text-slate-700`}>
      <ArrowDownToLine className="h-3 w-3 shrink-0" aria-hidden="true" />
      Below the line
    </span>
  );
}

/**
 * The divergence mark: icon + label, expandable to each divergent sub-criterion with its lowest and
 * highest score (D-N.10: flagged, never silently averaged).
 */
export function DivergenceMark({ divergent, threshold }: { divergent: readonly DivergentCriterionDto[]; threshold?: number }) {
  if (divergent.length === 0) return <span className="text-slate-400">–</span>;
  const title = divergent.map((d) => `${d.label}: ${d.min}–${d.max}`).join("; ");
  return (
    <details className="group text-[11px]">
      <summary
        title={title}
        className={`${chipBase} cursor-pointer list-none border-amber-200 bg-amber-50 text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary [&::-webkit-details-marker]:hidden`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
        Divergent ({divergent.length})
      </summary>
      <ul className="mt-1 space-y-0.5 text-slate-700">
        {divergent.map((d) => (
          <li key={d.criterionKey}>
            {d.label}: <span className="font-semibold tabular-nums">{d.min}–{d.max}</span>
            <span className="text-slate-500"> ({d.spread} apart)</span>
          </li>
        ))}
      </ul>
      {threshold !== undefined && <p className="mt-0.5 text-slate-500">Flagged at {threshold} points or more apart.</p>}
    </details>
  );
}

/** "78.5" (scores 0–100). */
export const scoreText = (n: number | null | undefined) => (n === null || n === undefined ? "–" : (Math.round(n * 10) / 10).toFixed(1));

/** The cycle's current documents of a kind (versions superseded by another are left out), newest first. */
export function currentDocuments(cycle: Pick<NeedsCycleDto, "documents">, kind: CycleDocumentKind): NeedsCycleDocumentDto[] {
  const superseded = new Set(cycle.documents.map((d) => d.supersedesId).filter(Boolean));
  return cycle.documents.filter((d) => d.kind === kind && !superseded.has(d.id)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/**
 * Score sheets are independent (D-N.10): a committee member who is not the chair sees no combined
 * scores before the ranking is finalised. Non-members with `needs:view` see the live ranking.
 */
export function hidesCombinedScores(committee: Pick<NeedsCommitteeDto, "me" | "rankingFinalisedAt"> | null | undefined): boolean {
  return Boolean(committee?.me && committee.me.role !== "CHAIR" && !committee.rankingFinalisedAt);
}

export const secondaryButtonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButtonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export const linkButtonCls = "font-semibold text-brand-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded";
