import React from "react";
import { Link } from "react-router-dom";
import { Wallet, CheckCircle2, CalendarClock } from "lucide-react";
import { geofenceModeLabel, type CaptureListItemDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira, formatDateTimeShort, formatNaira } from "../../lib/formatters";
import { LiveGeospatialMap } from "../../components/LiveGeospatialMap";
import { formatReporterRoleBadge } from "../../components/reporterRole";
import { useAuth, useTerm } from "../../lib/auth-context";
import { KpiCard } from "../../components/common";
import { ScheduleBadge } from "../../components/schedule/ScheduleVarianceBadge";
import { ProjectKpisCard } from "../../components/kpis/ProjectKpisCard";
import { NextDeadlinesCard, OpenDefaultCasesCard } from "../../components/contracts/ContractOverviewCards";
import { DEFAULT_CASE_VIEW_PERMISSIONS, MILESTONE_VIEW_PERMISSIONS } from "../../components/contracts/contractUi";
import { useProjectPaymentsQuery } from "../../queries/payments/usePaymentsQueries";

interface PortfolioDashboardPageProps {
  project: ProjectSummaryDto;
  evidenceLogs: CaptureListItemDto[];
}

/** The project overview: map, headline figures, deadlines, inspections, KPIs and recent capture. */
export function PortfolioDashboardPage({ project, evidenceLogs }: PortfolioDashboardPageProps) {
  const { hasPermission, hasAnyPermission } = useAuth();
  const term = useTerm();
  const canSeePayments = hasPermission("payments:view") || hasPermission("payments:record");
  const payments = useProjectPaymentsQuery(project.id, canSeePayments);

  // Newest capture that is part of a submitted report.
  const latestConfirmedLog = evidenceLogs.find((c) => c.workdayReportId !== null) || null;
  const signedCount = evidenceLogs.filter((c) => c.signatureVerified === true).length;
  const paidPct = project.totalBudgetNgn > 0 ? ((project.disbursedToDateNgn / project.totalBudgetNgn) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-3">
      <LiveGeospatialMap project={project} evidenceLogs={evidenceLogs} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={<Wallet className="w-4 h-4" />}
          iconVariant="blue"
          title="Budget"
          value={formatCompactNaira(project.totalBudgetNgn)}
          subtitle={`${formatCompactNaira(project.disbursedToDateNgn)} paid (${paidPct}%)`}
        />
        <KpiCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconVariant="emerald"
          title="Progress"
          value={`${project.certifiedProgressPct.toFixed(1)}%`}
          badge={<ScheduleBadge badge={project.scheduleVariance} size="xs" />}
          subtitle="From approved field reports"
        />
        <KpiCard
          icon={<CalendarClock className="w-4 h-4" />}
          iconVariant="amber"
          title="Overdue contract milestones"
          value={project.overdueMilestoneCount ?? 0}
          subtitle="Kick-off, mobilisation and other contract deadlines"
        />
      </div>

      {/* Phase 13: next contract deadlines and open default cases */}
      {(hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) || hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS)) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 empty:hidden">
          {hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) && <NextDeadlinesCard projectId={project.id} />}
          {hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS) && <OpenDefaultCasesCard projectId={project.id} />}
        </div>
      )}

      {/* Phase 16: the project's KPIs against its project type's targets */}
      {hasPermission("kpis:view") && project.status !== "DRAFT" && <ProjectKpisCard projectId={project.id} />}

      {/* 3. Bottom 3-card grid: capture integrity, latest capture, payments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Card A: geofence and capture integrity */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-900">
              Geofence &amp; Capture Integrity
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Results computed by the server for each capture
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Geofence Mode</span>
                <span className="font-semibold text-slate-800">
                  {geofenceModeLabel(project.geofence?.mode ?? project.geofenceMode)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Tolerance band</span>
                <span className="font-semibold text-slate-800">
                  {project.geofence && project.geofenceToleranceMeters > 0
                    ? `${project.geofenceToleranceMeters.toLocaleString()} m`
                    : "None"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Captures passing integrity</span>
                <span className="font-semibold text-slate-800">
                  {evidenceLogs.length === 0
                    ? "No data"
                    : `${evidenceLogs.filter((l) => l.integrityPassed).length} / ${evidenceLogs.length}`}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Device signature checked</span>
                <span className="font-semibold text-slate-800">
                  {evidenceLogs.length === 0 ? "No data" : `${signedCount} / ${evidenceLogs.length}`}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">BOQ Opacity Screening</span>
                <span className="font-semibold text-slate-800">
                  {project.opaqueLumpSumCount} Opaque Item
                  {project.opaqueLumpSumCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Reporting Cadence</span>
                <span className="font-semibold text-slate-800">
                  {project.reportingCadence}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card B: Latest Confirmed Field Log */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-900">
                Latest Reported Capture
              </div>
              {latestConfirmedLog && (
                <span className="text-[10px] text-slate-400">
                  {formatDateTimeShort(latestConfirmedLog.capturedAt)}
                </span>
              )}
            </div>
            {latestConfirmedLog ? (
              <div className="mt-2.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-brand-primary">
                    Site Pin · WBS{" "}
                    {latestConfirmedLog.wbsCode || "not linked"}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatReporterRoleBadge(
                      latestConfirmedLog.reporterRoleName,
                      latestConfirmedLog.fieldPersonaType,
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-700 bg-slate-50 rounded-xl p-2.5 border border-slate-200/70 leading-relaxed">
                  {latestConfirmedLog.caption ||
                    (latestConfirmedLog.transcriptionStatus === "DONE"
                      ? latestConfirmedLog.transcript
                      : null) ||
                    (latestConfirmedLog.mediaType === "VOICE_NOTE"
                      ? "Voice note (not transcribed)"
                      : "Photo without caption")}
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    Reporter: {latestConfirmedLog.reporterName}
                  </span>
                  <span
                    className={
                      latestConfirmedLog.signatureVerified === true
                        ? "text-emerald-700 font-medium"
                        : latestConfirmedLog.signatureVerified === false
                          ? "text-rose-700 font-medium"
                          : "text-slate-500"
                    }
                  >
                    {latestConfirmedLog.signatureVerified === true
                      ? "Device signature checked"
                      : latestConfirmedLog.signatureVerified === false
                        ? "Device signature invalid"
                        : "Not signed by device"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-4">
                No reported captures yet for this project.
              </p>
            )}
          </div>
        </div>

        {/* Card C: payments (recorded; made outside the platform) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-900">Payments</div>
              {canSeePayments && (
                <Link to={`/app/projects/${project.id}/payments`} className="text-[11px] font-semibold text-brand-primary hover:underline">
                  Open
                </Link>
              )}
            </div>
            {!canSeePayments ? (
              <p className="text-xs text-slate-400 mt-4">Payment details are visible to finance and monitoring staff.</p>
            ) : payments.data ? (
              <div className="mt-2.5 space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Paid to date</span>
                  <span className="font-semibold text-slate-800">{formatNaira(payments.data.paidGrossNgn)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">{term("retention")} held now</span>
                  <span className="font-semibold text-slate-800">{formatNaira(payments.data.retentionBalanceNgn)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Exceptions</span>
                  <span className={`font-semibold ${payments.data.exceptionCount > 0 ? "text-amber-700" : "text-slate-800"}`}>
                    {payments.data.exceptionCount}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-4">Loading…</p>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
