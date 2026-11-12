import React, { useState } from 'react';
import { Wallet, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import type { CreateProjectRequest } from '@insite/shared';
import type {
  FieldEvidenceLogRecordDto,
  IpcDetailsDto,
  ProjectSummaryDto,
} from '../../api/types';
import {
  formatCompactNaira,
  formatDateTimeShort,
  formatNaira,
} from '../../lib/formatters';
import { LiveGeospatialMap } from '../../components/LiveGeospatialMap';
import { formatIndependenceTierText } from '../../components/EvidenceBadge';
import { useAuth } from '../../lib/auth-context';

interface PortfolioDashboardPageProps {
  project: ProjectSummaryDto;
  evidenceLogs: FieldEvidenceLogRecordDto[];
  latestIpc: IpcDetailsDto | null;
  onNavigateToReconciliation: () => void;
  onCreateProject?: (payload: CreateProjectRequest) => Promise<void>;
  showNewProjectModal: boolean;
  onCloseNewProjectModal: () => void;
}

export function PortfolioDashboardPage({
  project,
  evidenceLogs,
  latestIpc,
  onNavigateToReconciliation,
  onCreateProject,
  showNewProjectModal,
  onCloseNewProjectModal,
}: PortfolioDashboardPageProps) {
  const { user } = useAuth();
  const [newProjectName, setNewProjectName] = useState('');
  const [newCodePrefix, setNewCodePrefix] = useState('KAD-205');
  const [newStateLocation, setNewStateLocation] = useState('Kaduna State');
  const [newTotalBudget, setNewTotalBudget] = useState('8500000000');
  const [newGeofenceMode, setNewGeofenceMode] = useState<
    'LINEAR_CORRIDOR' | 'RADIAL'
  >('LINEAR_CORRIDOR');
  const [creatingProject, setCreatingProject] = useState(false);

  const activeTranche =
    project.tranches.find((t) => !t.isReleased) || project.tranches[0] || null;

  const satisfiedCpCount = activeTranche
    ? activeTranche.conditionsPrecedent.filter(
        (cp) => cp.status === 'SATISFIED' || cp.status === 'WAIVED'
      ).length
    : 0;
  const totalCpCount = activeTranche
    ? activeTranche.conditionsPrecedent.length
    : 0;

  const latestConfirmedLog = evidenceLogs[0] || null;

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateProject || !newProjectName.trim()) return;
    try {
      setCreatingProject(true);
      const budgetNum = Number(newTotalBudget) || 5_000_000_000;
      await onCreateProject({
        name: newProjectName.trim(),
        codePrefix: newCodePrefix.trim().toUpperCase(),
        description: `${newProjectName.trim()} capital infrastructure monitoring baseline.`,
        stateLocation: newStateLocation.trim(),
        lgaLocation: 'Municipal Corridor',
        totalBudgetNgn: budgetNum,
        reportingCadence: 'WEEKLY',
        lenderOrganizationName: 'InfraCredit',
        contractorOrganizationName: 'J&S Civil Eng.',
        geofence:
          newGeofenceMode === 'LINEAR_CORRIDOR'
            ? {
                mode: 'LINEAR_CORRIDOR',
                corridorHalfWidthMeters: 150,
                startChainageKm: 0,
                centerlineCoordinates: [
                  [7.4295, 10.5105],
                  [7.445, 10.525],
                  [7.462, 10.541],
                ],
              }
            : {
                mode: 'RADIAL',
                center: {
                  latitude: 9.0579,
                  longitude: 7.4951,
                },
                radiusMeters: 600,
              },
        tranches: [
          {
            trancheNumber: 1,
            name: 'Tranche 1 — Mobilization & Sub-structure',
            allocatedAmountNgn: Math.round(budgetNum * 0.35),
            targetCompletionPct: 35,
            conditionsPrecedent: [
              {
                referenceCode: 'CP-01',
                description:
                  'Execution of Performance Bond and Advance Payment Guarantee',
                isMandatoryForRelease: true,
                status: 'SATISFIED',
              },
              {
                referenceCode: 'CP-02',
                description:
                  'Independent Monitor verification of right-of-way handover',
                isMandatoryForRelease: true,
                status: 'SATISFIED',
              },
            ],
          },
          {
            trancheNumber: 2,
            name: 'Tranche 2 — Superstructure & Civil Works',
            allocatedAmountNgn: Math.round(budgetNum * 0.65),
            targetCompletionPct: 100,
            conditionsPrecedent: [
              {
                referenceCode: 'CP-03',
                description:
                  'Zero unresolved Hold-Point non-conformances on Tranche 1 works',
                isMandatoryForRelease: true,
                status: 'PENDING',
              },
            ],
          },
        ],
      });
      onCloseNewProjectModal();
      setNewProjectName('');
    } finally {
      setCreatingProject(false);
    }
  };

  const actionButtonLabel =
    user?.role === 'LENDER'
      ? 'Review Tranche Release'
      : user?.role === 'CONTRACTOR'
        ? 'Manage IPC Claims'
        : 'Review IPC';

  return (
    <div className="space-y-3">
      {/* 1. Top ~50% Viewport Live Geospatial Map */}
      <LiveGeospatialMap project={project} evidenceLogs={evidenceLogs} />

      {/* 2. Minimal 3-Column KPI Strip (Sparse Lucide Icons only in top-left icon squares) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-brand-primary flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              {user?.role === 'CONTRACTOR'
                ? 'Contract Value & Drawdowns'
                : 'Facility Commitment'}
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {formatCompactNaira(project.totalBudgetNgn)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {formatCompactNaira(project.disbursedToDateNgn)} Disbursed (
              {project.totalBudgetNgn > 0
                ? (
                    (project.disbursedToDateNgn / project.totalBudgetNgn) *
                    100
                  ).toFixed(1)
                : '0.0'}
              %)
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              Verified Progress
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {project.certifiedProgressPct.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {latestIpc
                ? `Latest Claim: IPC #${String(latestIpc.ipcNumber).padStart(
                    2,
                    '0'
                  )} (${formatCompactNaira(latestIpc.totalClaimedAmountNgn)})`
                : 'Baseline established'}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              {user?.role === 'CONTRACTOR'
                ? 'Open Monitor Queries'
                : 'Reconciliation Alerts'}
            </span>
          </div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold text-slate-900">
                {project.openConflictCount}{' '}
                {user?.role === 'CONTRACTOR' ? 'Open Query' : 'Conflict'}
                {project.openConflictCount === 1 ? '' : 's'}
              </div>
              <div className="text-xs text-amber-700 font-medium mt-0.5">
                {project.unfulfilledHoldPointCount} Unfulfilled Hold-Point
                {project.unfulfilledHoldPointCount === 1 ? '' : 's'}
              </div>
            </div>
            <button
              type="button"
              onClick={onNavigateToReconciliation}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-brand-primary transition"
            >
              {actionButtonLabel}
            </button>
          </div>
        </div>
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
                  {project.geofenceMode === 'LINEAR_CORRIDOR'
                    ? 'Linear Highway Corridor'
                    : 'Radial Site Boundary'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Verified Field Logs</span>
                <span className="font-semibold text-emerald-700">
                  {evidenceLogs.filter((l) => l.integrityPassed).length} /{' '}
                  {evidenceLogs.length} Passed
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">BOQ Opacity Screening</span>
                <span className="font-semibold text-slate-800">
                  {project.opaqueLumpSumCount} Opaque Item
                  {project.opaqueLumpSumCount === 1 ? '' : 's'}
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
                    {latestConfirmedLog.chainageLabel || 'Site Pin'} · WBS{' '}
                    {latestConfirmedLog.boqItem?.wbsCode || 'General'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatIndependenceTierText(
                      latestConfirmedLog.independenceTier
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
                    Reporter:{' '}
                    {latestConfirmedLog.fieldSession?.agentFullName ||
                      'Field Agent'}
                  </span>
                  <span>
                    SHA-256: {latestConfirmedLog.deviceSignatureHash.slice(0, 8)}
                    ...
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
                Active Facility Tranche Readiness
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
                    Allocation: {formatNaira(activeTranche.allocatedAmountNgn)} ·
                    Target: {activeTranche.targetCompletionPct}%
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
                            ? Math.round((satisfiedCpCount / totalCpCount) * 100)
                            : 100
                        }%`,
                      }}
                      className="h-full bg-brand-primary rounded-full"
                    />
                  </div>
                </div>
                <div className="pt-1 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Holdback Recommendation</span>
                  <span className="font-semibold text-amber-700">
                    {latestIpc?.valuationReport
                      ? formatCompactNaira(
                          latestIpc.valuationReport.recommendedHoldbackAmountNgn
                        )
                      : 'Pending Valuation'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-4">
                No facility tranches configured.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* New Project Baseline Modal (Monitor Role) */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-slate-950/35 backdrop-blur-[1px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 bg-brand-navy text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Initialize New Capital Project Baseline
                </h3>
                <p className="text-[11px] text-blue-200/80">
                  Generates role-segregated mobile join codes (-INS, -COW, -CON)
                  and geofence boundary
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseNewProjectModal}
                className="p-1 rounded-lg text-blue-200 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Project Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g., Kaduna Eastern Bypass Phase II"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Code Prefix
                  </label>
                  <input
                    type="text"
                    required
                    value={newCodePrefix}
                    onChange={(e) => setNewCodePrefix(e.target.value)}
                    placeholder="KAD-205"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs uppercase focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    State / Corridor Location
                  </label>
                  <input
                    type="text"
                    required
                    value={newStateLocation}
                    onChange={(e) => setNewStateLocation(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Total Facility Budget (₦ NGN)
                  </label>
                  <input
                    type="number"
                    required
                    value={newTotalBudget}
                    onChange={(e) => setNewTotalBudget(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Geofence Verification Mode
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setNewGeofenceMode('LINEAR_CORRIDOR')}
                    className={`p-3 rounded-xl border text-left text-xs transition ${
                      newGeofenceMode === 'LINEAR_CORRIDOR'
                        ? 'border-brand-primary bg-blue-50/40 font-semibold text-brand-primary'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div>Linear Corridor (KM X+YYY)</div>
                    <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                      Roads, rail, transmission lines
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewGeofenceMode('RADIAL')}
                    className={`p-3 rounded-xl border text-left text-xs transition ${
                      newGeofenceMode === 'RADIAL'
                        ? 'border-brand-primary bg-blue-50/40 font-semibold text-brand-primary'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div>Radial Site Boundary</div>
                    <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                      Buildings, plants, mini-grids
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onCloseNewProjectModal}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProject}
                  className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {creatingProject
                    ? 'Initializing...'
                    : 'Create Baseline & Join Codes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
