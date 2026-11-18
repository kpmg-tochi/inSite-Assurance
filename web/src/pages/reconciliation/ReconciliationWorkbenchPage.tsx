import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Wallet,
  CheckCircle2,
  ShieldAlert,
  X,
  ChevronDown,
  Printer,
  Calendar,
  MapPin,
  UserCheck,
  FileText,
  Check,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import type { LenderDecisionType, MonitorRecommendation } from "@insite/shared";
import type {
  BoqItemRecordDto,
  FieldEvidenceLogRecordDto,
  IpcDetailsDto,
  IpcLineItemRecordDto,
  ProjectSummaryDto,
} from "../../api/types";
import {
  formatCompactNaira,
  formatDateShort,
  formatLicenseCredential,
  formatNaira,
} from "../../lib/formatters";
import {
  EvidenceRatingBadge,
} from "../../components/EvidenceBadge";
import { EvidenceOverlayDrawer } from "../../components/EvidenceOverlayDrawer";
import { useAuth } from "../../lib/auth-context";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableActionMenu,
  TableColumnDef,
} from "../../components/table";
import {
  CustomSelect,
  type CustomSelectOption,
  KpiCard,
} from "../../components/common";
import {
  useCertifyValuationMutation,
  useCreateMonitorQueryMutation,
  useDecideTrancheMutation,
  useReconcileIpcMutation,
  useRespondMonitorQueryMutation,
  useSubmitIpcMutation,
} from "../../mutations/reconciliation/useReconciliationMutations";

interface ReconciliationWorkbenchPageProps {
  project: ProjectSummaryDto;
  ipcs: IpcDetailsDto[];
  selectedIpc: IpcDetailsDto | null;
  onSelectIpc: (ipcId: string) => void;
  boqItems: BoqItemRecordDto[];
  evidenceLogs: FieldEvidenceLogRecordDto[];
}

const MONITOR_RECOMMENDATION_OPTIONS: CustomSelectOption<MonitorRecommendation>[] = [
  {
    value: "SUPPORT_WITH_HOLDBACK",
    label: "SUPPORT WITH HOLDBACK (Release Verified Works Only)",
    description: "Recommended when line items lack full corridor verification",
    badge: "Recommended",
  },
  {
    value: "SUPPORT_FULL_RELEASE",
    label: "SUPPORT FULL RELEASE (100% Claimed Amount)",
    description: "All physical items fully verified and corroborated",
  },
  {
    value: "HOLD",
    label: "HOLD (Suspend Pending Rectification)",
    description: "Hold entire tranche release until critical non-compliances are resolved",
  },
];

const LENDER_DECISION_OPTIONS: CustomSelectOption<LenderDecisionType>[] = [
  {
    value: "APPROVE_WITH_HOLDBACK",
    label: "APPROVE WITH HOLDBACK (Escrow Disputed Line Items)",
    description: "Disburse corroborated amounts; retain unverified items in escrow",
    badge: "Safeguarded",
  },
  {
    value: "APPROVE_FULL",
    label: "APPROVE FULL RELEASE",
    description: "Release full tranche funds to contractor escrow",
  },
  {
    value: "HOLD",
    label: "HOLD (Suspend Pending Rectification)",
    description: "Suspend disbursement pending further field verification",
  },
];

export function ReconciliationWorkbenchPage({
  project,
  ipcs,
  selectedIpc,
  onSelectIpc,
  boqItems,
  evidenceLogs,
}: ReconciliationWorkbenchPageProps) {
  const { user, hasPermission } = useAuth();
  const canRunAiReconcile = hasPermission("ipc:trigger_ai_reconcile");
  const canCertifyValuation = hasPermission("ipc:certify_valuation");
  const canApproveTranche = hasPermission("tranche:approve_disbursement");
  const canSubmitIpc = hasPermission("ipc:submit_claim");
  const canRespondQuery = hasPermission("reports:respond_query");
  const isContractorView = canSubmitIpc && !canCertifyValuation;

  const [selectedLineItem, setSelectedLineItem] =
    useState<IpcLineItemRecordDto | null>(null);
  const [showItineraryModal, setShowItineraryModal] = useState(false);

  const ipcSelectOptions: CustomSelectOption<string>[] = useMemo(
    () =>
      ipcs.map((ipc) => ({
        value: ipc.id,
        label: `IPC #${String(ipc.ipcNumber).padStart(2, "0")}: ${ipc.tranche.name}`,
        badge: formatCompactNaira(ipc.totalClaimedAmountNgn),
        description: `Disbursement Tranche #${ipc.tranche.trancheNumber}`,
      })),
    [ipcs]
  );

  // Mutations
  const reconcileMutation = useReconcileIpcMutation(project.id);
  const createQueryMutation = useCreateMonitorQueryMutation(project.id);
  const respondQueryMutation = useRespondMonitorQueryMutation(project.id);
  const certifyMutation = useCertifyValuationMutation(project.id);
  const decideTrancheMutation = useDecideTrancheMutation(project.id);
  const submitIpcMutation = useSubmitIpcMutation(project.id);

  // Modals for Monitor Certification, Lender Decision, Contractor New IPC
  const [showCertifyModal, setShowCertifyModal] = useState(false);
  const [showLenderDecisionModal, setShowLenderDecisionModal] = useState(false);
  const [showSubmitIpcModal, setShowSubmitIpcModal] = useState(false);

  // Monitor Certification Form State
  const [certRecommendation, setCertRecommendation] =
    useState<MonitorRecommendation>("SUPPORT_WITH_HOLDBACK");
  const [certSummaryText, setCertSummaryText] = useState(
    "Recommended partial release of verified work items; hold back disputed culvert wingwall reinforcement pending Tier 1 Hold-Point re-inspection.",
  );
  const [lineValuationPctMap, setLineValuationPctMap] = useState<
    Record<string, number>
  >({});

  // Lender Decision Form State
  const [lenderDecision, setLenderDecision] = useState<LenderDecisionType>(
    "APPROVE_WITH_HOLDBACK",
  );
  const [creditCommitteeRef, setCreditCommitteeRef] =
    useState("IC-CC-2026-Q4-019");
  const [lenderNotes, setLenderNotes] = useState(
    "Approved disbursement of Monitor-certified works; disputed Hold-Point amount retained in escrow until QSRBN/COREN re-verification.",
  );

  // Contractor Submit IPC Form State
  const [newIpcNumber, setNewIpcNumber] = useState(
    (ipcs[0]?.ipcNumber ?? 3) + 1,
  );
  const [newIpcCoverNote, setNewIpcCoverNote] = useState(
    "Monthly drawdown valuation covering earthworks, culvert concrete works, and sub-base course.",
  );

  const activeLineItemInDrawer = useMemo(() => {
    if (!selectedLineItem || !selectedIpc) return null;
    return (
      selectedIpc.lineItems.find((li) => li.id === selectedLineItem.id) ||
      selectedLineItem
    );
  }, [selectedLineItem, selectedIpc]);

  const openCertifyModal = () => {
    if (!selectedIpc) return;
    const initialMap: Record<string, number> = {};
    for (const li of selectedIpc.lineItems) {
      initialMap[li.id] =
        li.monitorCertifiedPct ??
        (li.aiEvidenceRating === "SUPPORTED"
          ? li.contractorClaimedPct
          : li.previousCertifiedPct);
    }
    setLineValuationPctMap(initialMap);
    setShowCertifyModal(true);
  };

  const handleRunAiReconciliation = async () => {
    if (!selectedIpc) return;
    try {
      await reconcileMutation.mutateAsync(selectedIpc.id);
      toast.success(
        "AI Reconciliation completed against geotagged field evidence and Hold-Points.",
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to run reconciliation");
    }
  };

  const handleRaiseQuery = async (
    ipcLineItemId: string,
    queryReason: string,
  ) => {
    if (!selectedIpc) return;
    await createQueryMutation.mutateAsync({
      ipcId: selectedIpc.id,
      body: {
        ipcLineItemId,
        queryReason,
        requestedProofTypes: ["SITE_PHOTO"],
      },
    });
    toast.success("Formal verification query issued.");
  };

  const handleRespondQuery = async (
    queryId: string,
    contractorResponseText: string,
    revisedClaimedCumulativePct?: number,
  ) => {
    if (!selectedIpc) return;
    await respondQueryMutation.mutateAsync({
      ipcId: selectedIpc.id,
      queryId,
      body: {
        contractorResponseText,
        revisedClaimedCumulativePct,
        attachedDocuments: [],
      },
    });
    toast.success("Response recorded on dispute query.");
  };

  const handleCertifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIpc || !user) return;
    try {
      const lineValuations = selectedIpc.lineItems.map((li) => {
        const certifiedPct =
          lineValuationPctMap[li.id] ??
          li.monitorCertifiedPct ??
          li.contractorClaimedPct;
        const deltaPct = Math.max(0, certifiedPct - li.previousCertifiedPct);
        const certifiedNgn = Math.round(
          (deltaPct / 100) * li.boqItem.budgetedCostNgn,
        );
        return {
          ipcLineItemId: li.id,
          monitorCertifiedCumulativePct: certifiedPct,
          monitorCertifiedAmountNgn: certifiedNgn,
          monitorRemarks:
            certifiedPct < li.contractorClaimedPct
              ? "Adjusted to match verified physical evidence"
              : "Verified on site",
        };
      });

      const totalReleaseNgn = lineValuations.reduce(
        (sum, item) => sum + item.monitorCertifiedAmountNgn,
        0,
      );
      const totalHoldbackNgn = Math.max(
        0,
        selectedIpc.totalClaimedAmountNgn - totalReleaseNgn,
      );

      await certifyMutation.mutateAsync({
        ipcId: selectedIpc.id,
        body: {
          lineValuations,
          trancheRecommendation: certRecommendation,
          recommendedReleaseAmountNgn: totalReleaseNgn,
          recommendedHoldbackAmountNgn: totalHoldbackNgn,
          executiveCertificationSummary: certSummaryText,
          certifierFullName: user.fullName,
          certifierLicenseType: user.professionalLicenseType || "QSRBN",
          certifierLicenseNumber: user.professionalLicenseNumber || "3842",
          certifierDigitalSignatureAck: true,
        },
      });

      setShowCertifyModal(false);
      toast.success(
        "Formal Valuation Certificate signed and logged to SHA-256 Audit Ledger.",
      );
    } catch (err: any) {
      toast.error(err?.message || "Certification failed.");
    }
  };

  const handleLenderDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIpc?.valuationReport) return;
    try {
      const releaseNgn =
        lenderDecision === "HOLD"
          ? 0
          : selectedIpc.valuationReport.recommendedReleaseAmountNgn;
      const holdbackNgn =
        lenderDecision === "APPROVE_FULL"
          ? 0
          : selectedIpc.valuationReport.recommendedHoldbackAmountNgn;

      await decideTrancheMutation.mutateAsync({
        trancheId: selectedIpc.trancheId,
        body: {
          valuationReportId: selectedIpc.valuationReport.id,
          decision: lenderDecision,
          approvedDisbursementAmountNgn: releaseNgn,
          heldBackAmountNgn: holdbackNgn,
          creditCommitteeReference: creditCommitteeRef,
          approverNotes: lenderNotes,
        },
      });

      setShowLenderDecisionModal(false);
      toast.success(
        "Tranche disbursement decision recorded and committed to immutable ledger.",
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to record tranche decision.");
    }
  };

  const handleContractorSubmitIpc = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetTranche = project.tranches[0];
    if (!targetTranche || boqItems.length === 0) return;

    try {
      const lineItemsPayload = boqItems.slice(0, 4).map((boq) => {
        const prevPct = boq.cumulativeCertifiedPct;
        const nextPct = Math.min(100, prevPct + 15);
        return {
          boqItemId: boq.id,
          claimedCumulativePct: nextPct,
          contractorRemarks: "Progress claimed per site measurement sheet",
        };
      });

      await submitIpcMutation.mutateAsync({
        trancheId: targetTranche.id,
        ipcNumber: Number(newIpcNumber),
        periodStart: new Date(Date.now() - 25 * 86400000).toISOString(),
        periodEnd: new Date().toISOString(),
        contractorCoverNote: newIpcCoverNote,
        lineItems: lineItemsPayload,
        supportingDocuments: [],
      });

      setShowSubmitIpcModal(false);
      toast.success(`IPC #${newIpcNumber} submitted and reconciled.`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit IPC claim.");
    }
  };

  if (!selectedIpc) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center">
        <h3 className="text-sm font-bold text-slate-900">
          No Interim Payment Certificates Submitted Yet
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Submit an IPC drawdown claim to run automated BOQ-to-Field-Evidence
          reconciliation.
        </p>
        {canSubmitIpc && (
          <button
            type="button"
            onClick={() => setShowSubmitIpcModal(true)}
            className="mt-4 px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover"
          >
            Submit First IPC Claim
          </button>
        )}
      </div>
    );
  }

  const totalCertifiedDisplay =
    selectedIpc.totalCertifiedNgn ??
    selectedIpc.lineItems.reduce(
      (sum, li) => sum + (li.monitorCertifiedNgn ?? 0),
      0,
    );
  const recommendedHoldbackDisplay = Math.max(
    0,
    selectedIpc.totalClaimedAmountNgn - totalCertifiedDisplay,
  );

  const supportedCount = selectedIpc.lineItems.filter(
    (li) => li.aiEvidenceRating === "SUPPORTED",
  ).length;
  const flaggedCount = selectedIpc.lineItems.filter(
    (li) =>
      li.aiEvidenceRating === "CONTRADICTED" ||
      li.aiEvidenceRating === "UNSUPPORTED" ||
      li.missingHoldPointFlag,
  ).length;

  const activeTrancheDetails =
    project.tranches.find((t) => t.id === selectedIpc.trancheId) ||
    project.tranches[0] ||
    null;

  const openQueryLineItems = selectedIpc.lineItems.filter((li) =>
    li.queries.some((q) => q.status === "OPEN"),
  );

  const reconciliationColumns: TableColumnDef<IpcLineItemRecordDto>[] = [
    {
      id: "wbsCode",
      header: "WBS ID",
      tooltip:
        "Work Breakdown Structure (WBS) reference code from the baseline Bill of Quantities",
      width: "w-32",
      cell: (li) => (
        <div className="space-y-1">
          <span className="font-bold text-slate-900 text-xs">
            {li.boqItem.wbsCode}
          </span>
          <div className="flex flex-col gap-1 items-start">
            {li.boqItem.isHoldPoint && (
              <TableBadge
                variant={li.missingHoldPointFlag ? "danger" : "warning"}
              >
                {li.missingHoldPointFlag ? "Hold-Point Missing" : "Hold-Point"}
              </TableBadge>
            )}
            {li.queries.some((q) => q.status === "OPEN") && (
              <TableBadge variant="info">Open Query</TableBadge>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "description",
      header: "Work Item",
      tooltip: "Baseline engineering work item description and bill section",
      width: "w-80",
      cell: (li) => (
        <div className="max-w-xs">
          <div className="text-slate-800 font-medium leading-snug line-clamp-2">
            {li.boqItem.description}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {li.boqItem.section} · {li.boqItem.totalQuantity.toLocaleString()}{" "}
            {li.boqItem.unit}
          </div>
        </div>
      ),
    },
    {
      id: "budget",
      header: "Budget (₦)",
      tooltip: "Total baseline budgeted cost allocated to this BOQ line item",
      align: "right",
      cell: (li) => (
        <span className="text-slate-600 font-medium">
          {formatCompactNaira(li.boqItem.budgetedCostNgn)}
        </span>
      ),
    },
    {
      id: "claim",
      header: "Contractor Claim",
      tooltip:
        "Cumulative completion percentage and drawdown amount claimed by the Main Contractor",
      align: "right",
      cell: (li) => (
        <div>
          <div className="font-bold text-slate-900">
            {li.contractorClaimedPct}%
          </div>
          <div className="text-[11px] text-slate-500">
            {formatCompactNaira(li.contractorClaimedNgn)}
          </div>
        </div>
      ),
    },
    {
      id: "evidenceRating",
      header: "Evidence Rating",
      tooltip:
        "AI Evidence Strength Rating comparing claim against geotagged site photos and Hold-Point logs",
      cell: (li) => {
        const ratingVariantMap: Record<
          string,
          "success" | "warning" | "danger"
        > = {
          SUPPORTED: "success",
          PARTIALLY_SUPPORTED: "warning",
          UNSUPPORTED: "warning",
          CONTRADICTED: "danger",
        };
        const ratingLabelMap: Record<string, string> = {
          SUPPORTED: "Supported",
          PARTIALLY_SUPPORTED: "Partially Supported",
          UNSUPPORTED: "Unsupported",
          CONTRADICTED: "Contradicted",
        };
        return (
          <TableBadge
            variant={ratingVariantMap[li.aiEvidenceRating] || "neutral"}
          >
            {ratingLabelMap[li.aiEvidenceRating] || li.aiEvidenceRating}
          </TableBadge>
        );
      },
    },
    {
      id: "corroborationTier",
      header: "Corroboration Role",
      tooltip:
        "Highest assurance-weight role among field reporters who submitted corroborating site logs",
      cell: (li) => {
        const weight = li.highestCorroboratingWeight ?? 0;
        const tierVariant =
          weight >= 0.9 ? "info" : weight >= 0.7 ? "success" : "neutral";
        return (
          <div>
            <TableBadge variant={tierVariant}>
              {li.highestCorroboratingRoleName || "No Evidence"}
            </TableBadge>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {li.corroboratingEvidenceLogIds.length} Verified Log
              {li.corroboratingEvidenceLogIds.length === 1 ? "" : "s"}
            </div>
          </div>
        );
      },
    },
    {
      id: "monitorValuation",
      header: "Monitor Valuation",
      tooltip:
        "Cumulative percentage and Naira valuation certified by the licensed Independent Monitor",
      align: "right",
      cell: (li) => (
        <div>
          <div
            className={`font-bold ${
              (li.monitorCertifiedPct ?? 0) < li.contractorClaimedPct
                ? "text-amber-700"
                : "text-emerald-700"
            }`}
          >
            {li.monitorCertifiedPct ?? li.previousCertifiedPct}%
          </div>
          <div className="text-[11px] text-slate-500">
            {formatCompactNaira(li.monitorCertifiedNgn ?? 0)}
          </div>
        </div>
      ),
    },
    {
      id: "actions",
      header: "Evidence",
      tooltip:
        "Inspect geotagged voice notes, Whisper transcripts, and dispute queries",
      align: "right",
      width: "w-28",
      cell: (li) => {
        const hasOpenQuery = li.queries.some((q) => q.status === "OPEN");
        const actionLabel =
          canRespondQuery && !canCertifyValuation && hasOpenQuery
            ? "Respond"
            : "Inspect";

        return (
          <div className="flex items-center justify-end gap-1.5">
            <TableActionButton
              onClick={() => setSelectedLineItem(li)}
              variant={hasOpenQuery ? "primary" : "default"}
            >
              {actionLabel}
            </TableActionButton>
            <TableActionMenu
              actions={[
                {
                  label: "Open Evidence Drawer",
                  onClick: () => setSelectedLineItem(li),
                },
                {
                  label: "Inspect Hold-Point Directives",
                  onClick: () => setSelectedLineItem(li),
                },
                {
                  label: "Dispute / Query Thread",
                  onClick: () => setSelectedLineItem(li),
                },
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {/* 1. Ghost Tranche Selector & Permission-Gated Action Header Bar */}
      <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Active Drawdown Certificate
          </div>
          <div className="mt-1 min-w-[280px] max-w-xl">
            <CustomSelect
              value={selectedIpc.id}
              onChange={(newId) => onSelectIpc(newId)}
              options={ipcSelectOptions}
              size="md"
            />
          </div>
        </div>

        {/* Far-Right Action Buttons (Permission-Gated) */}
        <div className="flex items-center gap-2.5 shrink-0">
          {canRunAiReconcile && (
            <button
              type="button"
              disabled={reconcileMutation.isPending}
              onClick={handleRunAiReconciliation}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition disabled:opacity-50"
            >
              {reconcileMutation.isPending
                ? "Reconciling..."
                : "Re-Run Reconciliation"}
            </button>
          )}
          {canCertifyValuation && (
            <button
              type="button"
              onClick={openCertifyModal}
              className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition"
            >
              Certify Valuation
            </button>
          )}

          {canApproveTranche && selectedIpc.valuationReport && (
            <button
              type="button"
              onClick={() => setShowLenderDecisionModal(true)}
              className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition"
            >
              Approve / Hold Tranche Disbursement
            </button>
          )}

          {canSubmitIpc && (
            <button
              type="button"
              onClick={() => setShowSubmitIpcModal(true)}
              className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition"
            >
              + Submit New IPC Claim
            </button>
          )}
        </div>
      </div>

      {/* 2. Three Financial KPI Cards (Contractor Claim, Monitor Certified, Recommended Holdback) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={<Wallet className="w-4 h-4" />}
          iconVariant="slate"
          title="Contractor Claim"
          value={formatNaira(selectedIpc.totalClaimedAmountNgn)}
          subtitle={`Period: ${formatDateShort(selectedIpc.periodStart)} – ${formatDateShort(
            selectedIpc.periodEnd,
          )} (${selectedIpc.lineItems.length} BOQ Line Items)`}
        />

        <KpiCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconVariant="emerald"
          title="Monitor Certified"
          value={formatNaira(totalCertifiedDisplay)}
          valueColorClass="text-emerald-700"
          subtitle={`${supportedCount} of ${selectedIpc.lineItems.length} Line Items Fully Corroborated`}
        />

        <KpiCard
          icon={<ShieldAlert className="w-4 h-4" />}
          iconVariant="amber"
          title={
            isContractorView
              ? "Queried / Held Back Amount"
              : "Recommended Holdback"
          }
          value={formatNaira(recommendedHoldbackDisplay)}
          valueColorClass="text-amber-700"
          subtitle={
            <span className="text-amber-700 font-medium">
              {flaggedCount} Item{flaggedCount === 1 ? "" : "s"} Flagged for Holdback / Re-Inspection
            </span>
          }
        />
      </div>

      {/* 3. Standardized Horizontally-Scrollable Reconciliation Table */}
      <StandardTable<IpcLineItemRecordDto>
        title={`IPC #${String(selectedIpc.ipcNumber).padStart(2, "0")}: Claim vs. Field Evidence Schedule`}
        subtitle={`${formatDateShort(selectedIpc.periodStart)} to ${formatDateShort(selectedIpc.periodEnd)}`}
        minWidth="min-w-[980px]"
        columns={reconciliationColumns}
        data={selectedIpc.lineItems}
        keyExtractor={(li) => li.id}
        selectedId={activeLineItemInDrawer?.id}
        onRowClick={(li) => setSelectedLineItem(li)}
        rowClassName={(li) => {
          const isFlagged =
            li.aiEvidenceRating === "CONTRADICTED" || li.missingHoldPointFlag;
          const isWarning =
            li.aiEvidenceRating === "PARTIALLY_SUPPORTED" ||
            li.aiEvidenceRating === "UNSUPPORTED";
          if (isFlagged)
            return "bg-red-50/25 hover:bg-red-50/50 border-l-4 border-l-red-600";
          if (isWarning) return "bg-amber-50/15 hover:bg-amber-50/35";
          return "";
        }}
      />

      {/* 4. Role-Tailored Bottom Governance Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left Card: Tailored to Active User Capabilities */}
        {canCertifyValuation || canRunAiReconcile ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Smart Visit Planner: Priority Verification Queue
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  High-value claimed items lacking Tier 1 Independent Monitor
                  evidence or mandatory Hold-Point sign-off
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowItineraryModal(true)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs shrink-0 self-start sm:self-auto"
              >
                <Printer className="w-3.5 h-3.5 text-brand-primary" />
                Generate Itinerary
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {selectedIpc.lineItems
                .filter((li) => li.visitPlannerFlag)
                .map((li) => (
                  <div
                    key={li.id}
                    onClick={() => setSelectedLineItem(li)}
                    className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/80 cursor-pointer flex items-center justify-between text-xs transition"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        <span className="text-brand-primary mr-1.5">
                          WBS {li.boqItem.wbsCode}
                        </span>
                        {li.boqItem.description}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {li.visitPlannerReason ||
                          "Requires independent Tier 1 verification prior to release"}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="font-bold text-slate-900">
                        {formatCompactNaira(li.contractorClaimedNgn)}
                      </div>
                      <div className="text-[10px] text-amber-700 font-semibold">
                        Inspect Next
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ) : canApproveTranche ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Lender Credit Committee: Project Conditions Precedent (CPs)
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Mandatory covenant and Hold-Point checks required prior to
                  releasing {selectedIpc.tranche.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowItineraryModal(true)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-semibold flex items-center gap-1 transition shrink-0 self-start sm:self-auto"
              >
                <Printer className="w-3 h-3 text-brand-primary" />
                View Inspection Plan
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {(activeTrancheDetails?.conditionsPrecedent || []).map((cp) => (
                <div
                  key={cp.id}
                  className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      <span className="text-brand-primary mr-1.5">
                        {cp.referenceCode}
                      </span>
                      {cp.description}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {cp.isMandatoryForRelease
                        ? "Mandatory for Tranche Release"
                        : "Advisory Covenant"}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ml-3 ${
                      cp.status === "SATISFIED"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-amber-50 text-amber-800 border-amber-200"
                    }`}
                  >
                    {cp.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
            <div className="text-xs font-bold text-slate-900">
              Monitor Discrepancy Queries Requiring Your Response
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Click any queried line item to provide field clarification,
              waybills, or a revised claim percentage
            </p>
            <div className="mt-3 space-y-2">
              {openQueryLineItems.length > 0 ? (
                openQueryLineItems.map((li) => (
                  <div
                    key={li.id}
                    onClick={() => setSelectedLineItem(li)}
                    className="p-2.5 rounded-xl bg-amber-50/50 hover:bg-amber-50 border border-amber-200 cursor-pointer flex items-center justify-between text-xs transition"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        <span className="text-brand-primary mr-1.5">
                          WBS {li.boqItem.wbsCode}
                        </span>
                        {li.boqItem.description}
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        {li.queries.find((q) => q.status === "OPEN")
                          ?.queryReason || "Clarification requested by Monitor"}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-brand-primary text-white text-[11px] font-semibold shrink-0 ml-3">
                      Respond
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-800 font-medium">
                  No open Monitor queries on this Interim Payment Certificate.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Card: Formal Certification & Lender Tranche Decision Status Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-900">
                Formal Valuation &amp; Tranche Release Governance
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-brand-primary">
                {selectedIpc.status}
              </span>
            </div>

            {selectedIpc.valuationReport ? (
              <div className="mt-3 space-y-2.5 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">
                      Monitor Certification:{" "}
                      {selectedIpc.valuationReport.certifierFullName}
                    </span>
                    <span className="text-[11px] text-brand-primary font-bold">
                      {selectedIpc.valuationReport.certifierLicenseType} #
                      {selectedIpc.valuationReport.certifierLicenseNumber}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-1 leading-relaxed text-[11px]">
                    {selectedIpc.valuationReport.executiveCertificationSummary}
                  </p>
                </div>

                {selectedIpc.valuationReport.trancheDecision ? (
                  <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                    <div className="flex items-center justify-between font-semibold text-emerald-900">
                      <span>
                        Lender Decision:{" "}
                        {selectedIpc.valuationReport.trancheDecision.decision}
                      </span>
                      <span className="text-[11px]">
                        Ref:{" "}
                        {
                          selectedIpc.valuationReport.trancheDecision
                            .creditCommitteeReference
                        }
                      </span>
                    </div>
                    <div className="text-[11px] text-emerald-800 mt-1">
                      Approved Release:{" "}
                      <strong>
                        {formatNaira(
                          selectedIpc.valuationReport.trancheDecision
                            .approvedDisbursementAmountNgn,
                        )}
                      </strong>{" "}
                      · Held Back:{" "}
                      <strong>
                        {formatNaira(
                          selectedIpc.valuationReport.trancheDecision
                            .heldBackAmountNgn,
                        )}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium">
                    Awaiting Lender / Guarantor Tranche Disbursement Decision.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 mt-3">
                Valuation Certificate not yet signed by Independent Monitor.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Floating Right-Hand Voice & Evidence Overlay Drawer */}
      <EvidenceOverlayDrawer
        lineItem={activeLineItemInDrawer}
        projectEvidenceLogs={evidenceLogs}
        onClose={() => setSelectedLineItem(null)}
        onRaiseQuery={handleRaiseQuery}
        onRespondQuery={handleRespondQuery}
      />

      {/* Modal 1: Monitor Valuation Certification */}
      {showCertifyModal && (
        <div className="fixed inset-0 bg-slate-950/35 backdrop-blur-[1px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl overflow-hidden">
            <div className="px-5 py-4 bg-brand-navy text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Sign Formal Monitor Valuation Certificate
                </h3>
                <p className="text-[11px] text-blue-200/80">
                  Certifying as {user?.fullName} (
                  {formatLicenseCredential(
                    user?.professionalLicenseType,
                    user?.professionalLicenseNumber,
                  )}
                  )
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCertifyModal(false)}
                className="p-1 rounded-lg text-blue-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCertifySubmit} className="p-5 space-y-4">
              <div>
                <CustomSelect
                  label="Tranche Disbursement Recommendation"
                  value={certRecommendation}
                  onChange={(newRec) => setCertRecommendation(newRec)}
                  options={MONITOR_RECOMMENDATION_OPTIONS}
                />
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                <div className="text-xs font-semibold text-slate-700">
                  Certified Cumulative Progress (%) per BOQ Line Item
                </div>
                {selectedIpc.lineItems.map((li) => (
                  <div
                    key={li.id}
                    className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200/80 text-xs"
                  >
                    <div className="truncate">
                      <span className="font-bold text-brand-primary mr-1.5">
                        {li.boqItem.wbsCode}
                      </span>
                      <span className="text-slate-700">
                        {li.boqItem.description}
                      </span>
                      <div className="text-[10px] text-slate-400">
                        Claimed: {li.contractorClaimedPct}% · Prev:{" "}
                        {li.previousCertifiedPct}%
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={li.previousCertifiedPct}
                        max={100}
                        step="0.5"
                        value={
                          lineValuationPctMap[li.id] ??
                          li.monitorCertifiedPct ??
                          li.contractorClaimedPct
                        }
                        onChange={(e) =>
                          setLineValuationPctMap((prev) => ({
                            ...prev,
                            [li.id]: Number(e.target.value),
                          }))
                        }
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs"
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Executive Certification Summary
                </label>
                <textarea
                  rows={3}
                  required
                  value={certSummaryText}
                  onChange={(e) => setCertSummaryText(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCertifyModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={certifyMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {certifyMutation.isPending
                    ? "Signing Certificate..."
                    : "Sign & Issue Valuation Certificate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Lender Tranche Disbursement Decision */}
      {showLenderDecisionModal && selectedIpc.valuationReport && (
        <div className="fixed inset-0 bg-slate-950/35 backdrop-blur-[1px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 bg-brand-navy text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Lender / Guarantor Tranche Disbursement Decision
                </h3>
                <p className="text-[11px] text-blue-200/80">
                  {selectedIpc.tranche.name} · Approver: {user?.fullName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLenderDecisionModal(false)}
                className="p-1 rounded-lg text-blue-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleLenderDecisionSubmit}
              className="p-5 space-y-4"
            >
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">
                    Monitor Recommended Release:
                  </span>
                  <span className="font-bold text-emerald-700">
                    {formatNaira(
                      selectedIpc.valuationReport.recommendedReleaseAmountNgn,
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">
                    Monitor Recommended Holdback:
                  </span>
                  <span className="font-bold text-amber-700">
                    {formatNaira(
                      selectedIpc.valuationReport.recommendedHoldbackAmountNgn,
                    )}
                  </span>
                </div>
              </div>

              <div>
                <CustomSelect
                  label="Disbursement Decision"
                  value={lenderDecision}
                  onChange={(newDec) => setLenderDecision(newDec)}
                  options={LENDER_DECISION_OPTIONS}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Credit Committee Reference
                </label>
                <input
                  type="text"
                  required
                  value={creditCommitteeRef}
                  onChange={(e) => setCreditCommitteeRef(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Approver Governance Notes
                </label>
                <textarea
                  rows={3}
                  value={lenderNotes}
                  onChange={(e) => setLenderNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowLenderDecisionModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={decideTrancheMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {decideTrancheMutation.isPending
                    ? "Recording..."
                    : "Commit Disbursement Decision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Contractor Submit New IPC Claim */}
      {showSubmitIpcModal && (
        <div className="fixed inset-0 bg-slate-950/35 backdrop-blur-[1px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-brand-navy text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Submit New Interim Payment Certificate (IPC)
                </h3>
                <p className="text-[11px] text-blue-200/80">
                  Automatically triggers AI evidence reconciliation
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubmitIpcModal(false)}
                className="p-1 rounded-lg text-blue-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleContractorSubmitIpc}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  IPC Sequence Number
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={newIpcNumber}
                  onChange={(e) => setNewIpcNumber(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contractor Cover Note
                </label>
                <textarea
                  rows={3}
                  required
                  value={newIpcCoverNote}
                  onChange={(e) => setNewIpcCoverNote(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSubmitIpcModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitIpcMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {submitIpcMutation.isPending
                    ? "Submitting & Reconciling..."
                    : "Submit IPC Drawdown"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Smart Visit Planner: Formal Site Inspection Itinerary Modal */}
      {showItineraryModal && (
        <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-brand-navy text-white flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 bg-sky-400/10 px-2 py-0.5 rounded border border-sky-400/20">
                    Smart Visit Planner
                  </span>
                  <span className="text-xs text-white/50">·</span>
                  <span className="text-xs text-blue-200">
                    Inspection Priority Protocol
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-0.5">
                  Technical Site Visit Itinerary: {project.codePrefix}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowItineraryModal(false)}
                className="w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Printable Document Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-slate-700">
              {/* Inspection Mission Card */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Infrastructure Project
                  </div>
                  <div className="font-bold text-slate-900 mt-0.5 text-xs">
                    {project.name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Location: {project.stateLocation} ({project.lgaLocation || "Corridor Zone"})
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Certifying Independent Monitor
                  </div>
                  <div className="font-bold text-slate-900 mt-0.5 text-xs">
                    {user?.fullName || "Lead Independent Monitor"}
                  </div>
                  <div className="text-[11px] text-brand-primary font-medium">
                    {formatLicenseCredential(user?.professionalLicenseType, user?.professionalLicenseNumber)}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/60">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Drawdown Certificate Under Review
                  </div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    IPC #{selectedIpc.ipcNumber} ({selectedIpc.tranche.name})
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/60">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Scheduled Inspection Window
                  </div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    Immediate Priority (Pre-Pour &amp; Claim Corroboration)
                  </div>
                </div>
              </div>

              {/* Ranked Inspection Checkpoints */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-900 text-xs">
                    Ranked Field Checkpoints &amp; Physical Verification Directives
                  </h4>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {selectedIpc.lineItems.filter((li) => li.visitPlannerFlag).length} Targets Flagged
                  </span>
                </div>

                <div className="space-y-3">
                  {selectedIpc.lineItems
                    .filter((li) => li.visitPlannerFlag)
                    .map((li, idx) => (
                      <div
                        key={li.id}
                        className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs space-y-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-full bg-brand-primary text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <div>
                              <div className="font-bold text-slate-900 text-xs">
                                WBS {li.boqItem.wbsCode}: {li.boqItem.description}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {li.boqItem.section}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-slate-900">
                              {formatCompactNaira(li.contractorClaimedNgn)}
                            </div>
                            <div className="text-[10px] text-amber-700 font-semibold">
                              Claimed
                            </div>
                          </div>
                        </div>

                        {/* Reason & Action Required */}
                        <div className="bg-amber-50/70 rounded-lg p-2.5 border border-amber-200/60 text-xs space-y-1">
                          <div className="font-semibold text-amber-900 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            {li.visitPlannerReason || "Physical inspection required prior to milestone release"}
                          </div>
                          <div className="text-[11px] text-slate-600">
                            {li.boqItem.holdPointInstruction || "Perform independent physical survey, slump and strength verification, and record geotagged camera captures."}
                          </div>
                        </div>

                        {/* Physical Test Checklist */}
                        <div className="pt-1 flex flex-wrap gap-2 text-[10px] text-slate-600">
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded font-medium">
                            <Check className="w-3 h-3 text-emerald-600" />
                            Dimensional &amp; Level Check
                          </span>
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded font-medium">
                            <Check className="w-3 h-3 text-emerald-600" />
                            Material Quality &amp; Mill Certificate
                          </span>
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded font-medium">
                            <Check className="w-3 h-3 text-emerald-600" />
                            Geotagged Shutter Angle Verification
                          </span>
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded font-medium">
                            <Check className="w-3 h-3 text-emerald-600" />
                            Independent Slump Test Sample
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Protocol Directives */}
              <div className="bg-blue-50/60 rounded-xl p-3.5 border border-blue-100 text-[11px] text-slate-700 leading-relaxed">
                <strong>Field Protocol Directive:</strong> Independent monitors must authenticate evidence logs within the project corridor boundary geofence. GPS coordinates with mock provider flags or timestamp anomalies are automatically rejected by the cryptographic engine.
              </div>

              {/* Tripartite Sign-off Block */}
              <div className="pt-4 border-t border-slate-200 grid grid-cols-3 gap-4 text-center">
                <div className="border-t border-slate-300 pt-2">
                  <div className="font-bold text-slate-800 text-[11px]">
                    Lead Independent Monitor
                  </div>
                  <div className="text-[10px] text-slate-500">
                    QSRBN Registered Quantity Surveyor
                  </div>
                </div>
                <div className="border-t border-slate-300 pt-2">
                  <div className="font-bold text-slate-800 text-[11px]">
                    Resident Clerk of Works
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Civil Infrastructure Resident Inspector
                  </div>
                </div>
                <div className="border-t border-slate-300 pt-2">
                  <div className="font-bold text-slate-800 text-[11px]">
                    Contractor Project Manager
                  </div>
                  <div className="text-[10px] text-slate-500">
                    COREN Registered Civil Engineer
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-500">
                InSite Assurance · Automated Visit Optimization
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowItineraryModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print / Export Itinerary
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
