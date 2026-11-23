import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
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
} from "lucide-react";
import { usePortfolioExecutiveQuery } from "../../queries/projects/useContractorVerificationQueries";
import { formatCompactNaira, formatNaira } from "../../lib/formatters";
import type { PortfolioProjectHealthItem } from "../../api/types";
import Loader from "../../components/Loader";
import { useAuth, useTerm } from "../../lib/auth-context";
import {
  DeliveryModelFilters,
  ProjectTypeChip,
} from "../../components/projects/DeliveryModelFilters";
import type { ProjectListFilters } from "@insite/shared";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableColumnDef,
} from "../../components/table";
import { KpiCard } from "../../components/common";
import { useProjectProcessMap } from "../../queries/process/useProcessQueries";
import { ScheduleBadge } from "../../components/schedule/ScheduleVarianceBadge";

interface PortfolioExecutivePageProps {
  onSelectProject: (projectId: string) => void;
}

export function PortfolioExecutivePage({
  onSelectProject,
}: PortfolioExecutivePageProps) {
  useAuth();
  const term = useTerm();
  // Phase 11: type / region / owner filters run on the server so the totals follow them.
  const [deliveryFilters, setDeliveryFilters] = useState<ProjectListFilters>(
    {},
  );
  const {
    data: summary,
    isLoading,
    refetch,
  } = usePortfolioExecutiveQuery(deliveryFilters);
  const [ownersSeen, setOwnersSeen] = useState<
    Array<{ id: string; name: string }>
  >([]);
  React.useEffect(() => {
    const found = (summary?.projects ?? [])
      .map((p) => p.owningOrganization)
      .filter((o): o is { id: string; name: string } => Boolean(o));
    if (found.some((o) => !ownersSeen.some((s) => s.id === o.id))) {
      setOwnersSeen((prev) => [
        ...prev,
        ...found.filter((o) => !prev.some((s) => s.id === o.id)),
      ]);
    }
  }, [summary, ownersSeen]);
  const [searchTerm, setSearchTerm] = useState("");
  // Phase 7: per-project process settings, to hide tranche and hold-point details a project turned off.
  // One cached request per listed project; until loaded (or if unreadable) the details are shown.
  const projectIds = useMemo(
    () => (summary?.projects ?? []).map((p) => p.projectId),
    [summary],
  );
  const processMap = useProjectProcessMap(projectIds, projectIds.length > 0);
  const [healthFilter, setHealthFilter] = useState<
    "ALL" | "EVIDENCE_SUPPORTED" | "EVIDENCE_PARTIAL" | "EVIDENCE_CONFLICT"
  >("ALL");

  const portfolioColumns: TableColumnDef<PortfolioProjectHealthItem>[] =
    useMemo(
      () => [
        {
          id: "project",
          header: "Project & Location",
          tooltip:
            "Project identifier prefix, state location, and official project name",
          width: "w-72",
          cell: (item) => (
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-brand-primary">
                  {item.codePrefix}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-600">
                  {item.region?.path ?? item.stateLocation}
                </span>
                {/* <ProjectTypeChip type={item.projectType} /> */}
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
          id: "counterparties",
          header: "Counterparties",
          tooltip: `Contractor and ${term("funderParty", { lower: true })}`,
          width: "w-52",
          cell: (item) => (
            <div className="space-y-0.5">
              <div
                className="font-medium text-slate-800 truncate"
                title={item.contractorName}
              >
                {item.contractorName || "No contractor"}
                {item.contractorCount > 1 && (
                  <span className="text-slate-500">
                    {" "}
                    +{item.contractorCount - 1}
                  </span>
                )}
              </div>
              <div
                className="text-[11px] text-slate-500 truncate"
                title={`${term("funderParty")}: ${item.lenderName}`}
              >
                {term("funderParty")}: {item.lenderName}
                {item.owningOrganization &&
                  item.owningOrganization.name !== item.lenderName && (
                    <span className="block">
                      Owner: {item.owningOrganization.name}
                    </span>
                  )}
              </div>
            </div>
          ),
        },
        {
          id: "commitmentDrawn",
          header: "Commitment & Drawn",
          tooltip:
            "Approved total project commitment and cumulative disbursements drawn",
          align: "right",
          width: "w-44",
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
          id: "schedule",
          header: "Schedule",
          tooltip:
            "Variance against the planned schedule on certified progress, in working weeks (updated daily)",
          width: "w-40",
          cell: (item) =>
            item.scheduleVariance ? (
              <ScheduleBadge badge={item.scheduleVariance} size="xs" />
            ) : (
              <span className="text-[11px] text-slate-400">No schedule</span>
            ),
        },
        {
          id: "progress",
          header: "Certified Progress",
          tooltip:
            "Independent Monitor certified physical completion percentage against active milestone tranche",
          width: "w-36",
          cell: (item) => (
            <div className="w-36 space-y-1">
              <div className="flex justify-between text-[11px] font-semibold text-slate-700">
                <span>{item.certifiedProgressPct}%</span>
                {item.activeTrancheNumber &&
                  (processMap.get(item.projectId)?.enableTranchesAndCps ??
                    true) && (
                    <span className="text-brand-primary text-[10px]">
                      {term("tranche")} #{item.activeTrancheNumber}
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
          id: "governance",
          header: "Governance Status",
          tooltip:
            "Cross-project assurance standing based on field corroboration and Hold-Point adherence",
          width: "w-44",
          cell: (item) => {
            if (item.portfolioHealth === "EVIDENCE_SUPPORTED") {
              return (
                <TableBadge variant="success">Evidence Supported</TableBadge>
              );
            }
            if (item.portfolioHealth === "EVIDENCE_PARTIAL") {
              return (
                <TableBadge variant="warning">Under Observation</TableBadge>
              );
            }
            return (
              <TableBadge variant="danger">
                {(processMap.get(item.projectId)?.enableHoldPoints ?? true)
                  ? "Hold-Point Breached"
                  : "Evidence Conflict"}
              </TableBadge>
            );
          },
        },
        {
          id: "riskExposure",
          header: "Risk Exposure",
          tooltip:
            "Active physical-to-financial variance flags and bypassed Hold-Points",
          width: "w-40",
          cell: (item) => (
            <div className="space-y-0.5">
              {item.openConflictCount > 0 ? (
                <div className="text-amber-800 font-semibold text-[11px]">
                  {item.openConflictCount} Open Conflict
                  {item.openConflictCount === 1 ? "" : "s"}
                </div>
              ) : (
                <div className="text-slate-400 text-[11px]">
                  0 Open Conflicts
                </div>
              )}
              {!(
                processMap.get(item.projectId)?.enableHoldPoints ?? true
              ) ? null : item.unfulfilledHoldPointCount > 0 ? (
                <div className="text-rose-700 font-semibold text-[10px]">
                  {item.unfulfilledHoldPointCount} Bypassed Hold-Point
                  {item.unfulfilledHoldPointCount === 1 ? "" : "s"}
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
          id: "actions",
          header: "Actions",
          tooltip: "Enter individual project assurance workspace",
          align: "right",
          width: "w-32",
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
      [onSelectProject, processMap, term],
    );

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

  const disbursedPct =
    summary.totalPortfolioCommitmentNgn > 0
      ? Math.round(
          (summary.totalDisbursedToDateNgn /
            summary.totalPortfolioCommitmentNgn) *
            100,
        )
      : 0;

  const filteredProjects = summary.projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.codePrefix.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.contractorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.stateLocation.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesHealth =
      healthFilter === "ALL" || p.portfolioHealth === healthFilter;

    return matchesSearch && matchesHealth;
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* 1. Executive Portfolio Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-primary/5 text-brand-primary border border-brand-primary/25">
              Executive Cross-Project Surveillance
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-semibold text-slate-500">
              {term("funderParty")} &amp; {term("monitorParty")} oversight
            </span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">
            Multi-Project Capital Risk &amp; Governance Matrix
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Consolidated physical-to-financial reconciliation across all
            infrastructure projects
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
        <KpiCard
          icon={<Landmark className="w-4 h-4" />}
          iconVariant="blue"
          title="Total Commitments"
          value={formatCompactNaira(summary.totalPortfolioCommitmentNgn)}
          subtitle={`Across ${summary.activeProjectsCount} active projects`}
        />

        {/* Card 2: Total Disbursed */}
        <KpiCard
          icon={<TrendingUp className="w-4 h-4" />}
          iconVariant="emerald"
          title="Total Disbursed"
          value={formatCompactNaira(summary.totalDisbursedToDateNgn)}
          valueColorClass="text-emerald-700"
          subtitle={
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{disbursedPct}% drawn down</span>
              <span className="font-semibold text-slate-700">
                {formatNaira(summary.totalDisbursedToDateNgn)}
              </span>
            </div>
          }
        />

        {/* Card 3: Protected Holdbacks */}
        <KpiCard
          icon={<ShieldAlert className="w-4 h-4" />}
          iconVariant="amber"
          title="Protected Holdbacks"
          value={formatCompactNaira(summary.totalRecommendedHoldbackNgn)}
          valueColorClass="text-amber-800"
          subtitle={
            <span className="text-amber-700 font-medium">
              Shielded from uncorroborated claims
            </span>
          }
        />

        {/* Card 4: Governance Health Distribution */}
        <KpiCard
          icon={<Layers className="w-4 h-4" />}
          iconVariant="indigo"
          title="Portfolio Governance"
          value={
            <div className="flex items-center justify-between gap-2 text-xs font-semibold">
              <span className="text-emerald-700">
                {summary.supportedCount} Supported
              </span>
              <span className="text-amber-700">
                {summary.partialCount} Observation
              </span>
              <span className="text-rose-700">
                {summary.conflictCount} Breached
              </span>
            </div>
          }
        >
          {/* Visual ratio bar */}
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
            <div
              style={{
                width: `${
                  summary.activeProjectsCount > 0
                    ? (summary.supportedCount / summary.activeProjectsCount) *
                      100
                    : 0
                }%`,
              }}
              className="bg-emerald-500 h-full"
              title={`${summary.supportedCount} Evidence Supported`}
            />
            <div
              style={{
                width: `${
                  summary.activeProjectsCount > 0
                    ? (summary.partialCount / summary.activeProjectsCount) * 100
                    : 0
                }%`,
              }}
              className="bg-amber-400 h-full"
              title={`${summary.partialCount} Under Observation`}
            />
            <div
              style={{
                width: `${
                  summary.activeProjectsCount > 0
                    ? (summary.conflictCount / summary.activeProjectsCount) *
                      100
                    : 0
                }%`,
              }}
              className="bg-rose-500 h-full"
              title={`${summary.conflictCount} Disputed / Breached`}
            />
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5 flex justify-between">
            <span>Hold-Point Alignment</span>
            <span className="font-semibold text-slate-700">
              {summary.activeProjectsCount > 0
                ? Math.round(
                    (summary.supportedCount / summary.activeProjectsCount) *
                      100,
                  )
                : 0}
              % Clean
            </span>
          </div>
        </KpiCard>
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
                {summary.pendingContractorVerificationsCount} Contractor
                Onboarding Application
                {summary.pendingContractorVerificationsCount === 1
                  ? ""
                  : "s"}{" "}
                Pending Sign-Off
              </div>
              <p className="text-xs text-amber-700 mt-0.5">
                Contractor engineers submit a photo ID, a guided selfie set and
                COREN credentials; their reports are held until a reviewer
                approves them.
              </p>
            </div>
          </div>

          <Link
            to="/app/settings"
            className="px-3.5 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold shrink-0 transition self-start sm:self-auto shadow-2xs"
          >
            Review in Access Queue
          </Link>
        </div>
      )}

      <DeliveryModelFilters
        filters={deliveryFilters}
        onChange={setDeliveryFilters}
        owners={ownersSeen}
      />

      {/* 4. Comparative Project Matrix Standard Table */}
      <StandardTable<PortfolioProjectHealthItem>
        title={
          <div className="flex items-center gap-2.5">
            <span>Capital Project Risk &amp; Assurance Matrix</span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-white/90 border border-white/15">
              {summary.projects.length} Projects Monitored
            </span>
          </div>
        }
        subtitle="Consolidated physical-to-financial reconciliation across all infrastructure projects"
        headerActions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/70">
              {summary.conflictCount === 0
                ? "All Covenants Satisfied"
                : `${summary.conflictCount} Projects Flagged`}
            </span>
          </div>
        }
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Search project name, code, contractor, or state...",
        }}
        filters={
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setHealthFilter("ALL")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === "ALL"
                  ? "bg-brand-navy text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              All ({summary.projects.length})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter("EVIDENCE_SUPPORTED")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === "EVIDENCE_SUPPORTED"
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              Supported ({summary.supportedCount})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter("EVIDENCE_PARTIAL")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === "EVIDENCE_PARTIAL"
                  ? "bg-amber-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              Observation ({summary.partialCount})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter("EVIDENCE_CONFLICT")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                healthFilter === "EVIDENCE_CONFLICT"
                  ? "bg-rose-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
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
          title: "No projects match your search criteria",
          description:
            "Try adjusting your search keyword or health status filter.",
        }}
      />

      {/* Phase 10: projects in their defects liability period, with retention held */}
      <RetentionOverview projects={summary.projects} />

      {/* 5. Executive Covenant & Disbursement Safeguards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-1.5">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Server-checked geofences
          </div>
          <p className="text-slate-500 leading-relaxed">
            The server checks every capture and daily report against the project
            boundary or corridor. Reports must carry a GPS location; mock
            locations and recycled photos are flagged and not counted as
            evidence.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-1.5">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-brand-primary" />
            Pre-Pour Hold-Point Enforcements
          </div>
          <p className="text-slate-500 leading-relaxed">
            Concrete pours, stone base laying, and transformer plinth
            installations require Independent Monitor sign-off prior to
            milestone disbursement. Unverified works generate automatic
            valuation holdbacks.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-1.5">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-brand-primary" />
            Contractor Competence &amp; Identity Assurance
          </div>
          <p className="text-slate-500 leading-relaxed">
            Contractor field engineers submit a photo ID, a guided selfie set (3
            poses) and COREN credentials. Their reports are held by the server
            until an Independent Monitor reviews and approves them.
          </p>
        </div>
      </div>
    </div>
  );
}

const RETENTION_PHASE_LABEL: Record<string, string> = {
  ACTIVE_CONSTRUCTION: "Construction",
  HANDOVER_IN_PROGRESS: "Handover",
  RETENTION_PERIOD: "Defects liability",
  COMPLETED_CLOSED: "Closed",
};

/** Phase 10: projects in handover or their liability period, with retention held and days remaining. */
function RetentionOverview({
  projects,
}: {
  projects: PortfolioProjectHealthItem[];
}) {
  const rows = projects.filter(
    (p) =>
      p.retention &&
      (p.retention.phase === "HANDOVER_IN_PROGRESS" ||
        p.retention.phase === "RETENTION_PERIOD" ||
        p.retention.heldNgn > 0),
  );
  if (rows.length === 0) return null;
  const totalHeld = rows.reduce((s, p) => s + (p.retention?.heldNgn ?? 0), 0);
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-900">
          Projects in retention
        </h2>
        <span className="text-xs text-slate-500">
          Retention held across these projects: {formatNaira(totalHeld)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Project</th>
              <th className="px-4 py-2">Phase</th>
              <th className="px-4 py-2 text-right">Held</th>
              <th className="px-4 py-2 text-right">Released</th>
              <th className="px-4 py-2">Liability period ends</th>
              <th className="px-4 py-2 text-right">Open defects</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const r = p.retention!;
              return (
                <tr key={p.projectId}>
                  <td className="px-4 py-2">
                    <Link
                      to={`/app/projects/${p.projectId}/retention`}
                      className="font-semibold text-brand-primary hover:underline"
                    >
                      {p.codePrefix}
                    </Link>{" "}
                    <span className="text-slate-500">{p.name}</span>
                  </td>
                  <td className="px-4 py-2">
                    {RETENTION_PHASE_LABEL[r.phase]}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">
                    {formatNaira(r.heldNgn)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatNaira(r.releasedNgn)}
                  </td>
                  <td className="px-4 py-2">
                    {r.retentionEndDate
                      ? `${r.retentionEndDate}${r.daysRemaining !== null ? (r.daysRemaining >= 0 ? ` (${r.daysRemaining} days)` : " (ended)") : ""}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">{r.openDefectCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
