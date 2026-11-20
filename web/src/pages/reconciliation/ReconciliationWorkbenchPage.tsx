import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Wallet, CheckCircle2, ShieldAlert, Printer, AlertTriangle } from "lucide-react";
import { canIpcTransition, type IpcClaimDto, type IpcClaimStatus, type IpcLineItemDto } from "@insite/shared";
import type { BoqItemRecordDto, ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira, formatDateShort, formatDateTimeShort, formatNaira } from "../../lib/formatters";
import { EvidenceOverlayDrawer } from "../../components/EvidenceOverlayDrawer";
import { useAuth, useTerm } from "../../lib/auth-context";
import { CustomSelect, type CustomSelectOption, KpiCard } from "../../components/common";
import Loader from "../../components/Loader";
import { useIpcDetailsQuery } from "../../queries/reconciliation/useReconciliationQueries";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import {
  useReconcileIpcMutation,
  useResolveMonitorQueryMutation,
  useRespondMonitorQueryMutation,
  useReviewValuationMutation,
  useWithdrawIpcMutation,
} from "../../mutations/reconciliation/useReconciliationMutations";
import { ApprovalProgressBar } from "../../components/process/ApprovalProgressBar";
import { DirectMilestonePanel } from "./components/DirectMilestonePanel";
import { SubmitIpcModal } from "./components/SubmitIpcModal";
import { CertifyValuationModal } from "./components/CertifyValuationModal";
import { LenderDecisionModal, ReverseDecisionModal } from "./components/LenderDecisionModal";
import { RaiseQueryModal } from "./components/RaiseQueryModal";
import { LineItemsTable } from "./components/LineItemsTable";
import { VisitItineraryModal } from "./components/VisitItineraryModal";
import { ModalActions, ModalShell, inputClass } from "./components/ModalShell";

interface ReconciliationWorkbenchPageProps {
  project: ProjectSummaryDto;
  ipcs: IpcClaimDto[];
  selectedIpc: IpcClaimDto | null;
  onSelectIpc: (ipcId: string) => void;
  boqItems: BoqItemRecordDto[];
}

const STATUS_LABEL: Record<IpcClaimStatus, string> = {
  SUBMITTED: "Submitted",
  AI_RECONCILED: "Reconciled",
  QUERIED_BY_MONITOR: "Queried",
  MONITOR_CERTIFIED: "Certified",
  LENDER_DECIDED: "Decided",
  REJECTED_WITHDRAWN: "Withdrawn",
};

type ModalState =
  | { kind: "none" }
  | { kind: "submit" }
  | { kind: "certify" }
  | { kind: "decide" }
  | { kind: "reverse" }
  | { kind: "withdraw" }
  | { kind: "itinerary" }
  | { kind: "query"; line: IpcLineItemDto };

const buttonPrimary =
  "px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed";
const buttonSecondary =
  "px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed";

function WithdrawModal({ projectId, ipc, onClose }: { projectId: string; ipc: IpcClaimDto; onClose: () => void }) {
  const withdrawMutation = useWithdrawIpcMutation(projectId);
  const term = useTerm();
  const [reason, setReason] = useState("");
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await withdrawMutation.mutateAsync({ ipcId: ipc.id, body: { reason: reason.trim() } });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };
  return (
    <ModalShell title={`Withdraw ${term("ipc")} #${ipc.ipcNumber}`} subtitle={`Frees the ${term("tranche", { lower: true })} for a new claim`} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <label className="block font-medium text-slate-700">
          Reason
          <textarea rows={3} required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <ModalActions onCancel={onClose} submitLabel="Withdraw claim" pendingLabel="Withdrawing..." isPending={withdrawMutation.isPending} disabled={reason.trim().length < 5} />
      </form>
    </ModalShell>
  );
}

export function ReconciliationWorkbenchPage({
  project,
  ipcs,
  selectedIpc,
  onSelectIpc,
  boqItems,
}: ReconciliationWorkbenchPageProps) {
  const { hasPermission, hasAnyPermission, ratingLabels } = useAuth();
  const term = useTerm();
  const canSubmitIpc = hasPermission("ipc:submit_claim");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const close = () => setModal({ kind: "none" });

  // The list endpoint omits evidence; the detail adds evidence and is refreshed by every mutation.
  const detailQuery = useIpcDetailsQuery(project.id, selectedIpc?.id);
  const ipc: IpcClaimDto | null = detailQuery.data?.id === selectedIpc?.id ? detailQuery.data ?? null : selectedIpc;

  // Phase 7: the project's process decides IPC vs direct milestone mode and which modules show.
  const processQuery = useProjectProcess(project.id);
  const processConfig = processQuery.data?.config;
  const directMode = processConfig?.disbursementMechanism === "MILESTONE_DIRECT_DISBURSEMENT";
  const tranchesOn = processConfig?.enableTranchesAndCps ?? true;
  const holdPointsOn = processConfig?.enableHoldPoints ?? true;
  const reviewValuationMutation = useReviewValuationMutation(project.id);

  // ?valuationId= (disbursement notifications): in IPC mode, select the IPC that owns the valuation.
  // Direct mode handles it in the milestone panel.
  const [searchParams] = useSearchParams();
  const linkedValuationId = searchParams.get("valuationId");
  useEffect(() => {
    if (!linkedValuationId || directMode) return;
    const owner = ipcs.find(
      (i) => i.valuationReport?.id === linkedValuationId || i.valuationRevisions?.some((r) => r.id === linkedValuationId),
    );
    if (owner && owner.id !== selectedIpc?.id) onSelectIpc(owner.id);
  }, [linkedValuationId, directMode, ipcs, selectedIpc?.id, onSelectIpc]);

  const reconcileMutation = useReconcileIpcMutation(project.id);
  const respondMutation = useRespondMonitorQueryMutation(project.id);
  const resolveMutation = useResolveMonitorQueryMutation(project.id);

  // Phase 6: several contractors may claim; IPC numbers run per contractor.
  const contractorIds = Array.from(new Set(ipcs.map((i) => i.projectContractorId ?? "")));
  const showContractor = project.contractorCount > 1 || contractorIds.length > 1;
  const [contractorFilter, setContractorFilter] = useState<string>("ALL");
  const visibleIpcs = contractorFilter === "ALL" ? ipcs : ipcs.filter((i) => i.projectContractorId === contractorFilter);
  const contractorOptions: CustomSelectOption<string>[] = [
    { value: "ALL", label: `All ${term("contractor", { plural: true, lower: true })}` },
    ...project.contractors.map((c) => ({ value: c.id, label: `${c.organizationName} (${c.tradeCode})` })),
  ];
  const ipcOptions: CustomSelectOption<string>[] = useMemo(
    () =>
      visibleIpcs.map((i) => ({
        value: i.id,
        label: `${showContractor && i.contractorTradeCode ? `${i.contractorTradeCode} ` : ""}${term("ipc")} #${String(i.ipcNumber).padStart(2, "0")}: ${i.tranche.name}`,
        badge: STATUS_LABEL[i.status],
        description: `${showContractor && i.contractorName ? `${i.contractorName} · ` : ""}${formatCompactNaira(i.totalClaimedAmountNgn)}`,
      })),
    [visibleIpcs, showContractor, term],
  );

  const submitModal =
    modal.kind === "submit" ? (
      <SubmitIpcModal project={project} ipcs={ipcs} boqItems={boqItems} onClose={close} onSubmitted={onSelectIpc} />
    ) : null;

  if (processQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-xs text-slate-500">
        <Loader size="sm" /> Loading the project's process…
      </div>
    );
  }

  // Direct milestone release replaces contractor claims (the mechanism is locked once either exists).
  if (directMode && ipcs.length === 0) {
    return <DirectMilestonePanel project={project} tranchesOn={tranchesOn} holdPointsOn={holdPointsOn} />;
  }

  if (!ipc) {
    return (
      <>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center">
          <h3 className="text-sm font-bold text-slate-900">No interim payment certificates yet</h3>
          <p className="text-xs text-slate-500 mt-1">Submitting a claim runs evidence reconciliation against field evidence for the claim period.</p>
          {canSubmitIpc && !directMode && (
            <button type="button" onClick={() => setModal({ kind: "submit" })} className={`mt-4 ${buttonPrimary}`}>
              Submit first {term("ipc")} claim
            </button>
          )}
        </div>
        {submitModal}
      </>
    );
  }

  const actions = ipc.actions;
  const report = ipc.valuationReport;
  const selectedLine = ipc.lineItems.find((li) => li.id === selectedLineId) ?? null;
  const supportedCount = ipc.lineItems.filter((li) => li.aiEvidenceRating === "SUPPORTED").length;
  const flaggedCount = ipc.lineItems.filter(
    (li) => li.aiEvidenceRating === "CONTRADICTED" || li.aiEvidenceRating === "UNSUPPORTED" || (holdPointsOn && li.missingHoldPointFlag),
  ).length;
  const outstandingQueryLines = ipc.lineItems.filter((li) => li.queries.some((q) => q.status === "OPEN" || q.status === "RESPONDED"));
  const isOversight = hasAnyPermission("ipc:trigger_ai_reconcile", "ipc:certify_valuation", "tranche:approve_disbursement");
  const reversals = report?.decisions.filter((d) => d.reversesDecisionId) ?? [];
  const pastDecisions = report?.decisions ?? [];

  return (
    <div className="space-y-3">
      <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Interim payment certificate</div>
          <div className="mt-1 min-w-[280px] max-w-xl">
            {showContractor && (
              <CustomSelect value={contractorFilter} onChange={setContractorFilter} options={contractorOptions} size="md" />
            )}
            <CustomSelect value={ipc.id} onChange={(id) => { setSelectedLineId(null); onSelectIpc(id); }} options={ipcOptions} size="md" />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="font-bold px-2 py-0.5 rounded bg-brand-primary/5 text-brand-primary">{STATUS_LABEL[ipc.status]}</span>
            {ipc.ratingEngine && (
              <span title={ipc.ratingEngineDetail ?? undefined}>
                Rated by {ipc.ratingEngine === "AZURE_OPENAI" ? "Azure OpenAI" : "the rules engine"}
                {ipc.reconciledAt ? ` · ${formatDateTimeShort(ipc.reconciledAt)}` : ""}
              </span>
            )}
            {detailQuery.isFetching && <Loader size="sm" />}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {actions.reconcile.allowed && (
            <button type="button" disabled={reconcileMutation.isPending} onClick={() => reconcileMutation.mutate(ipc.id)} className={buttonSecondary}>
              {reconcileMutation.isPending ? "Reconciling..." : "Re-run reconciliation"}
            </button>
          )}
          {actions.withdraw.allowed && (
            <button type="button" onClick={() => setModal({ kind: "withdraw" })} className={buttonSecondary}>
              Withdraw claim
            </button>
          )}
          {hasPermission("ipc:certify_valuation") && (
            <button
              type="button"
              onClick={() => setModal({ kind: "certify" })}
              // The modal explains any remaining blocker (licence, open queries); only the state gates opening it.
              disabled={!canIpcTransition(ipc.status, "certify")}
              title={actions.certify.reason ?? undefined}
              className={buttonPrimary}
            >
              {report ? `Re-certify ${term("valuation", { lower: true })}` : `Certify ${term("valuation", { lower: true })}`}
            </button>
          )}
          {hasPermission("tranche:approve_disbursement") && report && ipc.status === "MONITOR_CERTIFIED" && (
            <button
              type="button"
              onClick={() => setModal({ kind: "decide" })}
              disabled={!actions.decide.allowed}
              title={actions.decide.reason ?? undefined}
              className={buttonPrimary}
            >
              {tranchesOn ? `Record ${term("tranche", { lower: true })} decision` : "Record release decision"}
            </button>
          )}
          {actions.reverseDecision.allowed && (
            <button type="button" onClick={() => setModal({ kind: "reverse" })} className={buttonSecondary}>
              Reverse decision
            </button>
          )}
          {canSubmitIpc && !directMode && (
            <button type="button" onClick={() => setModal({ kind: "submit" })} className={buttonPrimary}>
              + Submit new {term("ipc")}
            </button>
          )}
        </div>
      </div>

      {ipc.reconciliationPending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          The claim is saved but evidence reconciliation has not completed. Ratings below are not yet meaningful.
          {actions.reconcile.allowed ? " Re-run reconciliation to retry." : " The monitor can re-run it."}
        </div>
      )}
      {hasPermission("tranche:approve_disbursement") && report && ipc.status === "MONITOR_CERTIFIED" && !actions.decide.allowed && actions.decide.reason && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
          Release decision unavailable: {actions.decide.reason}
        </div>
      )}
      {(actions.certify.reason && hasPermission("ipc:certify_valuation") && ipc.status !== "LENDER_DECIDED" && ipc.status !== "REJECTED_WITHDRAWN" && !actions.certify.allowed) && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
          Certification unavailable: {actions.certify.reason}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={<Wallet className="w-4 h-4" />}
          iconVariant="slate"
          title={`${term("contractor")} claim`}
          value={formatNaira(ipc.totalClaimedAmountNgn)}
          subtitle={`${formatDateShort(ipc.periodStart)} – ${formatDateShort(ipc.periodEnd)} · ${ipc.lineItems.length} line item(s)`}
        />
        <KpiCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconVariant="emerald"
          title="Monitor certified"
          value={report ? formatNaira(report.totalCertifiedNgn) : "Not certified"}
          valueColorClass="text-emerald-700"
          subtitle={`${supportedCount} of ${ipc.lineItems.length} lines rated ${ratingLabels.SUPPORTED.label}`}
        />
        <KpiCard
          icon={<ShieldAlert className="w-4 h-4" />}
          iconVariant="amber"
          title="Recommended holdback"
          value={report ? formatNaira(report.recommendedHoldbackAmountNgn) : `Pending ${term("valuation", { lower: true })}`}
          valueColorClass="text-amber-700"
          subtitle={
            <span className="text-amber-700 font-medium">
              {flaggedCount} line(s) rated {ratingLabels.CONTRADICTED.label}, {ratingLabels.UNSUPPORTED.label}{holdPointsOn ? ` or with an unmet ${term("holdPoint", { lower: true })}` : ""}
            </span>
          }
        />
      </div>

      <LineItemsTable ipc={ipc} selectedLineId={selectedLineId} onSelectLine={(li) => setSelectedLineId(li.id)} showHoldPoints={holdPointsOn} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {isOversight ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-900">Smart Visit Planner</div>
                <p className="text-[11px] text-slate-500 mt-0.5">{holdPointsOn ? `Lines lacking independent evidence or with an unmet ${term("holdPoint", { lower: true })}` : "Lines lacking independent evidence"}</p>
              </div>
              <button type="button" onClick={() => setModal({ kind: "itinerary" })} className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shrink-0">
                <Printer className="w-3.5 h-3.5 text-brand-primary" />
                Itinerary
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {ipc.smartVisitPlannerQueue.length === 0 ? (
                <p className="text-xs text-slate-500">No lines flagged for a site visit.</p>
              ) : (
                ipc.smartVisitPlannerQueue.map((entry) => (
                  <button
                    type="button"
                    key={entry.ipcLineItemId}
                    onClick={() => setSelectedLineId(entry.ipcLineItemId)}
                    className="w-full text-left p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/80 flex items-center justify-between text-xs transition"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        <span className="text-brand-primary mr-1.5">WBS {entry.wbsCode}</span>
                        {entry.description}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{entry.visitPlannerReason}</div>
                    </div>
                    <div className="font-bold text-slate-900 shrink-0 ml-3">{formatCompactNaira(entry.claimedAmountNgn)}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
            <div className="text-xs font-bold text-slate-900">Queries on this claim</div>
            <div className="mt-3 space-y-2">
              {outstandingQueryLines.length > 0 ? (
                outstandingQueryLines.map((li) => {
                  const q = li.queries.find((x) => x.status === "OPEN" || x.status === "RESPONDED")!;
                  return (
                    <button
                      type="button"
                      key={li.id}
                      onClick={() => setSelectedLineId(li.id)}
                      className="w-full text-left p-2.5 rounded-xl bg-amber-50/50 hover:bg-amber-50 border border-amber-200 flex items-center justify-between text-xs transition"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">
                          <span className="text-brand-primary mr-1.5">WBS {li.boqItem.wbsCode}</span>
                          {li.boqItem.description}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">{q.queryReason}</div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-brand-primary text-white text-[11px] font-semibold shrink-0 ml-3">
                        {q.status === "OPEN" ? "Respond" : "View"}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-800 font-medium">
                  No outstanding queries on this claim.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-900">{term("valuation")} and release</div>
          {report ? (
            <div className="mt-3 space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">
                    Revision {report.revisionNumber}: {report.certifierFullName}
                  </span>
                  <span className="text-[11px] text-brand-primary font-bold">
                    {report.certifierLicenseType} #{report.certifierLicenseNumber}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {report.trancheRecommendation.replace(/_/g, " ").toLowerCase()} · release {formatNaira(report.recommendedReleaseAmountNgn)} · certified{" "}
                  {formatDateTimeShort(report.certifiedAt)}
                </div>
                <p className="text-slate-600 mt-1 leading-relaxed text-[11px]">{report.executiveCertificationSummary}</p>
                {ipc.valuationRevisions.length > 1 && (
                  <p className="text-[10px] text-slate-400 mt-1">{ipc.valuationRevisions.length - 1} earlier revision(s) superseded.</p>
                )}
              </div>

              {ipc.activeDecision ? (
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="flex items-center justify-between font-semibold text-emerald-900">
                    <span>Decision: {ipc.activeDecision.decision.replace(/_/g, " ").toLowerCase()}</span>
                    {ipc.activeDecision.creditCommitteeReference && <span className="text-[11px]">Ref: {ipc.activeDecision.creditCommitteeReference}</span>}
                  </div>
                  <div className="text-[11px] text-emerald-800 mt-1">
                    Released <strong>{formatNaira(ipc.activeDecision.approvedDisbursementAmountNgn)}</strong> · Held back{" "}
                    <strong>{formatNaira(ipc.activeDecision.heldBackAmountNgn)}</strong>
                  </div>
                </div>
              ) : ipc.status === "MONITOR_CERTIFIED" ? (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium">
                  {report.approval && !report.approval.completed && report.approval.currentStepOrder !== report.approval.steps.length
                    ? "Going through the disbursement chain before the release decision."
                    : `Awaiting the ${term("funderParty", { lower: true })} decision.`}
                </div>
              ) : null}

              {/* Phase 7: position on the project's disbursement chain */}
              {report.approval && (
                <ApprovalProgressBar
                  title="Disbursement chain"
                  approval={report.approval}
                  isPending={reviewValuationMutation.isPending}
                  hideActions={!actions.reviewValuation.allowed}
                  onReview={(decision, notes) =>
                    reviewValuationMutation.mutateAsync({ valuationId: report.id, decision, notes })
                  }
                />
              )}
              {!actions.reviewValuation.allowed && actions.reviewValuation.reason && report.approval && !report.approval.completed && hasPermission("ipc:view") && (
                <p className="text-[11px] text-slate-500">{actions.reviewValuation.reason}</p>
              )}

              {reversals.length > 0 && (
                <div className="space-y-1">
                  {pastDecisions
                    .filter((d) => d.isReversed || d.reversesDecisionId)
                    .map((d) => (
                      <div key={d.id} className="text-[11px] text-slate-500">
                        {d.reversesDecisionId ? "Reversal" : `Reversed ${d.decision.replace(/_/g, " ").toLowerCase()}`}:{" "}
                        {formatNaira(d.approvedDisbursementAmountNgn)} · {formatDateTimeShort(d.decidedAt)}
                        {d.reversesDecisionId && d.approverNotes ? ` · ${d.approverNotes}` : ""}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-3">Not yet certified by the {term("monitorParty", { lower: true })}.</p>
          )}
        </div>
      </div>

      <EvidenceOverlayDrawer
        projectId={project.id}
        lineItem={selectedLine}
        actions={actions}
        holdPointsOn={holdPointsOn}
        onClose={() => setSelectedLineId(null)}
        onOpenRaiseQuery={(line) => setModal({ kind: "query", line })}
        onRespondQuery={async (queryId, text, revised) => {
          await respondMutation.mutateAsync({
            ipcId: ipc.id,
            queryId,
            body: { contractorResponseText: text, revisedClaimedCumulativePct: revised, attachedDocuments: [] },
          });
        }}
        onResolveQuery={async (queryId, note) => {
          await resolveMutation.mutateAsync({ ipcId: ipc.id, queryId, body: { resolutionNote: note } });
        }}
      />

      {submitModal}
      {modal.kind === "certify" && <CertifyValuationModal projectId={project.id} ipc={ipc} onClose={close} />}
      {modal.kind === "decide" && <LenderDecisionModal projectId={project.id} ipc={ipc} cpsEnabled={tranchesOn} onClose={close} />}
      {modal.kind === "reverse" && <ReverseDecisionModal projectId={project.id} ipc={ipc} onClose={close} />}
      {modal.kind === "withdraw" && <WithdrawModal projectId={project.id} ipc={ipc} onClose={close} />}
      {modal.kind === "itinerary" && <VisitItineraryModal project={project} ipc={ipc} holdPointsOn={holdPointsOn} onClose={close} />}
      {modal.kind === "query" && <RaiseQueryModal projectId={project.id} ipc={ipc} lineItem={modal.line} onClose={close} />}
    </div>
  );
}
