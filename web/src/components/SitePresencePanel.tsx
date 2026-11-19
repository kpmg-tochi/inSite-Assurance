import React, { useEffect, useMemo, useState } from "react";
import type { SiteTelemetryPingDto } from "@insite/shared";
import {
  MapPin,
  Clock,
  ShieldAlert,
  CheckCircle2,
  X,
  MessageSquarePlus,
  Sparkles,
  FileWarning,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import type { WorkdayReportRecordDto } from "../api/telemetry/telemetryApi";
import {
  useProjectTelemetryQuery,
  useProjectWorkdayReportsQuery,
} from "../queries/telemetry/useTelemetryQueries";
import { useCreateWorkdayReportQueryMutation, useResolveReportQueryMutation } from "../mutations/telemetry/useTelemetryMutations";
import { useAuth } from "../lib/auth-context";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableColumnDef,
} from "./table";
import Drawer from "./Drawer";
import Loader from "./Loader";
import { formatDateTimeShort } from "../lib/formatters";
import { CaptureAudio, CapturePhoto } from "./evidence/CaptureMedia";

interface SitePresencePanelProps {
  projectId: string;
  initialReportId?: string | null;
  initialWbsItemId?: string | null;
}

const REPORT_FLAG_LABELS: Record<string, string> = {
  LOW_GPS_ACCURACY: "Low GPS accuracy",
  GPS_ACCURACY_UNKNOWN: "GPS accuracy unknown",
  OUTSIDE_PROJECT_GEOFENCE: "Outside geofence",
  GEOFENCE_UNAVAILABLE: "Geofence not evaluated",
  MOCK_GPS_LOCATION_DETECTED: "Mock location",
  SIGNATURE_INVALID: "Device signature invalid",
  UNSIGNED: "Not signed by device",
  NO_DEVICE_KEY: "No device key registered",
};

/** D-4.3: presence is recorded while the app is open, plus one ping per capture and report. */
function pingSourceLabel(source: string): string {
  switch (source) {
    case "REPORT_SUBMISSION":
      return "Report submitted";
    case "CAPTURE":
      return "Capture";
    case "MANUAL_CHECKIN":
      return "Check-in";
    default:
      return "App open";
  }
}

function getGeotagBadge(
  geotag: {
    isMocked?: boolean;
    isWithinGeofence?: boolean | null;
  } | null,
): { label: string; variant: "success" | "warning" | "danger" | "neutral" } {
  if (!geotag) {
    return { label: "No GPS", variant: "neutral" };
  }
  if (geotag.isMocked) {
    return { label: "Mock GPS", variant: "danger" };
  }
  if (geotag.isWithinGeofence === true) {
    return { label: "On-Site", variant: "success" };
  }
  if (geotag.isWithinGeofence === false) {
    return { label: "Off-Site", variant: "danger" };
  }
  return { label: "Geofence not evaluated", variant: "warning" };
}

export function SitePresencePanel({
  projectId,
  initialReportId,
  initialWbsItemId,
}: SitePresencePanelProps) {
  const { hasPermission } = useAuth();
  const reportsQuery = useProjectWorkdayReportsQuery(projectId);
  const telemetryQuery = useProjectTelemetryQuery(projectId);
  const createQueryMutation = useCreateWorkdayReportQueryMutation(projectId);
  const resolveQueryMutation = useResolveReportQueryMutation(projectId);

  const [reportSearch, setReportSearch] = useState("");
  const [pingSearch, setPingSearch] = useState("");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [showQueryForm, setShowQueryForm] = useState(false);
  const [queryText, setQueryText] = useState("");

  const reports = useMemo(() => reportsQuery.data || [], [reportsQuery.data]);
  const pings = useMemo(() => telemetryQuery.data || [], [telemetryQuery.data]);

  // Auto-open drawer when deep-linked from a Monitor Web Notification
  useEffect(() => {
    if (reports.length === 0) return;
    if (initialReportId) {
      const target = reports.find((r) => r.id === initialReportId);
      if (target) {
        setSelectedReportId(target.id);
        return;
      }
    }
    if (initialWbsItemId) {
      const target = reports.find((r) => r.wbsItemId === initialWbsItemId);
      if (target) {
        setSelectedReportId(target.id);
      }
    }
  }, [reports, initialReportId, initialWbsItemId]);

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) || null,
    [reports, selectedReportId],
  );

  // Reset bottom query composer when switching reports
  useEffect(() => {
    setShowQueryForm(false);
    setQueryText("");
  }, [selectedReportId]);

  // Group reports by (wbsItemId, workdayDate) so the table displays the latest submission cleanly
  const groupedLatestReports = useMemo(() => {
    const map = new Map<string, WorkdayReportRecordDto>();
    for (const r of reports) {
      const key = `${r.wbsItemId}::${r.workdayDate}`;
      const existing = map.get(key);
      if (!existing || r.revisionNumber > existing.revisionNumber) {
        map.set(key, r);
      }
    }
    return Array.from(map.values());
  }, [reports]);

  // Timeline revisions for the currently inspected WBS item + workdayDate
  const selectedThreadRevisions = useMemo(() => {
    if (!selectedReport) return [];
    return reports
      .filter(
        (r) =>
          r.wbsItemId === selectedReport.wbsItemId &&
          r.workdayDate === selectedReport.workdayDate,
      )
      .sort((a, b) => a.revisionNumber - b.revisionNumber);
  }, [reports, selectedReport]);

  const filteredReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    if (!q) return groupedLatestReports;
    return groupedLatestReports.filter(
      (r) =>
        r.wbsCode.toLowerCase().includes(q) ||
        r.reporterName.toLowerCase().includes(q) ||
        r.summaryText.toLowerCase().includes(q) ||
        r.workdayDate.includes(q),
    );
  }, [groupedLatestReports, reportSearch]);

  const filteredPings = useMemo(() => {
    const q = pingSearch.trim().toLowerCase();
    if (!q) return pings;
    return pings.filter(
      (p) =>
        p.agentName.toLowerCase().includes(q) ||
        p.pingSource.toLowerCase().includes(q) ||
        (p.chainageLabel || "").toLowerCase().includes(q),
    );
  }, [pings, pingSearch]);

  const handleSubmitQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReport || queryText.trim().length < 5) return;
    try {
      await createQueryMutation.mutateAsync({
        reportId: selectedReport.id,
        queryText: queryText.trim(),
      });
      toast.success(`Query dispatched to WBS ${selectedReport.wbsCode} mobile chat.`);
      setQueryText("");
      setShowQueryForm(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to dispatch query.");
    }
  };

  const reportColumns: TableColumnDef<WorkdayReportRecordDto>[] = [
    {
      id: "workdayDate",
      header: "Date",
      tooltip: "Workday date (WAT) for the signed daily report",
      width: "w-28",
      cell: (r) => (
        <span className="text-xs font-mono text-slate-700 whitespace-nowrap">
          {r.workdayDate}
        </span>
      ),
    },
    {
      id: "wbs",
      header: "WBS Item",
      tooltip: "BOQ / WBS item covered by this daily report",
      width: "w-36",
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-brand-navy whitespace-nowrap">
            WBS {r.wbsCode}
          </span>
          {r.revisionNumber > 1 && (
            <TableBadge variant="info">Rev #{r.revisionNumber}</TableBadge>
          )}
        </div>
      ),
    },
    {
      id: "reporter",
      header: "Field Reporter",
      tooltip: "Contractor engineer or inspector who signed the report",
      width: "w-44",
      cell: (r) => (
        <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
          {r.reporterName}
        </span>
      ),
    },
    {
      id: "quantity",
      header: "Reported Qty",
      tooltip: "Quantity claimed at End-of-Day wrap-up",
      width: "w-32",
      cell: (r) => (
        <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
          {r.reportedQuantity} {r.unitOfMeasure}
        </span>
      ),
    },
    {
      id: "status",
      header: "Query / GPS",
      tooltip:
        "Open query/omission status alongside submission GPS geofence check",
      width: "w-44",
      cell: (r) => {
        const badge = getGeotagBadge(r.submissionGeotag);
        const threadReports = reports.filter(
          (item) =>
            item.wbsItemId === r.wbsItemId && item.workdayDate === r.workdayDate,
        );
        const allQueries = threadReports.flatMap((tr) => tr.queries || []);
        const hasOpen = allQueries.some((q) => q.status === "OPEN");
        const hasResubmitted =
          !hasOpen && allQueries.some((q) => q.status === "RESUBMITTED");

        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <TableBadge variant={badge.variant}>{badge.label}</TableBadge>
            {hasOpen && <TableBadge variant="warning">Query Open</TableBadge>}
            {hasResubmitted && (
              <TableBadge variant="success">Resubmitted</TableBadge>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Action",
      width: "w-28",
      align: "right",
      cell: (r) => (
        <TableActionButton
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedReportId(r.id);
          }}
        >
          Inspect
        </TableActionButton>
      ),
    },
  ];

  const pingColumns: TableColumnDef<SiteTelemetryPingDto>[] = [
    {
      id: "capturedAt",
      header: "Captured (WAT)",
      tooltip: "Device timestamp when the GPS ping was recorded",
      width: "w-40",
      cell: (p) => (
        <span className="text-xs text-slate-600 whitespace-nowrap">
          {formatDateTimeShort(p.capturedAtDevice)}
        </span>
      ),
    },
    {
      id: "agentName",
      header: "Personnel",
      tooltip: "Field personnel associated with the device session",
      width: "w-44",
      cell: (p) => (
        <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
          {p.agentName}
        </span>
      ),
    },
    {
      id: "source",
      header: "Ping Type",
      tooltip: "Presence while the app is open, or the ping recorded with a capture or report",
      width: "w-40",
      cell: (p) => (
        <TableBadge
          variant={
            p.pingSource === "REPORT_SUBMISSION" ? "info" : "neutral"
          }
        >
          {pingSourceLabel(p.pingSource)}
        </TableBadge>
      ),
    },
    {
      id: "coords",
      header: "Coordinates / Chainage",
      tooltip: "Captured GPS coordinates and snapped corridor chainage",
      width: "w-52",
      cell: (p) => (
        <span className="text-xs font-mono text-slate-700 whitespace-nowrap">
          {p.chainageLabel || `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`}
        </span>
      ),
    },
    {
      id: "status",
      header: "Geofence",
      tooltip: "Server-verified site boundary check",
      width: "w-32",
      cell: (p) => {
        const badge = getGeotagBadge({
          isMocked: p.isMocked,
          isWithinGeofence: p.isWithinGeofence,
        });
        return <TableBadge variant={badge.variant}>{badge.label}</TableBadge>;
      },
    },
  ];

  const selectedReporterDayPings = useMemo(() => {
    if (!selectedReport) return [];
    return pings.filter(
      (p) =>
        p.fieldSessionId === selectedReport.reporterSessionId &&
        p.capturedAtDevice.slice(0, 10) === selectedReport.workdayDate,
    );
  }, [pings, selectedReport]);

  if (reportsQuery.isLoading || telemetryQuery.isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-10 flex flex-col items-center justify-center gap-3">
        <Loader size="sm" />
        <span className="text-xs text-slate-500 font-medium">
          Loading daily report geotags and site presence...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Daily Workday Reports & Submission Geotags */}
      <StandardTable
        title="Daily Workday Reports & Submission Geotags"
        subtitle="Verify End-of-Day geotags, review resubmitted report timelines, or raise Monitor queries to field WBS chats."
        columns={reportColumns}
        data={filteredReports}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setSelectedReportId(r.id)}
        search={{
          value: reportSearch,
          onChange: setReportSearch,
          placeholder: "Search WBS code, reporter, or date...",
        }}
        emptyState={{
          title: "No daily workday reports have been synced yet.",
        }}
      />

      {/* Presence pings */}
      <StandardTable
        title="Site Presence"
        subtitle="GPS positions recorded while the field app is open, and with each capture and report. The app does not track location in the background."
        columns={pingColumns}
        data={filteredPings}
        keyExtractor={(p) => p.id}
        search={{
          value: pingSearch,
          onChange: setPingSearch,
          placeholder: "Search personnel or chainage...",
        }}
        emptyState={{
          title: "No presence pings recorded yet.",
        }}
      />

      {/* Workday Report Summary Drawer */}
      {selectedReport && (
        <Drawer
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedReportId(null);
          }}
        >
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            {/* Drawer Header */}
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">
                  WBS {selectedReport.wbsCode} · {selectedReport.workdayDate}
                </p>
                <h3 className="text-lg font-bold text-slate-900 mt-1">
                  {selectedReport.reporterName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedReport.wbsDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReportId(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Submission Timeline Tabs (when >= 1 revision exists) */}
            {selectedThreadRevisions.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <Layers className="w-3.5 h-3.5 text-brand-primary" />
                  <span>
                    Submission Timeline ({selectedThreadRevisions.length})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {selectedThreadRevisions.map((rev) => {
                    const isActive = rev.id === selectedReport.id;
                    const hasOpenQuery = rev.queries?.some(
                      (q) => q.status === "OPEN",
                    );
                    return (
                      <button
                        key={rev.id}
                        type="button"
                        onClick={() => setSelectedReportId(rev.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 whitespace-nowrap ${
                          isActive
                            ? "bg-brand-primary text-white border-brand-primary shadow-xs"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        <span>
                          Rev #{rev.revisionNumber}{" "}
                          {rev.revisionNumber === 1 ? "· Initial" : "· Resubmitted"}
                        </span>
                        {hasOpenQuery && (
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isActive ? "bg-amber-300" : "bg-amber-500"
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Submission Geotag Provenance */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-brand-primary" />
                  Submission Geotag Provenance
                </span>
                {(() => {
                  const badge = getGeotagBadge(selectedReport.submissionGeotag);
                  return (
                    <TableBadge variant={badge.variant}>{badge.label}</TableBadge>
                  );
                })()}
              </div>
              {selectedReport.submissionGeotag ? (
                <div className="text-xs text-slate-600 space-y-1 font-mono">
                  <p>
                    Coords: {selectedReport.submissionGeotag.latitude.toFixed(5)},{" "}
                    {selectedReport.submissionGeotag.longitude.toFixed(5)}
                    {selectedReport.submissionGeotag.accuracyMeters != null
                      ? ` (±${Math.round(selectedReport.submissionGeotag.accuracyMeters)}m)`
                      : ""}
                  </p>
                  {selectedReport.submissionGeotag.chainageLabel && (
                    <p>Chainage: {selectedReport.submissionGeotag.chainageLabel}</p>
                  )}
                  <p>
                    Captured:{" "}
                    {formatDateTimeShort(selectedReport.submissionGeotag.capturedAt)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-amber-700">
                  No submission GPS coordinates were attached to this report.
                </p>
              )}
            </div>

            {/* Signed Report Summary + AI Evaluation */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-800">
                  Reporter-confirmed summary ({selectedReport.reportedQuantity}{" "}
                  {selectedReport.unitOfMeasure})
                </p>
                {selectedReport.resolvedQueryId && (
                  <TableBadge variant="success">Query Response</TableBadge>
                )}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {selectedReport.summaryText}
              </p>
              {selectedReport.delaysOrBlockers && (
                <p className="text-xs text-rose-700">
                  Blockers: {selectedReport.delaysOrBlockers}
                </p>
              )}
              <p className="text-[11px] text-slate-500">
                {selectedReport.signatureVerified === true
                  ? "Device signature checked."
                  : selectedReport.signatureVerified === false
                    ? "Device signature invalid."
                    : "Not signed by the device."}
                {selectedReport.status === "STAGED_UNVERIFIED"
                  ? " Staged: reporter identity not yet approved, not counted as evidence."
                  : ""}
              </p>
              {selectedReport.integrityFlags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedReport.integrityFlags.map((f) => (
                    <TableBadge
                      key={f}
                      variant={
                        f === "MOCK_GPS_LOCATION_DETECTED" || f === "SIGNATURE_INVALID"
                          ? "danger"
                          : "warning"
                      }
                    >
                      {REPORT_FLAG_LABELS[f] ?? f}
                    </TableBadge>
                  ))}
                </div>
              )}

              {selectedReport.aiCheckStatus === "PENDING" ||
              selectedReport.aiCheckStatus === "RUNNING" ? (
                <p className="text-[11px] text-slate-500">Omission check pending.</p>
              ) : selectedReport.aiCheckStatus === "FAILED" ? (
                <p className="text-[11px] text-amber-700">Omission check failed; it will be retried.</p>
              ) : null}

              {selectedReport.aiReasoning && (
                <div className="mt-2 pt-2.5 border-t border-slate-100 flex items-start gap-2 text-[11px] text-slate-600">
                  <Sparkles className="w-3.5 h-3.5 text-brand-primary shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-800">
                      {selectedReport.aiCheckEngine === "AZURE_OPENAI"
                        ? "AI omission check"
                        : selectedReport.aiCheckEngine === "RULES"
                          ? "Rules omission check"
                          : "Omission check"}
                      :{" "}
                    </span>
                    {selectedReport.aiReasoning}
                  </div>
                </div>
              )}
            </div>

            {/* Queries Attached to This Revision */}
            {selectedReport.queries && selectedReport.queries.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <FileWarning className="w-3.5 h-3.5 text-amber-600" />
                  Queries Raised on Rev #{selectedReport.revisionNumber} (
                  {selectedReport.queries.length})
                </h4>
                {selectedReport.queries.map((q) => (
                  <div
                    key={q.id}
                    className={`rounded-xl border p-3 text-xs space-y-1.5 ${
                      q.status === "OPEN"
                        ? "bg-amber-50/70 border-amber-200"
                        : "bg-emerald-50/60 border-emerald-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">
                        {q.source === "AI_OMISSION_CHECK"
                          ? "AI Omission Check"
                          : `Monitor Query (${q.raisedByName || "Monitor"})`}
                      </span>
                      <TableBadge
                        variant={q.status === "OPEN" ? "warning" : "success"}
                      >
                        {q.status}
                      </TableBadge>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      {q.monitorComment ||
                        q.aiOmissionPayload?.clarificationQuestion}
                    </p>
                    {q.status !== "RESOLVED" && hasPermission("reports:raise_query") && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => resolveQueryMutation.mutate({ queryId: q.id })}
                          disabled={resolveQueryMutation.isPending}
                          className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                        >
                          {q.status === "RESUBMITTED" ? "Mark resolved" : "Withdraw query"}
                        </button>
                      </div>
                    )}
                    {q.aiOmissionPayload?.omittedItems &&
                      q.aiOmissionPayload.omittedItems.length > 0 && (
                        <ul className="list-disc list-inside text-[11px] text-amber-900 space-y-0.5 pt-1">
                          {q.aiOmissionPayload.omittedItems.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      )}
                  </div>
                ))}
              </div>
            )}

            {/* Captures linked to this revision, with the server's integrity results */}
            {selectedReport.captures.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                <p className="text-xs font-bold text-slate-800">
                  Captures ({selectedReport.captures.length})
                </p>
                <div className="space-y-1.5">
                  {selectedReport.captures.map((c) => (
                    <div
                      key={c.id}
                      className="text-[11px] text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800 truncate">
                          {c.mediaType === "VOICE_NOTE"
                            ? "Voice note"
                            : c.mediaType === "SITE_PHOTO"
                              ? "Photo"
                              : "Document"}
                          {c.caption ? ` · ${c.caption}` : ""}
                        </span>
                        <span className="text-slate-400 shrink-0">
                          {formatDateTimeShort(c.capturedAt)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <TableBadge
                          variant={
                            c.isWithinGeofence === true
                              ? "success"
                              : c.isWithinGeofence === false
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {!c.locationAvailable
                            ? "Location unavailable"
                            : c.isWithinGeofence === true
                              ? "Inside geofence"
                              : c.isWithinGeofence === false
                                ? "Outside geofence"
                                : "Geofence not evaluated"}
                        </TableBadge>
                        <TableBadge
                          variant={
                            c.signatureVerified === true
                              ? "success"
                              : c.signatureVerified === false
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {c.signatureVerified === true
                            ? "Signature checked"
                            : c.signatureVerified === false
                              ? "Signature invalid"
                              : "Unsigned"}
                        </TableBadge>
                        {c.isMockLocation && <TableBadge variant="danger">Mock location</TableBadge>}
                        {!c.integrityPassed && (
                          <TableBadge variant="danger">Failed integrity: not counted</TableBadge>
                        )}
                      </div>
                      {c.integrityFlags.length > 0 && (
                        <p className="text-[10px] text-slate-500">
                          Flags: {c.integrityFlags.join(", ")}
                        </p>
                      )}
                      {c.mediaType === "SITE_PHOTO" && (
                        <CapturePhoto projectId={projectId} objectKey={c.objectKey} alt={c.caption || "Site photo"} className="w-full h-40" />
                      )}
                      {c.mediaType === "VOICE_NOTE" && (
                        <CaptureAudio projectId={projectId} objectKey={c.objectKey} />
                      )}
                      {c.mediaType === "VOICE_NOTE" && (
                        <p className="text-[10px] text-slate-500">
                          {c.transcriptionStatus === "DONE" && c.transcript
                            ? `Transcript: ${c.transcript}`
                            : c.transcriptionStatus === "FAILED"
                              ? "Transcription failed."
                              : "Not transcribed."}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedReport.textNotes.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1.5">
                <p className="text-xs font-bold text-slate-800">
                  Notes ({selectedReport.textNotes.length})
                </p>
                {selectedReport.textNotes.map((n) => (
                  <p key={n.id} className="text-[11px] text-slate-600">
                    {formatDateTimeShort(n.capturedAt)} · {n.text}
                  </p>
                ))}
              </div>
            )}

            {/* Same-day presence timeline */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Same-day presence while the app was open ({selectedReporterDayPings.length})
              </h4>
              {selectedReporterDayPings.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                  No presence pings recorded for this reporter on{" "}
                  {selectedReport.workdayDate}.
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedReporterDayPings.map((ping) => {
                    const isAlert =
                      ping.isMocked || ping.isWithinGeofence === false;
                    return (
                      <div
                        key={ping.id}
                        className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          {isAlert ? (
                            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          )}
                          <div>
                            <p className="font-semibold text-slate-800">
                              {formatDateTimeShort(ping.capturedAtDevice)} ·{" "}
                              {pingSourceLabel(ping.pingSource)}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500">
                              {ping.chainageLabel ||
                                `${ping.latitude.toFixed(4)}, ${ping.longitude.toFixed(4)}`}
                            </p>
                          </div>
                        </div>
                        <TableBadge variant={isAlert ? "danger" : "success"}>
                          {ping.isMocked
                            ? "Mock"
                            : ping.isWithinGeofence === false
                              ? "Off-Site"
                              : "On-Site"}
                        </TableBadge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sticky Bottom Action Bar + Inline Monitor Query Comment Box */}
          <div className="p-3.5 bg-slate-50 border-t border-slate-200/80 space-y-2.5">
            {showQueryForm && hasPermission("reports:raise_query") ? (
              <form onSubmit={handleSubmitQuery} className="space-y-2">
                <label className="block text-xs font-bold text-slate-800">
                  Raise Query to WBS {selectedReport.wbsCode} Mobile Chat
                </label>
                <textarea
                  rows={3}
                  required
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="Request clarifying photos, measurements, or explanation for missing evidence..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-brand-primary"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQueryForm(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      createQueryMutation.isPending || queryText.trim().length < 5
                    }
                    className="px-4 py-1.5 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover transition disabled:opacity-50"
                  >
                    {createQueryMutation.isPending ? "Sending..." : "Send Query"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-2">
                {hasPermission("reports:raise_query") && (
                  <button
                    type="button"
                    onClick={() => setShowQueryForm(true)}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition flex items-center justify-center gap-1.5"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5 text-brand-primary" />
                    <span>Raise Query</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedReportId(null)}
                  className="flex-1 py-2 px-3 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover transition shadow-sm"
                >
                  Done Reviewing
                </button>
              </div>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
