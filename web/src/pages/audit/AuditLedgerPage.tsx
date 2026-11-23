import React, { useState, useMemo, useEffect, MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { ProjectSummaryDto, AuditTrailResponseDto } from "../../api/types";
import { displayZoneLabel, formatDateTimeShort } from "../../lib/formatters";
import {
  useProjectAuditTrailQuery,
  useTenantAuditTrailQuery,
} from "../../queries/audit/useAuditQueries";
import { useAuth } from "../../lib/auth-context";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableColumnDef,
} from "../../components/table";
import Drawer from "../../components/Drawer";
import Loader from "../../components/Loader";
import { SitePresencePanel } from "../../components/SitePresencePanel";
import { ReportingCadencePanel } from "../../components/ReportingCadencePanel";
import { ShieldCheck, X, FileText, User, Calendar, Tag } from "lucide-react";

type AuditLedgerEntry = AuditTrailResponseDto["entries"][number];

interface AuditLedgerPageProps {
  project: ProjectSummaryDto;
}

export function AuditLedgerPage({ project }: AuditLedgerPageProps) {
  const { hasAnyPermission } = useAuth();
  const canSeePresence = hasAnyPermission("reports:view_all", "presence:view_telemetry");
  const [searchParams] = useSearchParams();
  const initialTab =
    searchParams.get("tab") === "presence" && canSeePresence ? "presence" : "ledger";
  const initialReportId = searchParams.get("reportId");
  const initialWbsItemId = searchParams.get("wbsItemId");
  const [activeTab, setActiveTab] = useState<"ledger" | "tenant" | "presence">(initialTab);

  useEffect(() => {
    if (searchParams.get("tab") === "presence" && canSeePresence) {
      setActiveTab("presence");
    }
  }, [searchParams, canSeePresence]);

  const projectLedger = useProjectAuditTrailQuery(project.id, activeTab === "ledger");
  const tenantLedger = useTenantAuditTrailQuery(activeTab === "tenant");
  const { data: auditData, isLoading } = activeTab === "tenant" ? tenantLedger : projectLedger;
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "ALL" | "WEB_USER" | "FIELD_AGENT" | "SYSTEM"
  >("ALL");
  const [selectedEntry, setSelectedEntry] = useState<AuditLedgerEntry | null>(
    null
  );

  const entries = useMemo(() => auditData?.entries || [], [auditData]);
  // Not verified until the server has recomputed the chain and said so.
  const isVerified = auditData?.chainIntegrityVerified === true;
  const brokenEntry = auditData?.brokenAtEntryId
    ? entries.find((e) => e.id === auditData.brokenAtEntryId) ?? null
    : null;

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        entry.actorDisplayName.toLowerCase().includes(term) ||
        entry.action.toLowerCase().includes(term) ||
        entry.summaryText.toLowerCase().includes(term) ||
        entry.actorType.toLowerCase().includes(term);

      const upperActor = entry.actorType.toUpperCase();
      const matchesRole =
        roleFilter === "ALL" ||
        (roleFilter === "WEB_USER" &&
          (upperActor.includes("WEB_USER") ||
            upperActor.includes("MONITOR") ||
            upperActor.includes("LENDER") ||
            upperActor.includes("CONTRACTOR"))) ||
        (roleFilter === "FIELD_AGENT" && upperActor.includes("FIELD_AGENT")) ||
        (roleFilter === "SYSTEM" &&
          (upperActor.includes("SYSTEM") || upperActor.includes("RULES")));

      return matchesSearch && matchesRole;
    });
  }, [entries, searchTerm, roleFilter]);

  const columns: TableColumnDef<AuditLedgerEntry>[] = [
    {
      id: "createdAt",
      header: "Timestamp",
      tooltip:
        `Server timestamp (${displayZoneLabel()}) when this event was sealed into the immutable ledger`,
      width: "w-40",
      cell: (entry) => (
        <span className="text-slate-600 whitespace-nowrap text-xs">
          {formatDateTimeShort(entry.createdAt)}
        </span>
      ),
    },
    {
      id: "actor",
      header: "Actor & Role",
      tooltip:
        "Authenticated portal user, mobile field reporter, or system process that committed the event",
      width: "w-56",
        cell: (entry) => {
        const upperActor = entry.actorType.toUpperCase();
        let badgeVariant: "info" | "warning" | "success" | "neutral" = "neutral";
        if (upperActor.includes("WEB_USER") || upperActor.includes("MONITOR")) {
          badgeVariant = "info";
        } else if (
          upperActor.includes("FIELD_AGENT") ||
          upperActor.includes("CONTRACTOR")
        ) {
          badgeVariant = "warning";
        } else if (upperActor.includes("LENDER")) {
          badgeVariant = "success";
        }

        return (
          <div className="space-y-1">
            <div className="font-semibold text-slate-900 truncate max-w-[200px]">
              {entry.actorDisplayName}
            </div>
            <div>
              <TableBadge variant={badgeVariant}>
                {entry.actorType.replace(/_/g, " ")}
              </TableBadge>
            </div>
          </div>
        );
      },
    },
    {
      id: "action",
      header: "Action",
      tooltip: "Standardized governance event classification",
      width: "w-48",
      cell: (entry) => {
        let variant: "success" | "danger" | "warning" | "info" = "info";
        const act = entry.action.toUpperCase();
        if (act.includes("APPROVED") || act.includes("DISBURSED") || act.includes("CONFIRMED")) {
          variant = "success";
        } else if (act.includes("REJECT") || act.includes("CONFLICT") || act.includes("FLAG")) {
          variant = "danger";
        } else if (act.includes("CLAIM") || act.includes("SUBMIT") || act.includes("QUERY")) {
          variant = "warning";
        }

        return (
          <TableBadge variant={variant}>
            {entry.action.replace(/_/g, " ")}
          </TableBadge>
        );
      },
    },
    {
      id: "summaryText",
      header: "Governance Summary",
      tooltip: "Human-readable audit description of the transaction",
      cell: (entry) => (
        <div className="text-slate-700 max-w-md line-clamp-2 text-xs">
          {entry.summaryText}
        </div>
      ),
    },
    {
      id: "actions",
      header: "Details",
      tooltip: "Inspect full event payload and metadata in drawer",
      align: "right",
      width: "w-24",
      cell: (entry) => (
        <TableActionButton
          onClick={() => setSelectedEntry(entry)}
          variant="default"
        >
          Details
        </TableActionButton>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-navigation Tabs */}
      <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/80">
        <button
          type="button"
          onClick={() => setActiveTab("ledger")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "ledger"
              ? "bg-white text-slate-900 shadow-2xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Project Audit Ledger
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("tenant")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "tenant"
              ? "bg-white text-slate-900 shadow-2xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Tenant Governance Ledger
        </button>
        {canSeePresence && (
        <button
          type="button"
          onClick={() => setActiveTab("presence")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "presence"
              ? "bg-white text-slate-900 shadow-2xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Daily Reports &amp; Site Telemetry
        </button>
        )}
      </div>

      {activeTab === "presence" ? (
        <div className="space-y-5">
          <ReportingCadencePanel projectId={project.id} />
          <SitePresencePanel
            projectId={project.id}
            initialReportId={initialReportId}
            initialWbsItemId={initialWbsItemId}
          />
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 flex flex-col items-center justify-center gap-3">
          <Loader size="sm" />
          <span className="text-xs text-slate-500 font-medium">
            Verifying immutable audit chain...
          </span>
        </div>
      ) : (
        <>
          {/* Top Header Bar */}
          <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Compliance &amp; Verification Trail
          </div>
          <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
            Forensic Audit Ledger
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!auditData ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600">
              <span>Not verified</span>
            </div>
          ) : isVerified ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Chain Integrity Verified</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
              <span>
                Chain broken
                {brokenEntry
                  ? ` at entry #${brokenEntry.seq} (${formatDateTimeShort(brokenEntry.createdAt)})`
                  : auditData.brokenAtEntryId
                    ? ` at entry ${auditData.brokenAtEntryId}`
                    : ""}
                . Entries from that point cannot be trusted.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Standardized Audit Ledger Table */}
      <StandardTable<AuditLedgerEntry>
        title={
          <div className="flex items-center gap-2.5">
            <span>Immutable Governance Events</span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-white/90 border border-white/15">
              {entries.length} Certified Events
            </span>
          </div>
        }
        subtitle={
          activeTab === "tenant"
            ? "Roles, users, branding and sign-in lockouts across the tenant"
            : `${project.codePrefix}: ${project.name}`
        }
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Search actor, action, or governance summary...",
        }}
        filters={
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setRoleFilter("ALL")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                roleFilter === "ALL"
                  ? "bg-brand-navy text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              All ({entries.length})
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter("WEB_USER")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                roleFilter === "WEB_USER"
                  ? "bg-brand-primary text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              Portal Users
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter("FIELD_AGENT")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                roleFilter === "FIELD_AGENT"
                  ? "bg-amber-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              Field Agents
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter("SYSTEM")}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                roleFilter === "SYSTEM"
                  ? "bg-slate-700 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              System
            </button>
          </div>
        }
        columns={columns}
        data={filteredEntries}
        keyExtractor={(item) => item.id}
        selectedId={selectedEntry?.id}
        onRowClick={(item) => setSelectedEntry(item)}
        emptyState={{
          title: "No audit events found",
          description:
            "No ledger records match your current search or role filter criteria.",
        }}
      />
        </>
      )}

      {/* Slide-over Drawer for Event Details */}
      {selectedEntry && (
        <Drawer
          onClick={(e: MouseEvent<HTMLDivElement>) => {
            if (e.target === e.currentTarget) setSelectedEntry(null);
          }}
        >
          {/* Drawer Header */}
          <div className="p-4 border-b border-slate-100 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <TableBadge variant="info">
                  {selectedEntry.action.replace(/_/g, " ")}
                </TableBadge>
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-1">
                Audit Event Record
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Timestamp: {formatDateTimeShort(selectedEntry.createdAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEntry(null)}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
            {/* Actor Card */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                <span>Committed By</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">
                    {selectedEntry.actorDisplayName}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    ID: {selectedEntry.actorId}
                  </div>
                </div>
                <TableBadge variant="neutral">
                  {selectedEntry.actorType.replace(/_/g, " ")}
                </TableBadge>
              </div>
            </div>

            {/* Summary Text */}
            <div className="rounded-xl border border-slate-200/80 p-3 space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>Governance Summary</span>
              </div>
              <p className="text-xs text-slate-800 leading-relaxed">
                {selectedEntry.summaryText}
              </p>
            </div>

            {/* Event Payload */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                <span>Transaction Metadata</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 text-slate-100 overflow-x-auto text-[11px] leading-relaxed">
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedEntry.payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>

          {/* Drawer Footer */}
          <div className="p-4 border-t border-slate-100 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setSelectedEntry(null)}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 transition"
            >
              Close
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
