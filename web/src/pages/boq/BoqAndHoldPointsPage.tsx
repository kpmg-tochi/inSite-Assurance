import React, { useRef, useState, MouseEvent } from "react";
import { ClipboardList, ShieldCheck, AlertTriangle, X } from "lucide-react";
import type { BoqItemRecordDto, ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira, formatNaira } from "../../lib/formatters";
import { formatIndependenceTierText } from "../../components/EvidenceBadge";
import { useAuth } from "../../lib/auth-context";
import {
  useUpdateBoqMappingsMutation,
  useUploadBoqMutation,
} from "../../mutations/boq/useBoqMutations";
import Drawer from "../../components/Drawer";

interface BoqAndHoldPointsPageProps {
  project: ProjectSummaryDto;
  boqItems: BoqItemRecordDto[];
}

export function BoqAndHoldPointsPage({
  project,
  boqItems,
}: BoqAndHoldPointsPageProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [selectedBoqItem, setSelectedBoqItem] =
    useState<BoqItemRecordDto | null>(null);

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
    if (user?.role !== "MONITOR") return;
    try {
      await updateMappingsMutation.mutateAsync({
        updates: [
          {
            boqItemId: item.id,
            trancheId:
              item.trancheId ||
              item.aiSuggestedTrancheId ||
              project.tranches[0]?.id ||
              null,
            isHoldPoint: !item.isHoldPoint,
            holdPointInstruction: !item.isHoldPoint
              ? "Requires Tier 1 Independent Monitor geotagged verification prior to concrete pour / cover-up."
              : null,
          },
        ],
      });
      setStatusMessage(
        `Updated Hold-Point requirement for WBS ${item.wbsCode}.`,
      );
    } catch (err: any) {
      setStatusMessage(err?.message || "Failed to update BOQ mapping.");
    }
  };

  const handleConfirmAllTrancheMappings = async () => {
    if (user?.role !== "MONITOR" || boqItems.length === 0) return;
    try {
      const fallbackTrancheId = project.tranches[0]?.id || null;
      await updateMappingsMutation.mutateAsync({
        updates: boqItems.map((item) => ({
          boqItemId: item.id,
          trancheId:
            item.trancheId || item.aiSuggestedTrancheId || fallbackTrancheId,
          isHoldPoint: item.isHoldPoint,
          holdPointInstruction: item.holdPointInstruction || null,
        })),
      });
      setStatusMessage(
        "All AI-suggested Tranche & Hold-Point mappings confirmed by Independent Monitor.",
      );
    } catch (err: any) {
      setStatusMessage(err?.message || "Failed to confirm mappings.");
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
        setStatusMessage(
          `Ingested ${res.totalUploaded} BOQ items (${res.holdPointCount} Hold-Points, ${res.opaqueLumpSumCount} Opaque Lump Sums screened).`,
        );
      } catch (err: any) {
        setStatusMessage(err?.message || "Spreadsheet upload failed.");
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

  // Filter visible join codes based on role segregation:
  // - MONITOR sees all 3 codes (-INS, -COW, -CON) to distribute to field personnel
  // - CONTRACTOR only sees their own -CON code
  // - LENDER does not need mobile capture codes
  const visibleJoinCodes =
    user?.role === "MONITOR"
      ? project.joinCodes
      : user?.role === "CONTRACTOR"
        ? project.joinCodes.filter(
            (jc) => jc.independenceTier === "CONTRACTOR_ENGINEER",
          )
        : [];

  return (
    <div className="space-y-3">
      {statusMessage && (
        <div className="bg-blue-50 border border-blue-200 text-brand-primary rounded-xl px-4 py-2.5 text-xs font-medium flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-xs font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. Top Bar: Baseline Governance Summary & Monitor Actions */}
      <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Baseline Engineering Schedule
          </div>
          <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
            {user?.role === "CONTRACTOR"
              ? "Approved Bill of Quantities & Pre-Pour Hold-Point Checklist"
              : "Bill of Quantities (BOQ), Tranche Mappings & Hold-Point Rules"}
          </div>
        </div>

        {user?.role === "MONITOR" && (
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
            <button
              type="button"
              disabled={isUpdating}
              onClick={handleConfirmAllTrancheMappings}
              className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
            >
              Confirm All Tranche Mappings
            </button>
          </div>
        )}
      </div>

      {/* 2. Three BOQ & Hold-Point KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-brand-primary flex items-center justify-center">
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

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
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
        </div>

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
                {user?.role === "CONTRACTOR"
                  ? "Contractor Site Engineer — Mobile Field App Join Code"
                  : "Mobile Field App — Role-Segregated Join Codes"}
              </h2>
              <p className="text-[11px] text-slate-500">
                {user?.role === "CONTRACTOR"
                  ? "Share this code with your Site Engineers to submit Tier 3 self-reported progress photos and voice logs"
                  : "Zero-friction onboarding for field engineers and clerks of works; binds each mobile capture to its cryptographic Independence Tier"}
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
                    {formatIndependenceTierText(jc.independenceTier)}
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

      {/* 4. Clean Baseline BOQ Schedule Table (Minimal Work Item Cell + Details Drawer Trigger) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-brand-navy text-white flex items-center justify-between">
          <h2 className="text-sm font-bold">
            Baseline Bill of Quantities (BOQ) Schedule
          </h2>
          <span className="text-xs text-blue-200/80">
            {project.codePrefix} — {boqItems.length} Scheduled Work Item
            {boqItems.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                <th
                  className="py-3 px-4 w-28"
                  title="Work Breakdown Structure (WBS) reference code"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    WBS ID
                  </span>
                </th>
                <th
                  className="py-3 px-4 w-80"
                  title="Engineering work item description (click any row to view full bill section and Hold-Point instructions)"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Work Item
                  </span>
                </th>
                <th
                  className="py-3 px-4 text-right whitespace-nowrap"
                  title="Total measured quantity and unit of measurement (BESMM4)"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Quantity &amp; Unit
                  </span>
                </th>
                <th
                  className="py-3 px-4 text-right whitespace-nowrap"
                  title="Contract unit rate in Nigerian Naira"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Rate (₦)
                  </span>
                </th>
                <th
                  className="py-3 px-4 text-right whitespace-nowrap"
                  title="Total budgeted cost (Quantity × Unit Rate) in Nigerian Naira"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Budgeted Cost (₦)
                  </span>
                </th>
                <th
                  className="py-3 px-4 whitespace-nowrap"
                  title="Facility disbursement tranche fed by this BOQ work item"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Mapped Tranche
                  </span>
                </th>
                <th
                  className="py-3 px-4 whitespace-nowrap"
                  title="Mandatory Visual Hold-Point status and QSRBN unitemized lump-sum warnings"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Governance
                  </span>
                </th>
                <th
                  className="py-3 px-4 text-right whitespace-nowrap w-24"
                  title="Open full engineering specification, bill section, and Hold-Point rules"
                >
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 text-xs">
              {boqItems.map((item) => {
                const isSelected = activeDrawerItem?.id === item.id;
                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedBoqItem(item)}
                    className={`cursor-pointer transition ${
                      isSelected
                        ? "bg-blue-50/50 border-l-4 border-l-brand-primary"
                        : "hover:bg-slate-50/80"
                    }`}
                  >
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <span className="font-bold text-slate-900">
                        {item.wbsCode}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 align-middle max-w-xs">
                      <div className="font-medium text-slate-800 truncate">
                        {item.description}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 align-middle text-right text-slate-700 whitespace-nowrap">
                      {item.totalQuantity.toLocaleString()} {item.unit}
                    </td>

                    <td className="py-3.5 px-4 align-middle text-right text-slate-600 whitespace-nowrap">
                      {formatCompactNaira(item.rateNgn)}
                    </td>

                    <td className="py-3.5 px-4 align-middle text-right font-bold text-slate-900 whitespace-nowrap">
                      {formatNaira(item.budgetedCostNgn)}
                    </td>

                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <span className="font-medium text-slate-800">
                        {item.tranche
                          ? `Tranche #${item.tranche.trancheNumber}`
                          : "Tranche #1"}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {item.isHoldPoint ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-brand-primary border border-blue-200">
                            Mandatory Hold-Point
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            Standard Item
                          </span>
                        )}

                        {item.isOpaqueLumpSum && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                            Opaque Lump Sum
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBoqItem(item);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-brand-primary transition shadow-2xs"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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
                {activeDrawerItem.isHoldPoint && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-brand-primary border border-blue-200">
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
                <div className="text-[11px] text-slate-400">Unit Rate (₦)</div>
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
                  Cumulative Certified
                </div>
                <div className="text-sm font-bold text-emerald-700 mt-0.5">
                  {activeDrawerItem.cumulativeCertifiedPct}%
                </div>
              </div>
            </div>

            {/* Tranche Mapping Card */}
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Mapped Facility Tranche
                </span>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {activeDrawerItem.trancheMappingConfirmedByMonitor
                    ? "Monitor Confirmed"
                    : "AI Suggested"}
                </span>
              </div>
              <div className="font-semibold text-slate-900">
                {activeDrawerItem.tranche
                  ? `Tranche #${activeDrawerItem.tranche.trancheNumber} — ${activeDrawerItem.tranche.name}`
                  : "Tranche #1 — Initial Facility Drawdown"}
              </div>
            </div>

            {/* Mandatory Hold-Point Rule Card */}
            <div
              className={`rounded-xl p-3.5 border space-y-1.5 ${
                activeDrawerItem.isHoldPoint
                  ? "bg-blue-50/60 border-blue-200"
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
            </div>

            {/* QSRBN Hygiene / Opacity Screening Card */}
            {activeDrawerItem.isOpaqueLumpSum && (
              <div className="rounded-xl p-3.5 bg-amber-50 border border-amber-200 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  QSRBN BOQ Hygiene Alert — Opaque Lump Sum
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
            {user?.role === "MONITOR" && (
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
