import React, { useMemo, useState } from "react";
import type { SiteTelemetryPingDto } from "@insite/shared";
import { MapPin, Clock, ShieldAlert, CheckCircle2, X } from "lucide-react";
import type { WorkdayReportRecordDto } from "../api/telemetry/telemetryApi";
import {
  useProjectTelemetryQuery,
  useProjectWorkdayReportsQuery,
} from "../queries/telemetry/useTelemetryQueries";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableColumnDef,
} from "./table";
import Drawer from "./Drawer";
import Loader from "./Loader";
import { formatDateTimeShort } from "../lib/formatters";

interface SitePresencePanelProps {
  projectId: string;
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
  return { label: "GPS Locked", variant: "warning" };
}

export function SitePresencePanel({ projectId }: SitePresencePanelProps) {
  const reportsQuery = useProjectWorkdayReportsQuery(projectId);
  const telemetryQuery = useProjectTelemetryQuery(projectId);

  const [reportSearch, setReportSearch] = useState("");
  const [pingSearch, setPingSearch] = useState("");
  const [selectedReport, setSelectedReport] =
    useState<WorkdayReportRecordDto | null>(null);

  const reports = useMemo(() => reportsQuery.data || [], [reportsQuery.data]);
  const pings = useMemo(() => telemetryQuery.data || [], [telemetryQuery.data]);

  const filteredReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) =>
        r.wbsCode.toLowerCase().includes(q) ||
        r.reporterName.toLowerCase().includes(q) ||
        r.summaryText.toLowerCase().includes(q) ||
        r.workdayDate.includes(q),
    );
  }, [reports, reportSearch]);

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
      width: "w-32",
      cell: (r) => (
        <span className="text-xs font-bold text-brand-navy whitespace-nowrap">
          WBS {r.wbsCode}
        </span>
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
      id: "geotag",
      header: "Submission GPS",
      tooltip:
        "Server-verified geofence status at the moment the daily report was submitted",
      width: "w-36",
      cell: (r) => {
        const badge = getGeotagBadge(r.submissionGeotag);
        return <TableBadge variant={badge.variant}>{badge.label}</TableBadge>;
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
            setSelectedReport(r);
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
      tooltip: "Hourly background presence ping vs EOD report submission ping",
      width: "w-40",
      cell: (p) => (
        <TableBadge
          variant={
            p.pingSource === "REPORT_SUBMISSION" ? "info" : "neutral"
          }
        >
          {p.pingSource === "REPORT_SUBMISSION" ? "Report Submit" : "Hourly Ping"}
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
          Loading daily report geotags and hourly site telemetry...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Daily Workday Reports & Submission Geotags */}
      <StandardTable
        title="Daily Workday Reports & Submission Geotags"
        subtitle="Verify that contractors submitted End-of-Day reports from within the project geofence."
        columns={reportColumns}
        data={filteredReports}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setSelectedReport(r)}
        search={{
          value: reportSearch,
          onChange: setReportSearch,
          placeholder: "Search WBS code, reporter, or date...",
        }}
        emptyState={{
          title: "No daily workday reports have been synced yet.",
        }}
      />

      {/* Hourly Telemetry Pings */}
      <StandardTable
        title="Hourly Site Presence Telemetry"
        subtitle="Automated hourly GPS pings recorded during active workday hours to confirm continuous on-site presence."
        columns={pingColumns}
        data={filteredPings}
        keyExtractor={(p) => p.id}
        search={{
          value: pingSearch,
          onChange: setPingSearch,
          placeholder: "Search personnel or chainage...",
        }}
        emptyState={{
          title: "No hourly site telemetry pings recorded yet.",
        }}
      />

      {/* Inspection Drawer */}
      {selectedReport && (
        <Drawer
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedReport(null);
          }}
        >
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
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
                onClick={() => setSelectedReport(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

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

            {/* Signed Report Summary */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-2">
              <p className="text-xs font-bold text-slate-800">
                Signed Workday Summary ({selectedReport.reportedQuantity}{" "}
                {selectedReport.unitOfMeasure})
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {selectedReport.summaryText}
              </p>
            </div>

            {/* Same-Day Hourly Telemetry Timeline */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Same-Day Hourly Presence Timeline ({selectedReporterDayPings.length})
              </h4>
              {selectedReporterDayPings.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                  No hourly telemetry pings recorded for this reporter on{" "}
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
                              {ping.pingSource === "REPORT_SUBMISSION"
                                ? "Report Submit"
                                : "Hourly Check"}
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
        </Drawer>
      )}
    </div>
  );
}
