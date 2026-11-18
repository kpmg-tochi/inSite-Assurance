import React from "react";
import { Wallet, CheckCircle2, AlertTriangle } from "lucide-react";
import type {
  FieldEvidenceLogRecordDto,
  IpcDetailsDto,
  ProjectSummaryDto,
} from "../../api/types";
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

interface PortfolioDashboardPageProps {
  project: ProjectSummaryDto;
  evidenceLogs: FieldEvidenceLogRecordDto[];
  latestIpc: IpcDetailsDto | null;
  onNavigateToReconciliation: () => void;
}

export function PortfolioDashboardPage({
  project,
  evidenceLogs,
  latestIpc,
  onNavigateToReconciliation,
}: PortfolioDashboardPageProps) {
  const { hasPermission } = useAuth();

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

  const latestConfirmedLog = evidenceLogs[0] || null;

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
            <span className="text-amber-700 font-medium">
              {project.unfulfilledHoldPointCount} Unfulfilled Hold-Point
              {project.unfulfilledHoldPointCount === 1 ? "" : "s"}
            </span>
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

      {/* 3. Bottom 3-Card Telemetry, Field Log & Tranche Readiness Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Card A: Corridor / Boundary Telemetry */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-900">
              Geofence &amp; Integrity Telemetry
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Cryptographic device signature &amp; coordinate screening
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Geofence Mode</span>
                <span className="font-semibold text-slate-800">
                  {project.geofenceMode === "LINEAR_CORRIDOR"
                    ? "Linear Highway Corridor"
                    : "Radial Site Boundary"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Verified Field Logs</span>
                <span className="font-semibold text-emerald-700">
                  {evidenceLogs.filter((l) => l.integrityPassed).length} /{" "}
                  {evidenceLogs.length} Passed
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
                Latest Confirmed Field Log
              </div>
              {latestConfirmedLog && (
                <span className="text-[10px] text-slate-400">
                  {formatDateTimeShort(latestConfirmedLog.capturedAtDevice)}
                </span>
              )}
            </div>
            {latestConfirmedLog ? (
              <div className="mt-2.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-brand-primary">
                    {latestConfirmedLog.chainageLabel || "Site Pin"} · WBS{" "}
                    {latestConfirmedLog.boqItem?.wbsCode || "General"}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatReporterRoleBadge(
                      latestConfirmedLog.reporterRoleName,
                      latestConfirmedLog.fieldPersonaType,
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-700 bg-slate-50 rounded-xl p-2.5 border border-slate-200/70 leading-relaxed">
                  {latestConfirmedLog.confirmedSummary ||
                    latestConfirmedLog.rawWhisperTranscript ||
                    latestConfirmedLog.rawTextNote}
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    Reporter:{" "}
                    {latestConfirmedLog.fieldSession?.agentFullName ||
                      "Field Agent"}
                  </span>
                  <span className="text-emerald-700 font-medium">
                    Device Signature: Verified
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-4">
                No field evidence logs captured yet for this project.
              </p>
            )}
          </div>
        </div>

        {/* Card C: Tranche Readiness & CPs */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-900">
                Active Project Tranche Readiness
              </div>
              {activeTranche && (
                <span className="text-[10px] font-bold text-brand-primary bg-blue-50 px-2 py-0.5 rounded">
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
                <div className="space-y-1.5">
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
                </div>
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

      {/* Contractor Assurance Verification Queue */}
      <div className="mt-4">
        <ContractorVerificationQueue projectId={project.id} />
      </div>
    </div>
  );
}
