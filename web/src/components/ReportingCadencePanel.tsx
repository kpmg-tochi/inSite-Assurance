import React, { useState } from "react";
import { AlarmClock, CalendarClock, ClipboardCheck, UserX } from "lucide-react";
import {
  formatDueLabel,
  periodNoun,
  type AttendanceAlertStatus,
  type AttendanceAlertType,
  type ReportingObligationDto,
  type ReportingObligationStatus,
  type SiteAttendanceAlertDto,
} from "@insite/shared";
import { useAuth } from "../lib/auth-context";
import { KpiCard, Overlay } from "./common";
import { StandardTable, TableBadge, type TableBadgeVariant, type TableColumnDef } from "./table";
import {
  useAttendanceAlertsQuery,
  useCadenceOverviewQuery,
  useDueObligationsQuery,
} from "../queries/cadence/useCadenceQueries";
import { useAttendanceAlertActionMutation, useExcuseObligationMutation } from "../mutations/cadence/useCadenceMutations";

const OBLIGATION_META: Record<ReportingObligationStatus, { label: string; variant: TableBadgeVariant }> = {
  PENDING: { label: "Due", variant: "info" },
  SUBMITTED: { label: "Submitted", variant: "success" },
  LATE: { label: "Late", variant: "warning" },
  MISSED: { label: "Missed", variant: "danger" },
  EXCUSED: { label: "Excused", variant: "neutral" },
};

const ALERT_TYPE_LABEL: Record<AttendanceAlertType, string> = {
  MOBILIZATION_NO_SHOW: "No-show on mobilization day",
  WORKDAY_MISSED_CHECKIN: "Missed check-in",
  UNVERIFIED_AT_MOBILIZATION: "Not registered / verified",
};

const ALERT_STATUS_META: Record<AttendanceAlertStatus, { label: string; variant: TableBadgeVariant }> = {
  OPEN: { label: "Open", variant: "danger" },
  ACKNOWLEDGED: { label: "Acknowledged", variant: "warning" },
  EXCUSED: { label: "Excused", variant: "neutral" },
  RESOLVED: { label: "Resolved", variant: "success" },
};

/** A note prompt shared by "excuse" actions (a note is required and audited). */
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
 * Phase 8: reporting cadence and attendance on the site presence tab. Counts for the current period,
 * the "Due and overdue" list and the attendance alerts panel.
 */
export function ReportingCadencePanel({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuth();
  const canViewReports = hasPermission("reports:view_all");
  const canManageAlerts = hasPermission("presence:manage_noshow_alerts");
  const canSeeAlerts = canManageAlerts || hasPermission("presence:view_telemetry");

  const overview = useCadenceOverviewQuery(projectId, canViewReports);
  const due = useDueObligationsQuery(projectId, canViewReports);
  const [statusFilter, setStatusFilter] = useState<AttendanceAlertStatus[]>(["OPEN", "ACKNOWLEDGED"]);
  const [typeFilter, setTypeFilter] = useState<AttendanceAlertType | "">("");
  const alerts = useAttendanceAlertsQuery(projectId, { status: statusFilter, type: typeFilter ? [typeFilter] : undefined }, canSeeAlerts);
  const excuseObligation = useExcuseObligationMutation(projectId);
  const alertAction = useAttendanceAlertActionMutation(projectId);
  const [excusing, setExcusing] = useState<{ kind: "obligation" | "alert"; id: string } | null>(null);

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
        canManageAlerts && (r.status === "MISSED" || r.status === "PENDING") ? (
          <button
            type="button"
            className="text-xs font-semibold text-brand-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setExcusing({ kind: "obligation", id: r.id });
            }}
          >
            Excuse
          </button>
        ) : null,
    },
  ];

  const alertColumns: TableColumnDef<SiteAttendanceAlertDto>[] = [
    { id: "date", header: "Day", cell: (a) => <span className="text-xs font-mono text-slate-700">{a.workdayDate}</span> },
    { id: "who", header: "Person", cell: (a) => <span className="text-xs font-semibold text-slate-800">{a.participantName ?? "—"}</span> },
    { id: "type", header: "Alert", cell: (a) => <span className="text-xs text-slate-700">{ALERT_TYPE_LABEL[a.alertType]}</span> },
    {
      id: "status",
      header: "Status",
      cell: (a) => (
        <div className="space-y-0.5">
          <TableBadge variant={ALERT_STATUS_META[a.status].variant}>{ALERT_STATUS_META[a.status].label}</TableBadge>
          {a.resolutionNotes && <p className="text-[11px] text-slate-500 max-w-xs truncate" title={a.resolutionNotes}>{a.resolutionNotes}</p>}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (a) =>
        canManageAlerts && (a.status === "OPEN" || a.status === "ACKNOWLEDGED") ? (
          <div className="flex justify-end gap-3 text-xs font-semibold">
            {a.status === "OPEN" && (
              <button type="button" className="text-slate-600 hover:underline" onClick={() => alertAction.mutate({ alertId: a.id, body: { action: "ACKNOWLEDGE" } })}>
                Acknowledge
              </button>
            )}
            <button type="button" className="text-slate-600 hover:underline" onClick={() => setExcusing({ kind: "alert", id: a.id })}>
              Excuse
            </button>
            <button type="button" className="text-brand-primary hover:underline" onClick={() => alertAction.mutate({ alertId: a.id, body: { action: "RESOLVE" } })}>
              Resolve
            </button>
          </div>
        ) : null,
    },
  ];

  if (!canViewReports && !canSeeAlerts) return null;

  return (
    <div className="space-y-5">
      {o && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <KpiCard
            title="Open attendance alerts"
            value={o.counts.openAttendanceAlerts}
            icon={<UserX className="w-4 h-4" />}
            iconVariant={o.counts.openAttendanceAlerts > 0 ? "rose" : "slate"}
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
          emptyState={{ title: "Nothing due or overdue", description: "Obligations appear when the period's briefs go out." }}
        />
      )}

      {canSeeAlerts && (
        <StandardTable
          title="Attendance alerts"
          subtitle="Raised when someone expected does not check in on site by their expected time plus grace, or is not registered on their mobilization day."
          columns={alertColumns}
          data={alerts.data ?? []}
          keyExtractor={(a) => a.id}
          loading={alerts.isLoading}
          filters={
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {(Object.keys(ALERT_STATUS_META) as AttendanceAlertStatus[]).map((s) => (
                <label key={s} className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-primary"
                    checked={statusFilter.includes(s)}
                    onChange={() => setStatusFilter((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]))}
                  />
                  {ALERT_STATUS_META[s].label}
                </label>
              ))}
              <select
                aria-label="Alert type"
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as AttendanceAlertType | "")}
              >
                <option value="">All alert types</option>
                {(Object.keys(ALERT_TYPE_LABEL) as AttendanceAlertType[]).map((t) => (
                  <option key={t} value={t}>{ALERT_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          }
          emptyState={{ title: "No attendance alerts", description: "Pre-register expected people in project settings → Team to get alerts." }}
        />
      )}

      {excusing && (
        <NoteDialog
          title={excusing.kind === "obligation" ? "Excuse this report" : "Excuse this alert"}
          busy={excuseObligation.isPending || alertAction.isPending}
          onCancel={() => setExcusing(null)}
          onConfirm={async (notes) => {
            try {
              if (excusing.kind === "obligation") await excuseObligation.mutateAsync({ obligationId: excusing.id, notes });
              else await alertAction.mutateAsync({ alertId: excusing.id, body: { action: "EXCUSE", notes } });
              setExcusing(null);
            } catch {
              /* the mutation shows the error */
            }
          }}
        />
      )}
    </div>
  );
}
