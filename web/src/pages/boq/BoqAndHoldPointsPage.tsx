import React, { useRef, useState, useMemo, MouseEvent } from "react";
import { ClipboardList, ShieldCheck, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import type { BoqItemRecordDto, ProjectSummaryDto } from "../../api/types";
import { displayCurrencySymbol, formatCompactNaira, formatNaira } from "../../lib/formatters";
import { formatReporterRoleBadge } from "../../components/reporterRole";
import { useAuth } from "../../lib/auth-context";
import {
  useUpdateBoqMappingsMutation,
  useUploadBoqMutation,
} from "../../mutations/boq/useBoqMutations";
import Drawer from "../../components/Drawer";
import { BriefPreview } from "../../components/process/BriefPreview";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableActionMenu,
  TableColumnDef,
} from "../../components/table";

interface BoqAndHoldPointsPageProps {
  project: ProjectSummaryDto;
  boqItems: BoqItemRecordDto[];
}

export function BoqAndHoldPointsPage({
  project,
  boqItems,
}: BoqAndHoldPointsPageProps) {
  const { hasPermission } = useAuth();
  const canUploadBoq = hasPermission("boq:upload_edit");
  const canConfigureHoldPoints = hasPermission("boq:configure_hold_points");
  const canViewAllJoinCodes =
    hasPermission("mobilization:manage_roster") ||
    hasPermission("projects:edit_baseline");
  // Contractors read the BOQ; they cannot edit it or its hold points.
  const isContractorView = !hasPermission("boq:upload_edit") && !hasPermission("boq:configure_hold_points");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [selectedBoqItem, setSelectedBoqItem] =
    useState<BoqItemRecordDto | null>(null);

  // Phase 7: modules the project's process turned off are hidden.
  const processQuery = useProjectProcess(project.id);
  const holdPointsOn = processQuery.data?.config.enableHoldPoints ?? true;
  const contractorReportingOn = processQuery.data?.config.allowContractorFieldReporting ?? true;

  const updateMappingsMutation = useUpdateBoqMappingsMutation(project.id);
  const uploadBoqMutation = useUploadBoqMutation(project.id);

  const isUpdating =
    updateMappingsMutation.isPending || uploadBoqMutation.isPending;

  const activeDrawerItem = selectedBoqItem
    ? boqItems.find((b) => b.id === selectedBoqItem.id) || selectedBoqItem
    : null;

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleToggleHoldPoint = async (item: BoqItemRecordDto) => {
    if (!canConfigureHoldPoints) return;
    try {
      await updateMappingsMutation.mutateAsync({
        updates: [
          {
            boqItemId: item.id,
            isHoldPoint: !item.isHoldPoint,
            holdPointInstruction: !item.isHoldPoint
              ? "Requires Independent Monitor geotagged verification prior to concrete pour / cover-up."
              : null,
          },
        ],
      });
      toast.success(`Updated Hold-Point requirement for WBS ${item.wbsCode}.`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update BOQ mapping.");
    }
  };


  const handleSpreadsheetUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = String(reader.result).split(",")[1] || "";
        const res = await uploadBoqMutation.mutateAsync({
          spreadsheetBase64: base64,
        });
        toast.success(
          `Ingested ${res.totalUploaded} BOQ items (${res.holdPointCount} Hold-Points, ${res.opaqueLumpSumCount} Opaque Lump Sums screened).`,
        );
      } catch (err: any) {
        toast.error(err?.message || "Spreadsheet upload failed.");
      }
    };
    reader.readAsDataURL(file);
  };

  const holdPointCount = boqItems.filter((b) => b.isHoldPoint).length;
  const opaqueCount = boqItems.filter((b) => b.isOpaqueLumpSum).length;
  const totalBoqBudget = boqItems.reduce(
    (sum, b) => sum + b.budgetedCostNgn,
    0,
  );

  // Filter visible join codes based on permissions & persona:
  const visibleJoinCodes = canViewAllJoinCodes
    ? project.joinCodes
    : isContractorView
      ? project.joinCodes.filter(
          (jc) => jc.fieldPersonaType === "CONTRACTOR_EXECUTOR",
        )
      : [];

  const [searchTerm, setSearchTerm] = useState("");
  const [boqFilter, setBoqFilter] = useState<
    "ALL" | "HOLD_POINTS" | "OPAQUE"
  >("ALL");

  const filteredBoqItems = useMemo(() => {
    return boqItems.filter((item) => {
      const matchesSearch =
        item.wbsCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.section.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesFilter =
        boqFilter === "ALL" ||
        (boqFilter === "HOLD_POINTS" && item.isHoldPoint) ||
        (boqFilter === "OPAQUE" && item.isOpaqueLumpSum);

      return matchesSearch && matchesFilter;
    });
  }, [boqItems, searchTerm, boqFilter]);

  const boqColumns: TableColumnDef<BoqItemRecordDto>[] = [
    {
      id: "wbsCode",
      header: "WBS ID",
      tooltip:
        "Work Breakdown Structure (WBS) reference code from baseline Bill of Quantities",
      width: "w-28",
      cell: (item) => (
        <span className="font-bold text-slate-900 text-xs">
          {item.wbsCode}
        </span>
      ),
    },
    {
      id: "description",
      header: "Work Item",
      tooltip:
        "Engineering work item description (click row to inspect bill section and rates in drawer)",
      width: "w-80",
      cell: (item) => (
        <div className="max-w-xs">
          <div className="font-medium text-slate-800 truncate">
            {item.description}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {item.section}
          </div>
        </div>
      ),
    },
    {
      id: "quantityUnit",
      header: "Quantity & Unit",
      tooltip: "Total measured quantity and unit of measurement (BESMM4)",
      align: "right",
      cell: (item) => (
        <span className="text-slate-700 font-medium">
          {item.totalQuantity.toLocaleString()} {item.unit}
        </span>
      ),
    },
    {
      id: "rate",
      header: `Rate (${displayCurrencySymbol()})`,
      tooltip: "Contract unit rate in Nigerian Naira",
      align: "right",
      cell: (item) => (
        <span className="text-slate-600">
          {formatCompactNaira(item.rateNgn)}
        </span>
      ),
    },
    {
      id: "budget",
      header: `Budgeted Cost (${displayCurrencySymbol()})`,
      tooltip: "Total budgeted cost (Quantity × Unit Rate) in Nigerian Naira",
      align: "right",
      cell: (item) => (
        <span className="font-bold text-slate-900">
          {formatNaira(item.budgetedCostNgn)}
        </span>
      ),
    },
    {
      id: "governance",
      header: "Governance",
      tooltip:
        "Mandatory visual Hold-Point status and QSRBN unitemized lump-sum warnings",
      cell: (item) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          {holdPointsOn && item.isHoldPoint && (
            <TableBadge variant="warning">Mandatory Hold-Point</TableBadge>
          )}
          {item.isOpaqueLumpSum && (
            <TableBadge variant="danger">Opaque Lump Sum</TableBadge>
          )}
          {!(holdPointsOn && item.isHoldPoint) && !item.isOpaqueLumpSum && (
            <TableBadge variant="neutral">Standard Item</TableBadge>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: "Details",
      tooltip:
        "Open full engineering specification, bill section, and Hold-Point rules",
      align: "right",
      width: "w-28",
      cell: (item) => (
        <div className="flex items-center justify-end gap-1.5">
          <TableActionButton
            onClick={() => setSelectedBoqItem(item)}
            variant="default"
          >
            View
          </TableActionButton>
          <TableActionMenu
            actions={[
              {
                label: "View Specifications Drawer",
                onClick: () => setSelectedBoqItem(item),
              },
              ...(canConfigureHoldPoints && holdPointsOn
                ? [
                    {
                      label: item.isHoldPoint
                        ? "Remove Hold-Point"
                        : "Set as Mandatory Hold-Point",
                      onClick: () => handleToggleHoldPoint(item),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* 1. Top Bar: Baseline Governance Summary & Actions */}
      <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Baseline Engineering Schedule
          </div>
          <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
            {isContractorView
              ? "Approved Bill of Quantities & Pre-Pour Hold-Point Checklist"
              : holdPointsOn
                ? "Bill of Quantities (BOQ) & Hold-Point Rules"
                : "Bill of Quantities (BOQ)"}
          </div>
        </div>

        {canUploadBoq && (
          <div className="flex items-center gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleSpreadsheetUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition disabled:opacity-50"
            >
              Import BOQ (.xlsx / .csv)
            </button>
            
          </div>
        )}
      </div>

      {/* 2. Three BOQ & Hold-Point KPI Cards */}
      <div className={`grid grid-cols-1 gap-3 ${holdPointsOn ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-brand-primary/5 text-brand-primary flex items-center justify-center">
              <ClipboardList className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              Baseline Work Items
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {boqItems.length} Item{boqItems.length === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Total Scheduled Value: {formatCompactNaira(totalBoqBudget)}
            </div>
          </div>
        </div>

        {holdPointsOn && <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              Mandatory Visual Hold-Points
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {holdPointCount} Hold-Point{holdPointCount === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Requires Tier 1 pre-pour verification before cover-up
            </div>
          </div>
        </div>}

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              QSRBN Hygiene Screening
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {opaqueCount} Opaque Lump Sum{opaqueCount === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {opaqueCount === 0
                ? "All work items have measurable BESMM4 quantities"
                : "Unitemized provisional/lump-sum items flagged for breakdown"}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Role-Segregated Mobile Field Reporter Join Codes (Shown to Monitor & Contractor) */}
      {visibleJoinCodes.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-xs font-bold text-slate-900">
                {isContractorView
                  ? "Contractor Site Engineer: Mobile Field App Join Code"
                  : "Mobile Field App: Role-Segregated Join Codes"}
              </h2>
              <p className="text-[11px] text-slate-500">
                {isContractorView
                  ? "Share this code with your Site Engineers to submit self-reported progress photos and voice logs"
                  : "Zero-friction onboarding for field engineers and clerks of works; binds each mobile capture to its configured role & assurance weight"}
              </p>
            </div>
          </div>

          <div
            className={`grid grid-cols-1 ${
              visibleJoinCodes.length > 1 ? "md:grid-cols-3" : "max-w-md"
            } gap-3`}
          >
            {visibleJoinCodes.map((jc) => (
              <div
                key={jc.id}
                className="rounded-xl border border-slate-200/90 bg-slate-50 p-3 flex items-center justify-between"
              >
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {formatReporterRoleBadge(jc.roleName, jc.fieldPersonaType)}
                  </div>
                  <div className="text-sm font-bold text-brand-primary mt-0.5">
                    {jc.code}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyCode(jc.code)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                >
                  {copiedCode === jc.code ? "Copied" : "Copy Code"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Standard Baseline BOQ Schedule Table (Minimal Work Item Cell + Details Drawer Trigger) */}
      <StandardTable<BoqItemRecordDto>
        title={
          <div className="flex items-center gap-2.5">
            <span>{holdPointsOn ? <>Baseline Bill of Quantities (BOQ) &amp; Hold-Point Schedule</> : "Baseline Bill of Quantities (BOQ)"}</span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-white/90 border border-white/15">
              {boqItems.length} Items{holdPointsOn ? ` · ${holdPointCount} Hold-Points` : ""} · {opaqueCount} Opaque Lump Sums
            </span>
          </div>
        }
        subtitle={
          project ? `${project.codePrefix}: ${project.name}` : undefined
        }
        headerActions={
          canUploadBoq ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition disabled:opacity-50"
              >
                Import BOQ (.xlsx / .csv)
              </button>
              
            </div>
          ) : undefined
        }
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Search by WBS ID, work item, or bill section...",
        }}
        filters={
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setBoqFilter("ALL")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                boqFilter === "ALL"
                  ? "bg-brand-navy text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              All ({boqItems.length})
            </button>
            {holdPointsOn && <button
              type="button"
              onClick={() => setBoqFilter("HOLD_POINTS")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                boqFilter === "HOLD_POINTS"
                  ? "bg-amber-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              Hold-Points ({holdPointCount})
            </button>}
            <button
              type="button"
              onClick={() => setBoqFilter("OPAQUE")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                boqFilter === "OPAQUE"
                  ? "bg-rose-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              Opaque Lump Sums ({opaqueCount})
            </button>
            
          </div>
        }
        columns={boqColumns}
        data={filteredBoqItems}
        keyExtractor={(item) => item.id}
        selectedId={activeDrawerItem?.id}
        onRowClick={(item) => setSelectedBoqItem(item)}
        emptyState={{
          title: "No BOQ items match your query",
          description:
            "Try adjusting the search query or active filter to view scheduled work items.",
        }}
      />

      {/* 5. Slide-Over BOQ Item & Hold-Point Inspector Drawer */}
      {activeDrawerItem && (
        <Drawer
          onClick={(e: MouseEvent<HTMLDivElement>) => {
            if (e.target === e.currentTarget) setSelectedBoqItem(null);
          }}
        >
          {/* Drawer Header */}
          <div className="p-4 border-b border-slate-100 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
                  BOQ Work Item Specification
                </span>
                {holdPointsOn && activeDrawerItem.isHoldPoint && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-brand-primary/5 text-brand-primary border border-brand-primary/25">
                    Mandatory Hold-Point
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-1">
                WBS {activeDrawerItem.wbsCode}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeDrawerItem.section}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedBoqItem(null)}
              title="Close drawer"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
            {/* Full Engineering Description */}
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Full Work Item Description
              </div>
              <p className="text-slate-900 font-medium leading-relaxed">
                {activeDrawerItem.description}
              </p>
            </div>

            {/* Quantity, Rate & Budget Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="text-[11px] text-slate-400">
                  Scheduled Quantity
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  {activeDrawerItem.totalQuantity.toLocaleString()}{" "}
                  {activeDrawerItem.unit}
                </div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="text-[11px] text-slate-400">Unit Rate ({displayCurrencySymbol()})</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  {formatNaira(activeDrawerItem.rateNgn)}
                </div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="text-[11px] text-slate-400">
                  Total Budgeted Cost
                </div>
                <div className="text-sm font-bold text-brand-primary mt-0.5">
                  {formatNaira(activeDrawerItem.budgetedCostNgn)}
                </div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="text-[11px] text-slate-400">
                  Progress
                </div>
                <div className="text-sm font-bold text-emerald-700 mt-0.5">
                  {activeDrawerItem.cumulativeCertifiedPct}%
                </div>
              </div>
            </div>


            {/* Mandatory Hold-Point Rule Card */}
            {holdPointsOn && <div
              className={`rounded-xl p-3.5 border space-y-1.5 ${
                activeDrawerItem.isHoldPoint
                  ? "bg-brand-primary/5 border-brand-primary/25"
                  : "bg-slate-50 border-slate-200/80"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
                {activeDrawerItem.isHoldPoint
                  ? "Mandatory Visual Hold-Point Rule"
                  : "Standard Inspection Protocol"}
              </div>
              <p className="text-slate-700 leading-relaxed">
                {activeDrawerItem.holdPointInstruction ||
                  "Standard geotagged progress photo and voice note verification applies."}
              </p>
            </div>}

            {/* Phase 7: today's brief for each persona, with the standards applied */}
            <BriefPreview
              key={activeDrawerItem.id}
              projectId={project.id}
              boqItemId={activeDrawerItem.id}
              contractorReportingOn={contractorReportingOn}
            />

            {/* QSRBN Hygiene / Opacity Screening Card */}
            {activeDrawerItem.isOpaqueLumpSum && (
              <div className="rounded-xl p-3.5 bg-amber-50 border border-amber-200 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  QSRBN BOQ Hygiene Alert: Opaque Lump Sum
                </div>
                <p className="text-amber-800 leading-relaxed">
                  {activeDrawerItem.opacityWarningReason ||
                    "Unitemized lump-sum entry detected. Recommend requesting a detailed BESMM4 schedule breakdown prior to drawdown release."}
                </p>
              </div>
            )}
          </div>

          {/* Drawer Footer Actions */}
          <div className="p-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between gap-2">
            {canConfigureHoldPoints && holdPointsOn && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleToggleHoldPoint(activeDrawerItem)}
                className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
              >
                {activeDrawerItem.isHoldPoint
                  ? "Remove Hold-Point Flag"
                  : "Set as Mandatory Hold-Point"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedBoqItem(null)}
              className="flex-1 py-2 px-3 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold transition shadow-sm"
            >
              Done
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
