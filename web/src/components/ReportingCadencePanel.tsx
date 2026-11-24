import React, { useState } from "react";
import { AlarmClock, CalendarClock, ClipboardCheck } from "lucide-react";
import {
  formatDueLabel,
  periodNoun,
  type ReportingObligationDto,
  type ReportingObligationStatus,
} from "@insite/shared";
import { useAuth } from "../lib/auth-context";
import { KpiCard, Overlay } from "./common";
import { StandardTable, TableBadge, type TableBadgeVariant, type TableColumnDef } from "./table";
import { useCadenceOverviewQuery, useDueObligationsQuery } from "../queries/cadence/useCadenceQueries";
import { useExcuseObligationMutation } from "../mutations/cadence/useCadenceMutations";

const OBLIGATION_META: Record<ReportingObligationStatus, { label: string; variant: TableBadgeVariant }> = {
  PENDING: { label: "Due", variant: "info" },
  SUBMITTED: { label: "Submitted", variant: "success" },
  LATE: { label: "Late", variant: "warning" },
  MISSED: { label: "Missed", variant: "danger" },
  EXCUSED: { label: "Excused", variant: "neutral" },
};

/** A note prompt for excusing a report (a note is required and audited). */
function NoteDialog({
  title,
  onCancel,
  onConfirm,
  busy,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
  busy: boolean;
}) {
  const [notes, setNotes] = useState("");
  return (
    <Overlay role="dialog" aria-modal="true" aria-label={title} className="flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <p className="text-sm font-bold text-slate-900">{title}</p>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="excuse-note">
          Reason (recorded in the audit ledger)
        </label>
        <textarea
          id="excuse-note"
          className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={notes.trim().length < 3 || busy}
            onClick={() => onConfirm(notes.trim())}
          >
            Excuse
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/**
 * Phase 8: reporting cadence on the field reports tab. Counts for the current period and the
 * "Due and overdue" obligations list (a missed or due report can be excused with a note).
 */
export function ReportingCadencePanel({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuth();
  const canViewReports = hasPermission("reports:view_all");
  const canExcuse = hasPermission("reports:approve_completion");

  const overview = useCadenceOverviewQuery(projectId, canViewReports);
  const due = useDueObligationsQuery(projectId, canViewReports);
  const excuseObligation = useExcuseObligationMutation(projectId);
  const [excusingId, setExcusingId] = useState<string | null>(null);

  const o = overview.data;
  const tz = o?.settings.timezone ?? "Africa/Lagos";
  const noun = o ? periodNoun(o.settings.reportingCadence) : null;

  const obligationColumns: TableColumnDef<ReportingObligationDto>[] = [
    {
      id: "period",
      header: "Period",
      cell: (r) => (
        <span className="text-xs font-mono text-slate-700 whitespace-nowrap">
          {r.periodStart === r.periodEnd ? r.periodStart : `${r.periodStart} → ${r.periodEnd}`}
        </span>
      ),
    },
    { id: "wbs", header: "WBS item", cell: (r) => <span className="text-xs font-bold text-brand-navy whitespace-nowrap">WBS {r.wbsCode}</span> },
    { id: "who", header: "Owed by", cell: (r) => <span className="text-xs text-slate-700">{r.reporterScopeLabel}</span> },
    { id: "due", header: "Due", cell: (r) => <span className="text-xs text-slate-700 whitespace-nowrap">{formatDueLabel(r.dueAt, tz)} · {r.periodEnd}</span> },
    { id: "status", header: "Status", cell: (r) => <TableBadge variant={OBLIGATION_META[r.status].variant}>{OBLIGATION_META[r.status].label}</TableBadge> },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) =>
        canExcuse && (r.status === "MISSED" || r.status === "PENDING") ? (
          <button
            type="button"
            className="text-xs font-semibold text-brand-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setExcusingId(r.id);
            }}
          >
            Excuse
          </button>
        ) : null,
    },
  ];

  if (!canViewReports) return null;

  return (
    <div className="space-y-5">
      {o && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="Current period"
            value={o.currentPeriod ? (o.currentPeriod.periodStart === o.currentPeriod.periodEnd ? o.currentPeriod.periodStart : `${o.currentPeriod.periodStart} → ${o.currentPeriod.periodEnd}`) : "No periods"}
            subtitle={o.currentPeriod ? `${noun?.report} due ${formatDueLabel(o.currentPeriod.dueAt, tz)}` : "Inspections only"}
            icon={<CalendarClock className="w-4 h-4" />}
            iconVariant="blue"
          />
          <KpiCard
            title="Reports in this period"
            value={`${o.counts.submitted + o.counts.late} / ${o.obligations.length}`}
            subtitle={`${o.counts.pending} still due`}
            icon={<ClipboardCheck className="w-4 h-4" />}
            iconVariant="emerald"
          />
          <KpiCard
            title="Late or missed this period"
            value={o.counts.late + o.counts.missed}
            subtitle={`${o.counts.late} late · ${o.counts.missed} missed`}
            icon={<AlarmClock className="w-4 h-4" />}
            iconVariant={o.counts.late + o.counts.missed > 0 ? "amber" : "slate"}
          />
        </div>
      )}
      {o?.pendingChange && (
        <p className="text-xs text-slate-600">A reporting cadence change takes effect on {o.pendingChange.effectiveFrom}.</p>
      )}

      {canViewReports && (
        <StandardTable
          title="Due and overdue"
          subtitle="Reports owed for each scheduled WBS item and period. Late reports are accepted and flagged; missed ones can be excused with a note."
          columns={obligationColumns}
          data={due.data ?? []}
          keyExtractor={(r) => r.id}
          loading={due.isLoading}
          emptyState={{ title: "Nothing due or overdue", description: "Obligations appear when a reporting period opens for the scheduled WBS items." }}
        />
      )}

      {excusingId && (
        <NoteDialog
          title="Excuse this report"
          busy={excuseObligation.isPending}
          onCancel={() => setExcusingId(null)}
          onConfirm={async (notes) => {
            try {
              await excuseObligation.mutateAsync({ obligationId: excusingId, notes });
              setExcusingId(null);
            } catch {
              /* the mutation shows the error */
            }
          }}
        />
      )}
    </div>
  );
}
