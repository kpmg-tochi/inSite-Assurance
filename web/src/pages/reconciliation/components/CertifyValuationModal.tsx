import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  CertificationComputation,
  CertifyIpcValuationRequest,
  IpcClaimDto,
  MonitorRecommendation,
} from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "../../../components/common";
import { useAuth } from "../../../lib/auth-context";
import { IS_DEMO_MODE } from "../../../config/demoMode";
import { formatLicenseCredential, formatNaira } from "../../../lib/formatters";
import {
  useCertificationPreviewMutation,
  useCertifyValuationMutation,
} from "../../../mutations/reconciliation/useReconciliationMutations";
import { BlockedNotice, ModalActions, ModalShell, inputClass } from "./ModalShell";

const RECOMMENDATION_OPTIONS: CustomSelectOption<MonitorRecommendation>[] = [
  {
    value: "SUPPORT_WITH_HOLDBACK",
    label: "Support release with holdback",
    description: "You enter the release amount, at most the total certified",
  },
  {
    value: "SUPPORT_FULL_RELEASE",
    label: "Support full release of certified value",
    description: "Recommended release equals the total certified",
  },
  {
    value: "HOLD",
    label: "Hold",
    description: "Recommend no release until non-compliances are resolved",
  },
];

const DEMO_SUMMARY =
  "Recommended partial release of verified work items; hold back disputed items pending hold-point re-inspection.";

export function CertifyValuationModal({
  projectId,
  ipc,
  onClose,
}: {
  projectId: string;
  ipc: IpcClaimDto;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const previewMutation = useCertificationPreviewMutation(projectId);
  const certifyMutation = useCertifyValuationMutation(projectId);
  const hasLicence = Boolean(user?.professionalLicenseType && user?.professionalLicenseNumber);

  const [recommendation, setRecommendation] = useState<MonitorRecommendation>("SUPPORT_WITH_HOLDBACK");
  const [releaseAmount, setReleaseAmount] = useState("");
  const [summary, setSummary] = useState(IS_DEMO_MODE ? DEMO_SUMMARY : "");
  const [ack, setAck] = useState(false);
  const [figures, setFigures] = useState<CertificationComputation | null>(null);
  const [pcts, setPcts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ipc.lineItems.map((li) => [
        li.id,
        String(
          li.monitorCertifiedPct ??
            (li.aiEvidenceRating === "SUPPORTED" ? li.contractorClaimedPct : li.previousCertifiedPct),
        ),
      ]),
    ),
  );

  const outOfBounds = ipc.lineItems.filter((li) => {
    const v = Number(pcts[li.id]);
    return pcts[li.id] === "" || Number.isNaN(v) || v < li.previousCertifiedPct || v > li.contractorClaimedPct;
  });

  const body = useMemo((): CertifyIpcValuationRequest => ({
    lineValuations: ipc.lineItems.map((li) => ({
      ipcLineItemId: li.id,
      monitorCertifiedCumulativePct: Number(pcts[li.id]),
    })),
    trancheRecommendation: recommendation,
    ...(recommendation === "SUPPORT_WITH_HOLDBACK" ? { recommendedReleaseAmountNgn: Number(releaseAmount || 0) } : {}),
    executiveCertificationSummary: summary.trim(),
    certifierDigitalSignatureAck: true,
  }), [ipc.lineItems, pcts, recommendation, releaseAmount, summary]);

  const formReady = outOfBounds.length === 0 && summary.trim().length >= 10 &&
    (recommendation !== "SUPPORT_WITH_HOLDBACK" || releaseAmount !== "");

  const handlePreview = async () => {
    setFigures(null);
    try {
      const res = await previewMutation.mutateAsync({ ipcId: ipc.id, body });
      setFigures(res.computation);
    } catch {
      // error shown below from the mutation state
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ack || !formReady) return;
    try {
      const res = await certifyMutation.mutateAsync({ ipcId: ipc.id, body });
      setFigures(res.computation);
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell
      title="Certify valuation"
      subtitle={`IPC #${ipc.ipcNumber} · ${ipc.tranche.name}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Certifier (from your profile)</div>
          <div className="font-semibold text-slate-900 mt-0.5">{user?.fullName}</div>
          {hasLicence ? (
            <div className="text-brand-primary font-medium">
              {formatLicenseCredential(user?.professionalLicenseType, user?.professionalLicenseNumber)}
            </div>
          ) : (
            <div className="text-rose-700 font-medium mt-1">
              Your profile has no professional licence, so you cannot certify. Ask a user administrator to add your licence type and number in{" "}
              <Link to="/app/settings" className="underline">Settings</Link>.
            </div>
          )}
        </div>

        {!ipc.actions.certify.allowed && <BlockedNotice>{ipc.actions.certify.reason}</BlockedNotice>}

        <CustomSelect label="Recommendation" value={recommendation} onChange={(v) => { setRecommendation(v); setFigures(null); }} options={RECOMMENDATION_OPTIONS} />

        {recommendation === "SUPPORT_WITH_HOLDBACK" && (
          <label className="block text-xs font-medium text-slate-700">
            Recommended release (NGN), at most the total certified
            <input type="number" min={0} step="0.01" required value={releaseAmount} onChange={(e) => { setReleaseAmount(e.target.value); setFigures(null); }} className={`${inputClass} mt-1`} />
          </label>
        )}

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">Certified cumulative progress per line</div>
          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
            {ipc.lineItems.map((li) => {
              const bad = outOfBounds.includes(li);
              return (
                <div key={li.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200/80 text-xs">
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="font-bold text-brand-primary mr-1.5">{li.boqItem.wbsCode}</span>
                      <span className="text-slate-700">{li.boqItem.description}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Between {li.previousCertifiedPct}% (previous) and {li.contractorClaimedPct}% (claimed)
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min={li.previousCertifiedPct}
                      max={li.contractorClaimedPct}
                      step="0.01"
                      required
                      value={pcts[li.id]}
                      aria-invalid={bad}
                      onChange={(e) => { setPcts((p) => ({ ...p, [li.id]: e.target.value })); setFigures(null); }}
                      className={`w-24 rounded-lg border px-2 py-1 text-right text-xs ${bad ? "border-rose-400" : "border-slate-300"}`}
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <label className="block text-xs font-medium text-slate-700">
          Executive certification summary
          <textarea rows={3} required minLength={10} maxLength={3000} value={summary} onChange={(e) => setSummary(e.target.value)} className={`${inputClass} mt-1`} />
        </label>

        <div className="rounded-xl border border-slate-200 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">Server-computed figures</span>
            <button
              type="button"
              onClick={handlePreview}
              disabled={!formReady || previewMutation.isPending}
              className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewMutation.isPending ? "Calculating..." : "Calculate"}
            </button>
          </div>
          {previewMutation.isError && !figures && (
            <div className="text-rose-700">{(previewMutation.error as { message?: string })?.message}</div>
          )}
          {figures ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-slate-500">Total claimed</dt><dd className="text-right font-medium">{formatNaira(figures.totalClaimedNgn)}</dd>
              <dt className="text-slate-500">Total certified</dt><dd className="text-right font-bold text-emerald-700">{formatNaira(figures.totalCertifiedNgn)}</dd>
              <dt className="text-slate-500">Recommended release</dt><dd className="text-right font-bold">{formatNaira(figures.recommendedReleaseAmountNgn)}</dd>
              <dt className="text-slate-500">Holdback</dt><dd className="text-right font-medium text-amber-700">{formatNaira(figures.recommendedHoldbackAmountNgn)}</dd>
              <dt className="text-slate-500">Revision</dt><dd className="text-right">{figures.revisionNumber}</dd>
            </dl>
          ) : (
            <p className="text-slate-500">Amounts are computed by the server from the percentages. Calculate to see them before signing.</p>
          )}
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          <span>
            I certify that these percentages reflect my independent professional assessment, and I sign this valuation
            with the licence shown above.
          </span>
        </label>

        <ModalActions
          onCancel={onClose}
          submitLabel="Sign and certify"
          pendingLabel="Certifying..."
          isPending={certifyMutation.isPending}
          disabled={!ack || !formReady || !hasLicence || !ipc.actions.certify.allowed}
        />
      </form>
    </ModalShell>
  );
}
