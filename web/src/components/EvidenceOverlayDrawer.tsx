import React, { useEffect, useState } from "react";
import { Play, Pause, X } from "lucide-react";
import type {
  FieldEvidenceLogRecordDto,
  IpcLineItemRecordDto,
} from "../api/types";
import { formatDateTimeShort, formatNaira } from "../lib/formatters";
import {
  EvidenceRatingBadge,
  formatIndependenceTierText,
} from "./EvidenceBadge";
import { useAuth } from "../lib/auth-context";
import Drawer from "./Drawer";

interface EvidenceOverlayDrawerProps {
  lineItem: IpcLineItemRecordDto | null;
  projectEvidenceLogs: FieldEvidenceLogRecordDto[];
  onClose: () => void;
  onRaiseQuery?: (ipcLineItemId: string, queryReason: string) => Promise<void>;
  onRespondQuery?: (
    queryId: string,
    responseText: string,
    revisedClaimedPct?: number,
  ) => Promise<void>;
}

const WAVEFORM_HEIGHTS = [
  3, 6, 4, 8, 5, 7, 3, 6, 8, 4, 5, 7, 4, 6, 3, 5, 7, 4, 3, 6, 5, 4,
];

export function EvidenceOverlayDrawer({
  lineItem,
  projectEvidenceLogs,
  onClose,
  onRaiseQuery,
  onRespondQuery,
}: EvidenceOverlayDrawerProps) {
  const { user } = useAuth();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressStep, setProgressStep] = useState(8);
  const [queryText, setQueryText] = useState("");
  const [contractorReplyText, setContractorReplyText] = useState("");
  const [revisedPctInput, setRevisedPctInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [showQueryInput, setShowQueryInput] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    setProgressStep(8);
    setShowQueryInput(false);
    setQueryText("");
    setContractorReplyText("");
    setRevisedPctInput("");
  }, [lineItem?.id]);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setProgressStep((prev) => {
        if (prev >= WAVEFORM_HEIGHTS.length) {
          setIsPlaying(false);
          return 8;
        }
        return prev + 1;
      });
    }, 350);
    return () => clearInterval(interval);
  }, [isPlaying]);

  if (!lineItem) return null;

  // Match corroborating or linked evidence logs for this BOQ item
  const matchingLogs = projectEvidenceLogs.filter(
    (log) =>
      log.boqItemId === lineItem.boqItemId ||
      lineItem.corroboratingEvidenceLogIds.includes(log.id),
  );
  const primaryLog = matchingLogs[0] || projectEvidenceLogs[0] || null;

  const openQuery = lineItem.queries.find((q) => q.status === "OPEN");

  const handleCreateQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRaiseQuery || !queryText.trim()) return;
    try {
      setSubmitting(true);
      await onRaiseQuery(lineItem.id, queryText.trim());
      setQueryText("");
      setShowQueryInput(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRespondToQuery = async (e: React.FormEvent, queryId: string) => {
    e.preventDefault();
    if (!onRespondQuery || !contractorReplyText.trim()) return;
    try {
      setSubmitting(true);
      const parsedPct =
        revisedPctInput.trim() !== "" ? Number(revisedPctInput) : undefined;
      await onRespondQuery(queryId, contractorReplyText.trim(), parsedPct);
      setContractorReplyText("");
      setRevisedPctInput("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-100 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
              Field Evidence Review
            </span>
            <EvidenceRatingBadge rating={lineItem.aiEvidenceRating} />
          </div>
          <h3 className="text-sm font-bold text-slate-900 mt-1">
            WBS {lineItem.boqItem.wbsCode} — {lineItem.boqItem.description}
          </h3>
          {primaryLog && (
            <p className="text-xs text-slate-500 mt-0.5">
              {primaryLog.chainageLabel || "Geotagged Capture"} ·{" "}
              {formatIndependenceTierText(primaryLog.independenceTier)} (
              {primaryLog.fieldSession?.agentFullName || "Field Reporter"})
            </p>
          )}
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

      {/* Scrollable Evidence Body */}
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {/* Claim vs. Monitor Summary Strip */}
        <div className="grid grid-cols-2 gap-2.5 bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs">
          <div>
            <div className="text-slate-400 text-[11px]">Contractor Claim</div>
            <div className="font-bold text-slate-900 mt-0.5">
              {lineItem.contractorClaimedPct}% (
              {formatNaira(lineItem.contractorClaimedNgn)})
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-[11px]">Monitor Valuation</div>
            <div className="font-bold text-brand-primary mt-0.5">
              {lineItem.monitorCertifiedPct ?? 0}% (
              {formatNaira(lineItem.monitorCertifiedNgn ?? 0)})
            </div>
          </div>
        </div>

        {/* 1. Dark Navy Voice Note Player Card */}
        {primaryLog && (
          <div className="bg-brand-navy text-white rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-200">
                Site Voice Note (Pidgin / English ASR)
              </span>
              <span className="text-[11px] text-blue-200">
                0:{String(progressStep * 2).padStart(2, "0")} / 0:44
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPlaying((prev) => !prev)}
                title={isPlaying ? "Pause voice note" : "Play voice note"}
                className="w-9 h-9 rounded-full bg-brand-primary hover:bg-brand-hover text-white flex items-center justify-center shrink-0 transition shadow"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4 ml-0.5" />
                )}
              </button>
              <div className="flex-1 flex items-center gap-1 h-8">
                {WAVEFORM_HEIGHTS.map((h, idx) => (
                  <div
                    key={idx}
                    style={{ height: `${h * 3.5}px` }}
                    className={`w-1 rounded-full transition-colors ${
                      idx < progressStep ? "bg-brand-sky" : "bg-white/25"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 2. Standalone Whisper ASR Transcript */}
        {primaryLog?.rawWhisperTranscript && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Whisper ASR Raw Transcript
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs text-slate-600 italic leading-relaxed">
              &ldquo;{primaryLog.rawWhisperTranscript}&rdquo;
            </div>
          </div>
        )}

        {/* 3. Confirmed Summary & Structured Quantities (Azure OpenAI gpt-4.1) */}
        {primaryLog && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Confirmed Field Summary
              </span>
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Human-Confirmed
              </span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
              <p className="text-xs text-slate-800 leading-relaxed font-medium">
                {primaryLog.confirmedSummary || primaryLog.rawTextNote}
              </p>

              {primaryLog.confirmedQuantities &&
                primaryLog.confirmedQuantities.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                    {primaryLog.confirmedQuantities.map((qty, idx) => (
                      <div key={idx} className="bg-slate-50 rounded-lg p-2">
                        <div className="text-[10px] text-slate-400">
                          {qty.materialOrWork}
                        </div>
                        <div className="text-xs font-bold text-slate-900">
                          {qty.quantity.toLocaleString()} {qty.unit}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        )}

        {/* 4. AI Reconciliation Rationale & Hold-Point Blocker */}
        {(lineItem.aiRationale ||
          lineItem.missingHoldPointFlag ||
          (primaryLog?.siteBlockers && primaryLog.siteBlockers.length > 0)) && (
          <div
            className={`rounded-xl p-3 border ${
              lineItem.aiEvidenceRating === "CONTRADICTED" ||
              lineItem.missingHoldPointFlag
                ? "bg-red-50 border-red-200"
                : lineItem.aiEvidenceRating === "PARTIALLY_SUPPORTED" ||
                    lineItem.aiEvidenceRating === "UNSUPPORTED"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-emerald-50/70 border-emerald-200"
            }`}
          >
            <div
              className={`text-[11px] font-bold uppercase tracking-wider ${
                lineItem.aiEvidenceRating === "CONTRADICTED" ||
                lineItem.missingHoldPointFlag
                  ? "text-red-800"
                  : lineItem.aiEvidenceRating === "PARTIALLY_SUPPORTED" ||
                      lineItem.aiEvidenceRating === "UNSUPPORTED"
                    ? "text-amber-800"
                    : "text-emerald-800"
              }`}
            >
              {lineItem.missingHoldPointFlag
                ? "Mandatory Hold-Point Unfulfilled"
                : "Reconciliation Assessment"}
            </div>
            {lineItem.aiRationale && (
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  lineItem.aiEvidenceRating === "CONTRADICTED" ||
                  lineItem.missingHoldPointFlag
                    ? "text-red-700"
                    : lineItem.aiEvidenceRating === "PARTIALLY_SUPPORTED" ||
                        lineItem.aiEvidenceRating === "UNSUPPORTED"
                      ? "text-amber-800"
                      : "text-emerald-800"
                }`}
              >
                {lineItem.aiRationale}
              </p>
            )}
            {primaryLog?.siteBlockers && primaryLog.siteBlockers.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-red-700 font-medium list-disc list-inside">
                {primaryLog.siteBlockers.map((blocker, i) => (
                  <li key={i}>{blocker}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 5. Open / Responded Monitor Queries */}
        {lineItem.queries.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Dispute &amp; Query Thread ({lineItem.queries.length})
            </div>
            {lineItem.queries.map((q) => (
              <div
                key={q.id}
                className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">
                    Monitor Query
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      q.status === "OPEN"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {q.status}
                  </span>
                </div>
                <p className="text-slate-600">{q.queryReason}</p>
                {q.contractorResponseText && (
                  <div className="pt-2 mt-2 border-t border-slate-200/80">
                    <div className="font-semibold text-brand-primary">
                      Contractor Response:
                    </div>
                    <p className="text-slate-700 mt-0.5">
                      {q.contractorResponseText}
                    </p>
                  </div>
                )}

                {/* Contractor Reply Form if Query is OPEN */}
                {q.status === "OPEN" && user?.role === "CONTRACTOR" && (
                  <form
                    onSubmit={(e) => handleRespondToQuery(e, q.id)}
                    className="pt-2 mt-2 border-t border-slate-200 space-y-2"
                  >
                    <textarea
                      rows={2}
                      required
                      value={contractorReplyText}
                      onChange={(e) => setContractorReplyText(e.target.value)}
                      placeholder="Provide field clarification or corrective action..."
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-primary"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={revisedPctInput}
                        onChange={(e) => setRevisedPctInput(e.target.value)}
                        placeholder="Revised Claim % (optional)"
                        className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-primary"
                      />
                      <button
                        type="submit"
                        disabled={submitting}
                        className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover transition disabled:opacity-50"
                      >
                        {submitting ? "Sending..." : "Submit Reply"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Monitor Raise Query Form */}
        {showQueryInput && user?.role === "MONITOR" && (
          <form
            onSubmit={handleCreateQuery}
            className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2"
          >
            <div className="text-xs font-semibold text-slate-800">
              Issue Formal Line-Item Query to Contractor
            </div>
            <textarea
              rows={3}
              required
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Specify missing Hold-Point evidence or quantity discrepancy..."
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-primary"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQueryInput(false)}
                className="px-2.5 py-1 rounded-lg text-xs text-slate-600 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-3 py-1 rounded-lg bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50"
              >
                {submitting ? "Issuing..." : "Send Query"}
              </button>
            </div>
          </form>
        )}

        {/* 6. Cryptographic Telemetry Footer */}
        {primaryLog && (
          <div className="pt-2 border-t border-slate-100 space-y-1 text-[11px] text-slate-500">
            <div className="flex justify-between">
              <span>Geofence Offset</span>
              <span className="text-slate-700 font-medium">
                {primaryLog.corridorOffsetMeters !== null
                  ? `${primaryLog.corridorOffsetMeters.toFixed(1)}m from centerline`
                  : "Inside site radius"}{" "}
                (±{primaryLog.gpsAccuracyMeters.toFixed(1)}m GPS)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Captured Timestamp</span>
              <span className="text-slate-700 font-medium">
                {formatDateTimeShort(primaryLog.capturedAtDevice)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Device Signature Hash</span>
              <span className="text-slate-700 font-medium">
                {primaryLog.deviceSignatureHash.slice(0, 12)}...
                {primaryLog.deviceSignatureHash.slice(-6)} (Verified)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Drawer Actions */}
      <div className="p-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between gap-2">
        {user?.role === "MONITOR" && !openQuery && (
          <button
            type="button"
            onClick={() => setShowQueryInput(true)}
            className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Issue Formal Query
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2 px-3 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover transition shadow-sm"
        >
          Done Reviewing
        </button>
      </div>
    </Drawer>
  );
}
