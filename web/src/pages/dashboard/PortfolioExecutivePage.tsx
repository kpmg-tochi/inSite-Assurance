import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Building2,
  FileSpreadsheet,
  ArrowRight,
  Printer,
  Search,
  Filter,
  UserCheck,
  MapPin,
  ExternalLink,
  Briefcase,
  Layers,
  Landmark,
  ShieldAlert,
} from 'lucide-react';
import { usePortfolioExecutiveQuery } from '../../queries/projects/useContractorVerificationQueries';
import { formatCompactNaira, formatNaira } from '../../lib/formatters';
import type { PortfolioProjectHealthItem } from '../../api/types';
import Loader from '../../components/Loader';
import { useAuth } from '../../lib/auth-context';
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableColumnDef,
} from '../../components/table';

interface PortfolioExecutivePageProps {
  onSelectProject: (projectId: string) => void;
}

export function PortfolioExecutivePage({
  onSelectProject,
}: PortfolioExecutivePageProps) {
  const { user } = useAuth();
  const { data: summary, isLoading, refetch } = usePortfolioExecutiveQuery();
  const [searchTerm, setSearchTerm] = useState('');
  const [healthFilter, setHealthFilter] = useState<'ALL' | 'EVIDENCE_SUPPORTED' | 'EVIDENCE_PARTIAL' | 'EVIDENCE_CONFLICT'>('ALL');

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-12 flex flex-col items-center justify-center gap-3">
        <Loader size="md" />
        <span className="text-xs text-slate-500 font-medium">
          Loading Multi-Project Executive Surveillance Matrix...
        </span>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-xs text-slate-500">
        Unable to load portfolio executive data. Please check connection.
      </div>
    );
  }

  const disbursedPct = summary.totalPortfolioCommitmentNgn > 0
    ? Math.round((summary.totalDisbursedToDateNgn / summary.totalPortfolioCommitmentNgn) * 100)
    : 0;

  const filteredProjects = summary.projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.codePrefix.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.contractorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.stateLocation.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesHealth =
      healthFilter === 'ALL' || p.portfolioHealth === healthFilter;

    return matchesSearch && matchesHealth;
  });

  const portfolioColumns: TableColumnDef<PortfolioProjectHealthItem>[] = useMemo(
    () => [
      {
        id: 'facility',
        header: 'Facility & Location',
        tooltip: 'Project identifier prefix, state location, and official facility name',
        width: 'w-72',
        cell: (item) => (
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-brand-primary">
                {item.codePrefix}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-600">
                {item.stateLocation}
              </span>
            </div>
            <div
              className="font-semibold text-slate-900 text-xs mt-0.5 max-w-xs truncate"
              title={item.name}
            >
              {item.name}
            </div>
          </div>
        ),
      },
      {
        id: 'counterparties',
        header: 'Counterparties',
        tooltip: 'Contractor engineering firm and financing Lender',
        width: 'w-52',
        cell: (item) => (
          <div className="space-y-0.5">
            <div
              className="font-medium text-slate-800 truncate"
              title={item.contractorName}
            >
              {item.contractorName}
            </div>
            <div
              className="text-[11px] text-slate-500 truncate"
              title={`Lender: ${item.lenderName}`}
            >
              Lender: {item.lenderName}
            </div>
          </div>
        ),
      },
      {
        id: 'commitmentDrawn',
        header: 'Commitment & Drawn',
        tooltip:
          'Approved total facility commitment and cumulative disbursements drawn',
        align: 'right',
        width: 'w-44',
        cell: (item) => (
          <div className="text-right">
            <div className="font-bold text-slate-900">
              {formatNaira(item.totalBudgetNgn)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Drawn: {formatNaira(item.disbursedToDateNgn)}
            </div>
          </div>
        ),
      },
      {
        id: 'progress',
        header: 'Certified Progress',
        tooltip:
          'Independent Monitor certified physical completion percentage against active milestone tranche',
        width: 'w-36',
        cell: (item) => (
          <div className="w-28 space-y-1">
            <div className="flex justify-between text-[11px] font-semibold text-slate-700">
              <span>{item.certifiedProgressPct}%</span>
              {item.activeTrancheNumber && (
                <span className="text-brand-primary text-[10px]">
                  Tranche #{item.activeTrancheNumber}
                </span>
              )}
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                style={{ width: `${item.certifiedProgressPct}%` }}
                className="bg-brand-primary h-full rounded-full"
              />
            </div>
          </div>
        ),
      },
      {
        id: 'governance',
        header: 'Governance Status',
        tooltip:
          'Cross-facility assurance standing based on field corroboration and Hold-Point adherence',
        width: 'w-44',
        cell: (item) => {
          if (item.portfolioHealth === 'EVIDENCE_SUPPORTED') {
            return <TableBadge variant="success">Evidence Supported</TableBadge>;
          }
          if (item.portfolioHealth === 'EVIDENCE_PARTIAL') {
            return <TableBadge variant="warning">Under Observation</TableBadge>;
          }
          return <TableBadge variant="danger">Hold-Point Breached</TableBadge>;
        },
      },
      {
        id: 'riskExposure',
        header: 'Risk Exposure',
        tooltip:
          'Active physical-to-financial variance flags and bypassed Hold-Points',
        width: 'w-40',
        cell: (item) => (
          <div className="space-y-0.5">
            {item.openConflictCount > 0 ? (
              <div className="text-amber-800 font-semibold text-[11px]">
                {item.openConflictCount} Open Conflict
                {item.openConflictCount === 1 ? '' : 's'}
              </div>
            ) : (
              <div className="text-slate-400 text-[11px]">0 Open Conflicts</div>
            )}
            {item.unfulfilledHoldPointCount > 0 ? (
              <div className="text-rose-700 font-semibold text-[10px]">
                {item.unfulfilledHoldPointCount} Bypassed Hold-Point
                {item.unfulfilledHoldPointCount === 1 ? '' : 's'}
              </div>
            ) : (
              <div className="text-emerald-700 text-[10px] font-medium">
                Hold-Points Cleared
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        tooltip: 'Enter individual project assurance workspace',
        align: 'right',
        width: 'w-32',
        cell: (item) => (
          <div className="flex items-center justify-end">
            <TableActionButton
              onClick={() => onSelectProject(item.projectId)}
              variant="primary"
              icon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Workspace
            </TableActionButton>
          </div>
        ),
      },
    ],
    [onSelectProject]
  );

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* 1. Executive Portfolio Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-brand-primary border border-blue-200">
              Executive Cross-Facility Surveillance
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-semibold text-slate-500">
              Lender Credit Desk &amp; Independent Monitoring Committee
            </span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">
            Multi-Project Capital Risk &amp; Governance Matrix
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Consolidated physical-to-financial reconciliation across all infrastructure facilities
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Executive Summary
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-3.5 py-2 rounded-xl bg-brand-navy hover:bg-slate-800 text-white text-xs font-semibold transition shadow-xs"
          >
            Refresh Metrics
          </button>
        </div>
      </div>

      {/* 2. Top-Level Executive KPI Scorecards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Total Commitments */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-brand-primary flex items-center justify-center font-bold">
              <Landmark className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              Total Commitments
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {formatCompactNaira(summary.totalPortfolioCommitmentNgn)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Across {summary.activeProjectsCount} active facilities
            </div>
          </div>
        </div>

        {/* Card 2: Total Disbursed */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              Total Disbursed
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-emerald-700">
              {formatCompactNaira(summary.totalDisbursedToDateNgn)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center justify-between">
              <span>{disbursedPct}% drawn down</span>
              <span className="font-semibold text-slate-700">
                {formatNaira(summary.totalDisbursedToDateNgn)}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Protected Holdbacks */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              Protected Holdbacks
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-amber-800">
              {formatCompactNaira(summary.totalRecommendedHoldbackNgn)}
            </div>
            <div className="text-xs text-amber-700 font-medium mt-0.5">
              Shielded from uncorroborated claims
            </div>
          </div>
        </div>

        {/* Card 4: Governance Health Distribution */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              Portfolio Governance
            </span>
          </div>
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5 font-semibold">
              <span className="text-emerald-700">{summary.supportedCount} Supported</span>
              <span className="text-amber-700">{summary.partialCount} Observation</span>
              <span className="text-rose-700">{summary.conflictCount} Breached</span>
            </div>
            {/* Visual ratio bar */}
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
              <div
                style={{
                  width: `${(summary.supportedCount / summary.activeProjectsCount) * 100}%`,
                }}
                className="bg-emerald-500 h-full"
                title={`${summary.supportedCount} Evidence Supported`}
              />
              <div
                style={{
                  width: `${(summary.partialCount / summary.activeProjectsCount) * 100}%`,
                }}
                className="bg-amber-400 h-full"
                title={`${summary.partialCount} Under Observation`}
              />
              <div
                style={{
                  width: `${(summary.conflictCount / summary.activeProjectsCount) * 100}%`,
                }}
                className="bg-rose-500 h-full"
                title={`${summary.conflictCount} Contradicted / Breached`}
              />
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5">
              {summary.activeProjectsCount} total surveyed projects
            </div>
          </div>
        </div>
      </div>

      {/* 3. Contractor Assurance Alert Banner (If pending) */}
      {summary.pendingContractorVerificationsCount > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-900">
                {summary.pendingContractorVerificationsCount} Contractor Onboarding Application
                {summary.pendingContractorVerificationsCount === 1 ? '' : 's'} Pending Sign-Off
              </div>
              <p className="text-xs text-amber-700 mt-0.5">
                On-site civil engineers require biometric liveness and COREN verification before project capture access is granted.
              </p>
            </div>
          </div>

          <a
            href="/app/settings"
            className="px-3.5 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold shrink-0 transition self-start sm:self-auto shadow-2xs"
          >
            Review in Access Queue
          </a>
        </div>
      )}

      {/* 4. Comparative Facility Matrix Standard Table */}
      <StandardTable<PortfolioProjectHealthItem>
        title={
          <div className="flex items-center gap-2.5">
            <span>Capital Facility Risk &amp; Assurance Matrix</span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-blue-100 border border-white/15">
              {summary.projects.length} Facilities Monitored
            </span>
          </div>
        }
        subtitle="Consolidated physical-to-financial reconciliation across all infrastructure facilities"
        headerActions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-200/80">
              {summary.conflictCount === 0
                ? 'All Covenants Satisfied'
                : `${summary.conflictCount} Facilities Flagged`}
            </span>
          </div>
        }
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search facility name, code, contractor, or state...',
        }}
        filters={
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setHealthFilter('ALL')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === 'ALL'
                  ? 'bg-brand-navy text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              All ({summary.projects.length})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('EVIDENCE_SUPPORTED')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === 'EVIDENCE_SUPPORTED'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Supported ({summary.supportedCount})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('EVIDENCE_PARTIAL')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === 'EVIDENCE_PARTIAL'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Observation ({summary.partialCount})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('EVIDENCE_CONFLICT')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === 'EVIDENCE_CONFLICT'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Breached ({summary.conflictCount})
            </button>
          </div>
        }
        columns={portfolioColumns}
        data={filteredProjects}
        keyExtractor={(item) => item.projectId}
        onRowClick={(item) => onSelectProject(item.projectId)}
        emptyState={{
          title: 'No facilities match your search criteria',
          description:
            'Try adjusting your search keyword or health status filter.',
        }}
      />

      {/* 5. Executive Covenant & Disbursement Safeguards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-1.5">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            100% Hardware-Sealed Geofences
          </div>
          <p className="text-slate-500 leading-relaxed">
            All submitted field evidence logs are screened in real time against mathematical polygon boundaries and linear corridor coordinates. Mock locations and forged EXIF data are automatically blocked.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-1.5">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-brand-primary" />
            Pre-Pour Hold-Point Enforcements
          </div>
          <p className="text-slate-500 leading-relaxed">
            Concrete pours, stone base laying, and transformer plinth installations require Independent Monitor sign-off prior to milestone disbursement. Unverified works generate automatic valuation holdbacks.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-1.5">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-indigo-600" />
            Contractor Competence &amp; Identity Assurance
          </div>
          <p className="text-slate-500 leading-relaxed">
            On-site field engineers must undergo active 3D selfie liveness checks and upload validated COREN credentials before mobile capture permissions are granted by Independent Monitors.
          </p>
        </div>
      </div>
    </div>
  );
}
