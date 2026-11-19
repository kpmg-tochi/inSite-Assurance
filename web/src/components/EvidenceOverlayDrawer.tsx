import React, { useEffect, useState } from "react";
import { X, MapPin, AlertTriangle } from "lucide-react";
import type {
  IpcClaimDto,
  IpcLineItemDto,
  ProvidedEvidenceItem,
  ProvidedEvidenceMedia,
  QueryStatus,
} from "@insite/shared";
import { useProjectWorkdayReportsQuery } from "../queries/telemetry/useTelemetryQueries";
import { CaptureAudio, CapturePhoto } from "./evidence/CaptureMedia";
import { formatDateTimeShort, formatNaira } from "../lib/formatters";
import { EvidenceBadge, formatReporterRoleBadge, ratingTone } from "./EvidenceBadge";
import { useAuth } from "../lib/auth-context";
import Drawer from "./Drawer";

interface EvidenceOverlayDrawerProps {
  projectId: string;
  lineItem: IpcLineItemDto | null;
  actions: IpcClaimDto["actions"] | null;
  onClose: () => void;
  onOpenRaiseQuery?: (lineItem: IpcLineItemDto) => void;
  onRespondQuery?: (queryId: string, responseText: string, revisedClaimedPct?: number) => Promise<void>;
  onResolveQuery?: (queryId: string, resolutionNote: string) => Promise<void>;
}

const RULE_CAP_TEXT: Record<string, string> = {
  NO_EVIDENCE: "No usable evidence",
  CONTRACTOR_ONLY_EVIDENCE: "Contractor-only evidence",
  HOLD_POINT_WITHOUT_INDEPENDENT_EVIDENCE: "Hold point lacks independent evidence",
  COVERAGE_BELOW_50_PCT: "Quantity coverage below 50%",
  INTEGRITY_FLAGGED_EVIDENCE_EXCLUDED: "Integrity-flagged evidence excluded",
};

export const QUERY_STATUS_CHIP: Record<QueryStatus, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  RESPONDED: "bg-sky-100 text-sky-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
};

/** Loads a short-lived signed URL on demand and plays the real file. No placeholder player. */
function EvidenceCard({ projectId, item }: { projectId: string; item: ProvidedEvidenceItem }) {
  const voice = item.media.filter((m) => m.mediaType === "VOICE_NOTE");
  const photos = item.media.filter((m) => m.mediaType === "SITE_PHOTO");
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">
            {formatReporterRoleBadge(item.reporterRoleName, item.fieldPersonaType)}
          </div>
          <div className="text-[11px] text-slate-500">
            {item.reporterName ?? "Reporter not recorded"} · {formatDateTimeShort(item.capturedAt)}
            {item.chainageLabel ? ` · ${item.chainageLabel}` : ""}
          </div>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
            item.isWithinGeofence === true
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : item.isWithinGeofence === false
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : "bg-slate-50 text-slate-600 border-slate-200"
          }`}
        >
          {item.isWithinGeofence === true
            ? "Inside geofence"
            : item.isWithinGeofence === false
              ? "Outside geofence"
              : "Location unknown"}
        </span>
      </div>

      {!item.integrityPassed && (
        <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 border border-rose-200 p-2 text-[11px] text-rose-800">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            Failed integrity checks{item.integrityFlags.length ? `: ${item.integrityFlags.join(", ")}` : ""}. Not
            counted as support.
          </span>
        </div>
      )}

      {item.summary && <p className="text-slate-800 leading-relaxed">{item.summary}</p>}

      {item.quantities.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          {item.quantities.map((q, idx) => (
            <div key={idx} className="bg-slate-50 rounded-lg p-2">
              <div className="text-[10px] text-slate-400">{q.materialOrWork}</div>
              <div className="font-bold text-slate-900">
                {q.quantity.toLocaleString()} {q.unit}
              </div>
            </div>
          ))}
        </div>
      )}

      {item.blockers.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-rose-700 font-medium list-disc list-inside">
          {item.blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}

      {(voice.length > 0 || photos.length > 0) && (
        <div className="pt-1 space-y-1.5">
          {voice.map((m) => (
            <CaptureAudio key={m.id} projectId={projectId} objectKey={m.objectKey} />
          ))}
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {photos.map((m) => (
                <CapturePhoto key={m.id} projectId={projectId} objectKey={m.objectKey} alt="Site photo" className="w-20 h-20" />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="text-[10px] text-slate-400">
        {item.gpsAccuracyMeters !== null ? `GPS ±${item.gpsAccuracyMeters.toFixed(1)}m` : "No GPS fix"}
        {" · "}
        {item.signatureVerified === true
          ? "Device signature checked"
          : item.signatureVerified === false
            ? "Device signature invalid"
            : "Not signed by device"}
        {item.confirmedAt ? ` · Confirmed by reporter ${formatDateTimeShort(item.confirmedAt)}` : ""}
      </div>
    </div>
  );
}

export function EvidenceOverlayDrawer({
  projectId,
  lineItem,
  actions,
  onClose,
  onOpenRaiseQuery,
  onRespondQuery,
  onResolveQuery,
}: EvidenceOverlayDrawerProps) {
  const { hasAnyPermission } = useAuth();
  const canSeeEvidence = hasAnyPermission(
    "ipc:trigger_ai_reconcile",
    "ipc:certify_valuation",
    "tranche:approve_disbursement",
    "audit:view_ledger",
  );
  const [replyText, setReplyText] = useState("");
  const [revisedPct, setRevisedPct] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const workdayReportsQuery = useProjectWorkdayReportsQuery(projectId, Boolean(lineItem));

  useEffect(() => {
    setReplyText("");
    setRevisedPct("");
    setResolutionNote("");
  }, [lineItem?.id]);

  if (!lineItem) return null;

  const tone = ratingTone(lineItem.aiEvidenceRating);
  const outstanding = lineItem.queries.find((q) => q.status === "OPEN" || q.status === "RESPONDED");
  const latestWorkdayReport = (workdayReportsQuery.data ?? []).find(
    (r) => r.wbsItemId === lineItem.boqItemId || r.wbsCode === lineItem.boqItem.wbsCode,
  );
  const periodQty = ((lineItem.contractorClaimedPct - lineItem.previousCertifiedPct) / 100) * lineItem.boqItem.totalQuantity;

  const run = async (fn: () => Promise<void>) => {
    try {
      setSubmitting(true);
      await fn();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRespond = (e: React.FormEvent, queryId: string) => {
    e.preventDefault();
    if (!onRespondQuery || !replyText.trim()) return;
    void run(async () => {
      await onRespondQuery(queryId, replyText.trim(), revisedPct.trim() !== "" ? Number(revisedPct) : undefined);
      setReplyText("");
      setRevisedPct("");
    });
  };

  const handleResolve = (e: React.FormEvent, queryId: string) => {
    e.preventDefault();
    if (!onResolveQuery || !resolutionNote.trim()) return;
    void run(async () => {
      await onResolveQuery(queryId, resolutionNote.trim());
      setResolutionNote("");
    });
  };

  return (
    <Drawer
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="p-4 border-b border-slate-100 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
              Field Evidence Review
            </span>
            <EvidenceBadge rating={lineItem.aiEvidenceRating} />
          </div>
          <h3 className="text-sm font-bold text-slate-900 mt-1">
            WBS {lineItem.boqItem.wbsCode}: {lineItem.boqItem.description}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Rated by{" "}
            {lineItem.ratingEngine === "AZURE_OPENAI"
              ? "Azure OpenAI"
              : lineItem.ratingEngine === "RULES_ENGINE"
                ? "the rules engine"
                : "an unrecorded engine"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close drawer"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        <div className="grid grid-cols-2 gap-2.5 bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs">
          <div>
            <div className="text-slate-400 text-[11px]">Contractor Claim</div>
            <div className="font-bold text-slate-900 mt-0.5">
              {lineItem.contractorClaimedPct}% ({formatNaira(lineItem.contractorClaimedNgn)})
            </div>
            <div className="text-[10px] text-slate-400">Previously certified {lineItem.previousCertifiedPct}%</div>
          </div>
          <div>
            <div className="text-slate-400 text-[11px]">Monitor Valuation</div>
            <div className="font-bold text-brand-primary mt-0.5">
              {lineItem.monitorCertifiedPct === null
                ? "Not certified"
                : `${lineItem.monitorCertifiedPct}% (${formatNaira(lineItem.monitorCertifiedNgn ?? 0)})`}
            </div>
          </div>
        </div>

        {(lineItem.aiRationale || lineItem.missingHoldPointFlag || lineItem.ruleCapsApplied.length > 0) && (
          <div className={`rounded-xl p-3 border ${lineItem.missingHoldPointFlag ? ratingTone("CONTRADICTED").panel : tone.panel}`}>
            <div className={`text-[11px] font-bold uppercase tracking-wider ${lineItem.missingHoldPointFlag ? ratingTone("CONTRADICTED").text : tone.text}`}>
              {lineItem.missingHoldPointFlag ? "Mandatory hold point unfulfilled" : "Reconciliation assessment"}
            </div>
            {lineItem.evidenceCoveragePct !== null && (
              <p className="text-xs mt-1 text-slate-700">
                Evidenced {lineItem.evidenceQuantityTotal?.toLocaleString() ?? 0} of{" "}
                {periodQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} {lineItem.boqItem.unit} claimed for the
                period (coverage {lineItem.evidenceCoveragePct}%).
              </p>
            )}
            {lineItem.aiRationale && <p className="text-xs mt-1 leading-relaxed text-slate-700">{lineItem.aiRationale}</p>}
            {lineItem.ruleCapsApplied.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {lineItem.ruleCapsApplied.map((cap) => (
                  <span key={cap} className="px-2 py-0.5 rounded bg-white/70 border border-slate-200 text-[10px] font-semibold text-slate-700">
                    {RULE_CAP_TEXT[cap] ?? cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Evidence considered ({lineItem.evidence.length})
          </div>
          {!canSeeEvidence ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Field evidence detail is visible to oversight roles only.
            </div>
          ) : lineItem.evidence.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
              No evidence linked to this line up to the end of the claim period.
            </div>
          ) : (
            lineItem.evidence.map((item) => <EvidenceCard key={item.id} projectId={projectId} item={item} />)
          )}
        </div>

        {lineItem.queries.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Query thread ({lineItem.queries.length})
            </div>
            {lineItem.queries.map((q) => (
              <div key={q.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Monitor query · {formatDateTimeShort(q.createdAt)}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${QUERY_STATUS_CHIP[q.status]}`}>{q.status}</span>
                </div>
                <p className="text-slate-600">{q.queryReason}</p>
                {q.contractorResponseText && (
                  <div className="pt-2 mt-2 border-t border-slate-200/80">
                    <div className="font-semibold text-brand-primary">Contractor response</div>
                    <p className="text-slate-700 mt-0.5">{q.contractorResponseText}</p>
                    {q.revisedClaimedCumulativePct !== null && (
                      <p className="text-[11px] text-slate-500 mt-0.5">Revised claim: {q.revisedClaimedCumulativePct}%</p>
                    )}
                  </div>
                )}
                {q.resolutionNote && (
                  <div className="pt-2 mt-2 border-t border-slate-200/80">
                    <div className="font-semibold text-emerald-800">Resolution</div>
                    <p className="text-slate-700 mt-0.5">{q.resolutionNote}</p>
                  </div>
                )}

                {q.status === "OPEN" && actions?.respondQuery.allowed && onRespondQuery && (
                  <form onSubmit={(e) => handleRespond(e, q.id)} className="pt-2 mt-2 border-t border-slate-200 space-y-2">
                    <textarea
                      rows={2}
                      required
                      minLength={4}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Clarification or corrective action"
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-primary"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={lineItem.previousCertifiedPct + 0.01}
                        max={100}
                        step="0.01"
                        value={revisedPct}
                        onChange={(e) => setRevisedPct(e.target.value)}
                        placeholder={`Revised claim % (above ${lineItem.previousCertifiedPct}, optional)`}
                        className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-primary"
                      />
                      <button
                        type="submit"
                        disabled={submitting}
                        className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover transition disabled:opacity-50"
                      >
                        {submitting ? "Sending..." : "Submit reply"}
                      </button>
                    </div>
                  </form>
                )}

                {(q.status === "OPEN" || q.status === "RESPONDED") && actions?.resolveQuery.allowed && onResolveQuery && (
                  <form onSubmit={(e) => handleResolve(e, q.id)} className="pt-2 mt-2 border-t border-slate-200 flex items-center gap-2">
                    <input
                      required
                      minLength={3}
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Resolution note"
                      className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-primary"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50"
                    >
                      Resolve
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        {latestWorkdayReport && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-brand-primary" />
                Workday report geotag ({latestWorkdayReport.workdayDate})
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  !latestWorkdayReport.submissionGeotag
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : latestWorkdayReport.submissionGeotag.isMocked ||
                        latestWorkdayReport.submissionGeotag.isWithinGeofence === false
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : "bg-emerald-50 text-emerald-800 border-emerald-200"
                }`}
              >
                {!latestWorkdayReport.submissionGeotag
                  ? "No GPS"
                  : latestWorkdayReport.submissionGeotag.isMocked
                    ? "Mock GPS"
                    : latestWorkdayReport.submissionGeotag.isWithinGeofence === false
                      ? "Off-Site"
                      : "On-Site"}
              </span>
            </div>
            {latestWorkdayReport.submissionGeotag ? (
              <p className="text-[11px] font-mono text-slate-600">
                {latestWorkdayReport.submissionGeotag.chainageLabel ||
                  `${latestWorkdayReport.submissionGeotag.latitude.toFixed(5)}, ${latestWorkdayReport.submissionGeotag.longitude.toFixed(5)}`}
                {" · "}
                {formatDateTimeShort(latestWorkdayReport.submissionGeotag.capturedAt)}
              </p>
            ) : (
              <p className="text-[11px] text-amber-700">Submitted without GPS coordinates.</p>
            )}
          </div>
        )}
      </div>

      <div className="p-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between gap-2">
        {actions?.raiseQuery.allowed && onOpenRaiseQuery && !outstanding && (
          <button
            type="button"
            onClick={() => onOpenRaiseQuery(lineItem)}
            className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Issue query
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2 px-3 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover transition shadow-sm"
        >
          Done reviewing
        </button>
      </div>
    </Drawer>
  );
}
