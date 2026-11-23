import React from "react";
import { Wallet, CheckCircle2, AlertTriangle } from "lucide-react";
import { geofenceModeLabel, type CaptureListItemDto } from "@insite/shared";
import type { IpcClaimDto, ProjectSummaryDto } from "../../api/types";
import {
  formatCompactNaira,
  formatDateTimeShort,
  formatNaira,
} from "../../lib/formatters";
import { LiveGeospatialMap } from "../../components/LiveGeospatialMap";
import { formatReporterRoleBadge } from "../../components/EvidenceBadge";
import { useAuth } from "../../lib/auth-context";
import ContractorVerificationQueue from "../../components/ContractorVerificationQueue";
import { KpiCard } from "../../components/common";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { ScheduleBadge } from "../../components/schedule/ScheduleVarianceBadge";
import { InspectionOverviewCard } from "../../components/inspections/InspectionOverviewCard";
import { ProjectKpisCard } from "../../components/kpis/ProjectKpisCard";
import { NextDeadlinesCard, OpenDefaultCasesCard } from "../../components/contracts/ContractOverviewCards";
import { DEFAULT_CASE_VIEW_PERMISSIONS, MILESTONE_VIEW_PERMISSIONS } from "../../components/contracts/contractUi";

interface PortfolioDashboardPageProps {
  project: ProjectSummaryDto;
  evidenceLogs: CaptureListItemDto[];
  latestIpc: IpcClaimDto | null;
  onNavigateToReconciliation: () => void;
}

export function PortfolioDashboardPage({
  project,
  evidenceLogs,
  latestIpc,
  onNavigateToReconciliation,
}: PortfolioDashboardPageProps) {
  const { hasPermission, hasAnyPermission } = useAuth();
  // Phase 7: hide modules the project's process turned off.
  const processQuery = useProjectProcess(project.id);
  const tranchesOn = processQuery.data?.config.enableTranchesAndCps ?? true;
  const holdPointsOn = processQuery.data?.config.enableHoldPoints ?? true;

  const activeTranche =
    project.tranches.find((t) => !t.isReleased) || project.tranches[0] || null;

  const satisfiedCpCount = activeTranche
    ? activeTranche.conditionsPrecedent.filter(
        (cp) => cp.status === "SATISFIED" || cp.status === "WAIVED",
      ).length
    : 0;
  const totalCpCount = activeTranche
    ? activeTranche.conditionsPrecedent.length
    : 0;

  // Newest capture that is part of a submitted report.
  const latestConfirmedLog = evidenceLogs.find((c) => c.workdayReportId !== null) || null;
  const signedCount = evidenceLogs.filter((c) => c.signatureVerified === true).length;

  const isContractorOnly =
    hasPermission("ipc:submit_claim") && !hasPermission("ipc:certify_valuation");
  const isLenderApprover =
    hasPermission("tranche:approve_disbursement") &&
    !hasPermission("ipc:certify_valuation");

  const actionButtonLabel = isLenderApprover
    ? "Review Tranche Release"
    : isContractorOnly
      ? "Manage IPC Claims"
      : "Review IPC";

  return (
    <div className="space-y-3">
      {/* 1. Top ~50% Viewport Live Geospatial Map */}
      <LiveGeospatialMap project={project} evidenceLogs={evidenceLogs} />

      {/* 2. Minimal 3-Column Standard KPI Card Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={<Wallet className="w-4 h-4" />}
          iconVariant="blue"
          title={
            isContractorOnly
              ? "Contract Value & Drawdowns"
              : "Project Commitment"
          }
          value={formatCompactNaira(project.totalBudgetNgn)}
          subtitle={`${formatCompactNaira(project.disbursedToDateNgn)} Disbursed (${
            project.totalBudgetNgn > 0
              ? (
                  (project.disbursedToDateNgn / project.totalBudgetNgn) *
                  100
                ).toFixed(1)
              : "0.0"
          }%)`}
        />

        <KpiCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconVariant="emerald"
          title="Verified Progress"
          value={`${project.certifiedProgressPct.toFixed(1)}%`}
          badge={<ScheduleBadge badge={project.scheduleVariance} size="xs" />}
          subtitle={
            latestIpc
              ? `Latest Claim: IPC #${String(latestIpc.ipcNumber).padStart(
                  2,
                  "0",
                )} (${formatCompactNaira(latestIpc.totalClaimedAmountNgn)})`
              : "Baseline established"
          }
        />

        <KpiCard
          icon={<AlertTriangle className="w-4 h-4" />}
          iconVariant="amber"
          title={
            isContractorOnly
              ? "Open Monitor Queries"
              : "Reconciliation Alerts"
          }
          value={`${project.openConflictCount} ${
            isContractorOnly ? "Open Query" : "Conflict"
          }${project.openConflictCount === 1 ? "" : "s"}`}
          subtitle={
            holdPointsOn ? (
              <span className="text-amber-700 font-medium">
                {project.unfulfilledHoldPointCount} Unfulfilled Hold-Point
                {project.unfulfilledHoldPointCount === 1 ? "" : "s"}
              </span>
            ) : undefined
          }
          action={
            <button
              type="button"
              onClick={onNavigateToReconciliation}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-brand-primary transition"
            >
              {actionButtonLabel}
            </button>
          }
        />
      </div>

      {/* Phase 13: next contract deadlines and open default cases */}
      {(hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) || hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS)) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 empty:hidden">
          {hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) && <NextDeadlinesCard projectId={project.id} />}
          {hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS) && <OpenDefaultCasesCard projectId={project.id} />}
        </div>
      )}

      {/* Phase 14: last inspection per visit type, next due inspection, open findings, baseline */}
      {hasPermission("inspections:view") && <InspectionOverviewCard projectId={project.id} />}

      {/* Phase 16: the project's KPIs against its project type's targets */}
      {hasPermission("kpis:view") && project.status !== "DRAFT" && <ProjectKpisCard projectId={project.id} />}

      {/* 3. Bottom 3-Card Telemetry, Field Log & Tranche Readiness Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Card A: Geofence / Boundary Telemetry */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-900">
              Geofence &amp; Integrity Telemetry
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
                    {latestConfirmedLog.chainageLabel || "Site Pin"} · WBS{" "}
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

        {/* Card C: Tranche Readiness & CPs */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-900">
                {tranchesOn ? "Active Project Tranche Readiness" : "Release Readiness"}
              </div>
              {activeTranche && tranchesOn && (
                <span className="text-[10px] font-bold text-brand-primary bg-brand-primary/5 px-2 py-0.5 rounded">
                  Tranche #{activeTranche.trancheNumber}
                </span>
              )}
            </div>
            {activeTranche ? (
              <div className="mt-2.5 space-y-2.5">
                <div>
                  <div className="text-xs font-semibold text-slate-800">
                    {activeTranche.name}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Allocation: {formatNaira(activeTranche.allocatedAmountNgn)}{" "}
                    · Target: {activeTranche.targetCompletionPct}%
                  </div>
                </div>
                {tranchesOn && <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">
                      Conditions Precedent Satisfied
                    </span>
                    <span className="font-semibold text-slate-800">
                      {satisfiedCpCount} / {totalCpCount} CPs
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      style={{
                        width: `${
                          totalCpCount > 0
                            ? Math.round(
                                (satisfiedCpCount / totalCpCount) * 100,
                              )
                            : 100
                        }%`,
                      }}
                      className="h-full bg-brand-primary rounded-full"
                    />
                  </div>
                </div>}
                <div className="pt-1 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">
                    Holdback Recommendation
                  </span>
                  <span className="font-semibold text-amber-700">
                    {latestIpc?.valuationReport
                      ? formatCompactNaira(
                          latestIpc.valuationReport
                            .recommendedHoldbackAmountNgn,
                        )
                      : "Pending Valuation"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-4">
                No project tranches configured.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Contractor Assurance Verification Queue: only for roles that can review credentials */}
      {hasPermission("assurance:review_credentials") && (
        <div className="mt-4">
          <ContractorVerificationQueue projectId={project.id} />
        </div>
      )}
    </div>
  );
}
