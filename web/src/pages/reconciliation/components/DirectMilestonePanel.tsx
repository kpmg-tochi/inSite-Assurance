import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import type {
  DirectMilestoneSuggestionDto,
  DirectMilestoneValuationDto,
  MonitorRecommendation,
  VerifyDirectMilestoneRequest,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../../api/types";
import type { DirectMilestoneComputation } from "../../../api/reconciliation/reconciliationApi";
import { useAuth } from "../../../lib/auth-context";
import { formatDateTimeShort, formatLicenseCredential, formatNaira } from "../../../lib/formatters";
import { CustomSelect, type CustomSelectOption } from "../../../components/common";
import Loader from "../../../components/Loader";
import { ApprovalProgressBar } from "../../../components/process/ApprovalProgressBar";
import {
  useDirectMilestoneSuggestionQuery,
  useDirectValuationsQuery,
} from "../../../queries/reconciliation/useReconciliationQueries";
import {
  useDirectMilestonePreviewMutation,
  useDownloadValuationPdfByIdMutation,
  useReviewValuationMutation,
  useVerifyDirectMilestoneMutation,
} from "../../../mutations/reconciliation/useReconciliationMutations";
import { BlockedNotice, ModalShell, inputClass } from "./ModalShell";
import { ReverseTrancheDecisionModal, TrancheDecisionModal } from "./LenderDecisionModal";

const RECOMMENDATION_OPTIONS: CustomSelectOption<MonitorRecommendation>[] = [
  { value: "SUPPORT_FULL_RELEASE", label: "Support release of the verified value", description: "Recommended release equals the total verified" },
  { value: "SUPPORT_WITH_HOLDBACK", label: "Support release with holdback", description: "You enter the release amount, at most the total verified" },
  { value: "HOLD", label: "Hold", description: "Recommend no release yet" },
];

const RECOMMENDATION_LABEL: Record<MonitorRecommendation, string> = {
  SUPPORT_FULL_RELEASE: "Full release",
  SUPPORT_WITH_HOLDBACK: "Release with holdback",
  HOLD: "Hold",
};

const buttonPrimary =
  "px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed";
const buttonSecondary =
  "px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed";

const clampPct = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ---------------------------------------------------------------------------
// Verify milestone flow: tranche -> items -> summary -> preview -> submit
// ---------------------------------------------------------------------------

type FlowStep = "tranche" | "items" | "summary" | "preview";

function ItemsStep({
  suggestion,
  pcts,
  setPcts,
  remarks,
  setRemarks,
  holdPointsOn,
}: {
  suggestion: DirectMilestoneSuggestionDto;
  pcts: Record<string, string>;
  setPcts: (next: Record<string, string>) => void;
  remarks: Record<string, string>;
  setRemarks: (next: Record<string, string>) => void;
  holdPointsOn: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-[760px] w-full text-xs">
        <thead className="bg-slate-50 text-[11px] text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold" title="Already certified before this verification">Previous</th>
            <th className="px-3 py-2 text-right font-semibold" title="Counted field evidence: quantity and number of reports">Evidence</th>
            <th className="px-3 py-2 text-right font-semibold" title="The most you can verify: what the counted evidence supports">Max</th>
            <th className="px-3 py-2 text-right font-semibold">Verified cumulative %</th>
            <th className="px-3 py-2 text-left font-semibold">Remarks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {suggestion.items.map((item) => {
            const raw = pcts[item.boqItemId] ?? "";
            const n = Number(raw);
            const bad = raw === "" || !Number.isFinite(n) || n < item.previousCertifiedPct || n > item.maxVerifiablePct;
            const noRoom = item.maxVerifiablePct <= item.previousCertifiedPct;
            return (
              <tr key={item.boqItemId} className={noRoom ? "bg-slate-50/60" : undefined}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900">
                    <span className="text-brand-primary mr-1.5">{item.wbsCode}</span>
                    {item.description}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatNaira(item.budgetedCostNgn)}
                    {holdPointsOn && item.isHoldPoint ? " · hold point" : ""}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{item.previousCertifiedPct}%</td>
                <td className="px-3 py-2 text-right text-slate-600">
                  {item.evidenceQuantity.toLocaleString()} {item.unit}
                  <div className="text-[10px] text-slate-400">
                    {item.evidenceReportCount} report(s) · {item.evidenceDerivedPct}%
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-800">{item.maxVerifiablePct}%</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    step="0.01"
                    min={item.previousCertifiedPct}
                    max={item.maxVerifiablePct}
                    value={raw}
                    disabled={noRoom}
                    aria-label={`Verified cumulative percentage for ${item.wbsCode}`}
                    onChange={(e) => setPcts({ ...pcts, [item.boqItemId]: e.target.value })}
                    onBlur={() => {
                      if (raw === "" || !Number.isFinite(n)) return;
                      setPcts({ ...pcts, [item.boqItemId]: String(clampPct(n, item.previousCertifiedPct, item.maxVerifiablePct)) });
                    }}
                    className={`w-24 rounded-lg border px-2 py-1 text-right text-xs ${bad && !noRoom ? "border-red-400" : "border-slate-300"}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    maxLength={1000}
                    value={remarks[item.boqItemId] ?? ""}
                    disabled={noRoom}
                    onChange={(e) => setRemarks({ ...remarks, [item.boqItemId]: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ComputationTable({ computation }: { computation: DirectMilestoneComputation }) {
  return (
    <div className="space-y-2">
      <dl className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs grid grid-cols-2 gap-y-1">
        <dt className="text-slate-500">Supported by evidence (system claim)</dt>
        <dd className="text-right font-medium">{formatNaira(computation.totalClaimedNgn)}</dd>
        <dt className="text-slate-500">Total verified</dt>
        <dd className="text-right font-bold text-emerald-700">{formatNaira(computation.totalCertifiedNgn)}</dd>
        <dt className="text-slate-500">Recommended release</dt>
        <dd className="text-right font-bold text-emerald-700">{formatNaira(computation.recommendedReleaseAmountNgn)}</dd>
        <dt className="text-slate-500">Holdback</dt>
        <dd className="text-right font-medium text-amber-700">{formatNaira(computation.recommendedHoldbackAmountNgn)}</dd>
        <dt className="text-slate-500">Revision</dt>
        <dd className="text-right font-medium">{computation.revisionNumber}</dd>
      </dl>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-[560px] w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-semibold">Item</th>
              <th className="px-3 py-1.5 text-right font-semibold">Previous → verified</th>
              <th className="px-3 py-1.5 text-right font-semibold">Supported</th>
              <th className="px-3 py-1.5 text-right font-semibold">Verified amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {computation.lines.map((l) => (
              <tr key={l.boqItemId}>
                <td className="px-3 py-1.5">
                  <span className="text-brand-primary font-semibold mr-1">{l.wbsCode}</span>
                  {l.description}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {l.previousCertifiedPct}% → {l.verifiedCumulativePct}%
                </td>
                <td className="px-3 py-1.5 text-right">{formatNaira(l.systemClaimNgn)}</td>
                <td className="px-3 py-1.5 text-right font-semibold">{formatNaira(l.verifiedAmountNgn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VerifyMilestoneModal({
  project,
  tranchesOn,
  holdPointsOn,
  onClose,
}: {
  project: ProjectSummaryDto;
  tranchesOn: boolean;
  holdPointsOn: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const hasLicence = Boolean(user?.professionalLicenseType && user?.professionalLicenseNumber);
  const openTranches = project.tranches.filter((t) => !t.isReleased);
  const [step, setStep] = useState<FlowStep>(openTranches.length === 1 ? "items" : "tranche");
  const [trancheId, setTrancheId] = useState<string>(openTranches.length === 1 ? openTranches[0].id : "");
  const suggestionQuery = useDirectMilestoneSuggestionQuery(project.id, trancheId || null);
  const suggestion = suggestionQuery.data ?? null;
  const [pcts, setPcts] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [recommendation, setRecommendation] = useState<MonitorRecommendation>("SUPPORT_FULL_RELEASE");
  const [holdbackAmount, setHoldbackAmount] = useState("");
  const [ack, setAck] = useState(false);
  const [computation, setComputation] = useState<DirectMilestoneComputation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useDirectMilestonePreviewMutation(project.id);
  const verify = useVerifyDirectMilestoneMutation(project.id);

  // Default every input to what the evidence supports (never above it).
  useEffect(() => {
    if (!suggestion) return;
    const next: Record<string, string> = {};
    for (const item of suggestion.items) next[item.boqItemId] = String(item.maxVerifiablePct);
    setPcts(next);
    setRemarks({});
    setComputation(null);
  }, [suggestion]);

  const lineErrors = useMemo(() => {
    if (!suggestion) return [];
    return suggestion.items.filter((item) => {
      const n = Number(pcts[item.boqItemId]);
      return !Number.isFinite(n) || n < item.previousCertifiedPct || n > item.maxVerifiablePct;
    });
  }, [suggestion, pcts]);
  const verifiesSomething = Boolean(
    suggestion?.items.some((item) => Number(pcts[item.boqItemId]) > item.previousCertifiedPct),
  );

  const buildBody = (): VerifyDirectMilestoneRequest | null => {
    if (!suggestion) return null;
    return {
      trancheId: suggestion.trancheId,
      verificationSummary: summary.trim(),
      lineVerifications: suggestion.items.map((item) => ({
        boqItemId: item.boqItemId,
        verifiedCumulativePct: Number(pcts[item.boqItemId]),
        remarks: remarks[item.boqItemId]?.trim() || null,
      })),
      trancheRecommendation: recommendation,
      ...(recommendation === "SUPPORT_WITH_HOLDBACK" ? { holdbackReleaseAmountNgn: Number(holdbackAmount || 0) } : {}),
      certifierDigitalSignatureAck: true,
    };
  };

  const summaryReady =
    summary.trim().length >= 10 &&
    (recommendation !== "SUPPORT_WITH_HOLDBACK" || (holdbackAmount !== "" && Number(holdbackAmount) >= 0));

  const runPreview = async () => {
    const body = buildBody();
    if (!body) return;
    setError(null);
    try {
      const res = await preview.mutateAsync(body);
      setComputation(res.computation);
      setStep("preview");
    } catch (err) {
      setError((err as { message?: string })?.message ?? "The preview could not be computed.");
    }
  };

  const submit = async () => {
    const body = buildBody();
    if (!body || !ack) return;
    try {
      await verify.mutateAsync(body);
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  const trancheOptions: CustomSelectOption<string>[] = openTranches.map((t) => ({
    value: t.id,
    label: `Tranche #${t.trancheNumber}: ${t.name}`,
    description: `${formatNaira(t.allocatedAmountNgn - t.releasedAmountNgn)} unreleased`,
  }));

  const stepLabels: Array<{ id: FlowStep; label: string }> = [
    ...(tranchesOn || openTranches.length > 1 ? [{ id: "tranche" as const, label: "Tranche" }] : []),
    { id: "items", label: "Items" },
    { id: "summary", label: "Summary" },
    { id: "preview", label: "Preview and sign" },
  ];

  return (
    <ModalShell
      title="Verify milestone"
      subtitle={suggestion ? suggestion.trancheName : "Direct milestone release: no contractor claim"}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="p-5 space-y-4">
        <ol className="flex flex-wrap gap-2 text-[11px]">
          {stepLabels.map((s, i) => (
            <li
              key={s.id}
              className={`rounded-full px-2.5 py-0.5 font-semibold ${s.id === step ? "bg-brand-primary text-white" : "bg-slate-100 text-slate-500"}`}
            >
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>

        {!hasLicence && (
          <BlockedNotice>
            Your profile has no professional licence, so you cannot verify. Ask a user administrator to add your licence type and number in{" "}
            <Link to="/app/settings" className="underline">
              Settings
            </Link>
            .
          </BlockedNotice>
        )}

        {step === "tranche" && (
          <div className="space-y-3">
            {openTranches.length === 0 ? (
              <p className="text-xs text-slate-500">Every tranche has been fully released.</p>
            ) : (
              <CustomSelect label="Tranche" value={trancheId} onChange={setTrancheId} options={trancheOptions} placeholder="Choose a tranche" />
            )}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={onClose} className={buttonSecondary}>
                Cancel
              </button>
              <button type="button" disabled={!trancheId} onClick={() => setStep("items")} className={buttonPrimary}>
                Next
              </button>
            </div>
          </div>
        )}

        {step === "items" && (
          <div className="space-y-3">
            {suggestionQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader size="sm" /> Reading counted field evidence…
              </div>
            ) : suggestionQuery.isError ? (
              <BlockedNotice>{(suggestionQuery.error as { message?: string })?.message ?? "The evidence could not be loaded."}</BlockedNotice>
            ) : suggestion ? (
              <>
                {suggestion.openValuationId && (
                  <BlockedNotice>A verification on this tranche is still going through approval. Finish or return it before verifying again.</BlockedNotice>
                )}
                <p className="text-[11px] text-slate-500">
                  Each input starts at what the counted evidence supports. You can lower it to your own assessment, but not below
                  what is already certified or above the evidence.
                </p>
                {suggestion.items.length === 0 ? (
                  <p className="text-xs text-slate-500">No BOQ items are mapped to this tranche.</p>
                ) : (
                  <ItemsStep
                    suggestion={suggestion}
                    pcts={pcts}
                    setPcts={(next) => {
                      setPcts(next);
                      setComputation(null);
                    }}
                    remarks={remarks}
                    setRemarks={setRemarks}
                    holdPointsOn={holdPointsOn}
                  />
                )}
                {lineErrors.length > 0 && (
                  <p className="text-[11px] font-medium text-red-600">
                    {lineErrors.length} item(s) are outside the allowed range: {lineErrors.map((i) => i.wbsCode).join(", ")}.
                  </p>
                )}
              </>
            ) : null}
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-3">
              <button type="button" disabled={stepLabels[0].id === "items"} onClick={() => setStep("tranche")} className={buttonSecondary}>
                Back
              </button>
              <button
                type="button"
                disabled={!suggestion || Boolean(suggestion.openValuationId) || lineErrors.length > 0 || !verifiesSomething}
                title={!verifiesSomething ? "Verify progress on at least one item beyond what is already certified." : undefined}
                onClick={() => setStep("summary")}
                className={buttonPrimary}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === "summary" && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-700">
              Verification summary (what you inspected and how)
              <textarea
                rows={4}
                maxLength={5000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className={`${inputClass} mt-1`}
              />
              {summary.trim().length > 0 && summary.trim().length < 10 && (
                <span className="text-[11px] text-red-600">At least 10 characters.</span>
              )}
            </label>
            <CustomSelect label="Recommendation" value={recommendation} onChange={setRecommendation} options={RECOMMENDATION_OPTIONS} />
            {recommendation === "SUPPORT_WITH_HOLDBACK" && (
              <label className="block text-xs font-medium text-slate-700">
                Amount to release now (NGN), at most the total verified
                <input type="number" min={0} step="0.01" value={holdbackAmount} onChange={(e) => setHoldbackAmount(e.target.value)} className={`${inputClass} mt-1`} />
              </label>
            )}
            {error && <BlockedNotice>{error}</BlockedNotice>}
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setStep("items")} className={buttonSecondary}>
                Back
              </button>
              <button type="button" disabled={!summaryReady || preview.isPending} onClick={runPreview} className={buttonPrimary}>
                {preview.isPending ? "Calculating…" : "Preview amounts"}
              </button>
            </div>
          </div>
        )}

        {step === "preview" && computation && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">Amounts computed by the server. Nothing is saved until you sign.</p>
            <ComputationTable computation={computation} />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Verifier</div>
              <div className="font-semibold text-slate-900 mt-0.5">{computation.certifierFullName}</div>
              <div className="text-brand-primary font-medium">
                {formatLicenseCredential(computation.certifierLicenseType, computation.certifierLicenseNumber)}
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
              <span>
                I verified this progress independently against field evidence, and I sign this valuation with the licence shown above.
              </span>
            </label>
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setStep("summary")} className={buttonSecondary}>
                Back
              </button>
              <button type="button" disabled={!ack || !hasLicence || verify.isPending} onClick={submit} className={buttonPrimary}>
                {verify.isPending ? "Signing…" : "Sign and verify"}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Direct valuations list
// ---------------------------------------------------------------------------

function DirectValuationCard({
  project,
  valuation,
  cpsEnabled,
  highlighted,
  onDecide,
  onReverse,
}: {
  project: ProjectSummaryDto;
  valuation: DirectMilestoneValuationDto;
  cpsEnabled: boolean;
  /** Deep-linked with ?valuationId= (e.g. from a notification). */
  highlighted: boolean;
  onDecide: () => void;
  onReverse: () => void;
}) {
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(highlighted);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    setOpen(true);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlighted]);
  const review = useReviewValuationMutation(project.id);
  const pdf = useDownloadValuationPdfByIdMutation(project.id);
  const superseded = Boolean(valuation.supersededAt);

  return (
    <div
      ref={cardRef}
      id={`valuation-${valuation.id}`}
      className={`bg-white rounded-2xl border p-4 shadow-sm space-y-3 scroll-mt-4 ${
        highlighted ? "border-brand-primary ring-2 ring-brand-primary/30" : superseded ? "border-slate-200 opacity-70" : "border-slate-200/80"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-900">
            {valuation.trancheName} · revision {valuation.revisionNumber}
            {superseded && <span className="ml-2 text-[10px] font-semibold text-slate-400">superseded</span>}
          </div>
          <div className="text-[11px] text-slate-500">
            Verified by {valuation.certifierFullName} ({valuation.certifierLicenseType} #{valuation.certifierLicenseNumber}) ·{" "}
            {formatDateTimeShort(valuation.certifiedAt)}
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">
            {RECOMMENDATION_LABEL[valuation.trancheRecommendation]} · verified {formatNaira(valuation.totalCertifiedNgn)} of{" "}
            {formatNaira(valuation.totalClaimedNgn)} supported · release {formatNaira(valuation.recommendedReleaseAmountNgn)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission("valuation:export_pdf") && (
            <button type="button" disabled={pdf.isPending} onClick={() => pdf.mutate(valuation.id)} className={buttonSecondary}>
              <Download className="inline w-3.5 h-3.5 mr-1" />
              {pdf.isPending ? "Exporting…" : "PDF"}
            </button>
          )}
          {valuation.actions.reverseDecision.allowed && (
            <button type="button" onClick={onReverse} className={buttonSecondary}>
              Reverse decision
            </button>
          )}
          {hasPermission("tranche:approve_disbursement") && !valuation.activeDecision && !superseded && (
            <button
              type="button"
              onClick={onDecide}
              disabled={!valuation.actions.decide.allowed}
              title={valuation.actions.decide.reason ?? undefined}
              className={buttonPrimary}
            >
              Record release decision
            </button>
          )}
        </div>
      </div>

      {!valuation.activeDecision && !superseded && hasPermission("tranche:approve_disbursement") && !valuation.actions.decide.allowed && valuation.actions.decide.reason && (
        <p className="text-[11px] text-slate-500">Release decision unavailable: {valuation.actions.decide.reason}</p>
      )}

      {valuation.activeDecision && (
        <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs">
          <div className="font-semibold text-emerald-900">Decision: {valuation.activeDecision.decision.replace(/_/g, " ").toLowerCase()}</div>
          <div className="text-[11px] text-emerald-800 mt-1">
            Released <strong>{formatNaira(valuation.activeDecision.approvedDisbursementAmountNgn)}</strong> · Held back{" "}
            <strong>{formatNaira(valuation.activeDecision.heldBackAmountNgn)}</strong>
          </div>
        </div>
      )}

      {valuation.approval && (
        <ApprovalProgressBar
          title="Disbursement chain"
          approval={valuation.approval}
          isPending={review.isPending}
          hideActions={!valuation.actions.review.allowed}
          onReview={(decision, notes) => review.mutateAsync({ valuationId: valuation.id, decision, notes })}
        />
      )}
      {!valuation.actions.review.allowed && valuation.actions.review.reason && valuation.approval && !valuation.approval.completed && (
        <p className="text-[11px] text-slate-500">{valuation.actions.review.reason}</p>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Verification details
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-600 whitespace-pre-line">{valuation.verificationSummary}</p>
          <ComputationTable
            computation={{
              trancheId: valuation.trancheId,
              lines: valuation.lines,
              totalClaimedNgn: valuation.totalClaimedNgn,
              totalCertifiedNgn: valuation.totalCertifiedNgn,
              recommendedReleaseAmountNgn: valuation.recommendedReleaseAmountNgn,
              recommendedHoldbackAmountNgn: valuation.recommendedHoldbackAmountNgn,
              certifierFullName: valuation.certifierFullName,
              certifierLicenseType: valuation.certifierLicenseType,
              certifierLicenseNumber: valuation.certifierLicenseNumber,
              revisionNumber: valuation.revisionNumber,
            }}
          />
          {cpsEnabled ? null : <p className="text-[10px] text-slate-400">Conditions precedent are off on this project.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Reconciliation workbench in direct milestone mode (Phase 7): no contractor IPC. A licensed
 * verifier certifies progress from counted field evidence; the valuation then goes down the
 * project's disbursement chain to the release decision.
 */
export function DirectMilestonePanel({
  project,
  tranchesOn,
  holdPointsOn,
}: {
  project: ProjectSummaryDto;
  tranchesOn: boolean;
  holdPointsOn: boolean;
}) {
  const { hasPermission } = useAuth();
  const valuationsQuery = useDirectValuationsQuery(project.id);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [deciding, setDeciding] = useState<DirectMilestoneValuationDto | null>(null);
  const [reversing, setReversing] = useState<DirectMilestoneValuationDto | null>(null);
  const valuations = valuationsQuery.data ?? [];
  const [searchParams] = useSearchParams();
  const linkedValuationId = searchParams.get("valuationId");
  const canVerify = hasPermission("milestone:verify_direct_release");

  const decidingTranche = deciding ? project.tranches.find((t) => t.id === deciding.trancheId) : null;

  return (
    <div className="space-y-3">
      <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Direct milestone release</div>
          <div className="text-sm font-bold text-slate-900 mt-0.5">Milestone verifications</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            No contractor claim on this project. A licensed verifier certifies progress from counted field evidence; the
            valuation then goes through the disbursement chain to the release decision.
          </p>
        </div>
        {canVerify && (
          <button type="button" onClick={() => setVerifyOpen(true)} className={buttonPrimary}>
            Verify milestone
          </button>
        )}
      </div>

      {valuationsQuery.isLoading ? (
        <div className="flex items-center gap-2 p-6 text-xs text-slate-500">
          <Loader size="sm" /> Loading verifications…
        </div>
      ) : valuationsQuery.isError ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-xs text-amber-700">
          Verifications could not be loaded: {(valuationsQuery.error as { message?: string })?.message}
        </div>
      ) : valuations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center">
          <h3 className="text-sm font-bold text-slate-900">No milestone verifications yet</h3>
          <p className="text-xs text-slate-500 mt-1">
            {canVerify ? "Verify a milestone to start the first release." : "A licensed verifier starts the first release by verifying a milestone."}
          </p>
        </div>
      ) : (
        valuations.map((v) => (
          <DirectValuationCard
            key={v.id}
            project={project}
            valuation={v}
            cpsEnabled={tranchesOn}
            highlighted={v.id === linkedValuationId}
            onDecide={() => setDeciding(v)}
            onReverse={() => setReversing(v)}
          />
        ))
      )}

      {verifyOpen && (
        <VerifyMilestoneModal project={project} tranchesOn={tranchesOn} holdPointsOn={holdPointsOn} onClose={() => setVerifyOpen(false)} />
      )}
      {deciding && decidingTranche && (
        <TrancheDecisionModal
          projectId={project.id}
          tranche={decidingTranche}
          report={deciding}
          decide={deciding.actions.decide}
          subtitle={`${deciding.trancheName} · milestone verification revision ${deciding.revisionNumber}`}
          cpsEnabled={tranchesOn}
          onClose={() => setDeciding(null)}
        />
      )}
      {reversing?.activeDecision && (
        <ReverseTrancheDecisionModal
          projectId={project.id}
          decision={reversing.activeDecision}
          subtitle={`${reversing.trancheName} · revision ${reversing.revisionNumber}`}
          returnsTo="the verification returns to awaiting a decision"
          onClose={() => setReversing(null)}
        />
      )}
    </div>
  );
}
