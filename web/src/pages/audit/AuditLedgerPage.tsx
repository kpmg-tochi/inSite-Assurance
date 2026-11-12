import React from "react";
import type { ProjectSummaryDto } from "../../api/types";
import { formatDateTimeShort } from "../../lib/formatters";
import { useProjectAuditTrailQuery } from "../../queries/audit/useAuditQueries";

interface AuditLedgerPageProps {
  project: ProjectSummaryDto;
}

export function AuditLedgerPage({ project }: AuditLedgerPageProps) {
  const { data: auditData, isLoading } = useProjectAuditTrailQuery(project.id);

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-xs text-slate-500">
        Verifying audit chain...
      </div>
    );
  }

  const entries = auditData?.entries || [];
  const isVerified = auditData?.chainIntegrityVerified ?? true;

  return (
    <div className="space-y-3">
      {/* Top Cryptographic Chain Integrity Banner */}
      <div className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
            Audit Ledger
          </div>
          {/* <p className="text-xs text-slate-500 mt-0.5">
            Every baseline upload, field evidence confirmation, IPC drawdown,
            Monitor certification, and Lender tranche release is
            cryptographically chained to prevent retroactive alteration.
          </p> */}
        </div>
      </div>

      {/* Ledger Entries Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-brand-navy text-white flex items-center justify-between">
          <h3 className="text-sm font-bold">
            Immutable Governance Events ({entries.length})
          </h3>
          <span className="text-xs text-blue-200/80">
            {project.codePrefix} — {project.name}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                <th
                  className="py-3 px-4"
                  title="Server UTC/WAT timestamp when this event was sealed into the ledger"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Timestamp
                  </span>
                </th>
                <th
                  className="py-3 px-4"
                  title="Authenticated Web Portal User, Mobile Field Reporter, or AI Reconciliation Engine that triggered the event"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Actor &amp; Role
                  </span>
                </th>
                <th
                  className="py-3 px-4"
                  title="Standardized governance event classification"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Action
                  </span>
                </th>
                <th
                  className="py-3 px-4"
                  title="Human-readable audit description of the transaction"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Governance Summary
                  </span>
                </th>
                {/* <th
                  className="py-3 px-4 text-right"
                  title="Cryptographic SHA-256 linkage from the preceding ledger entry hash to this entry's computed hash"
                >
                  <span className="underline decoration-dotted decoration-slate-300 underline-offset-4 cursor-help">
                    Previous Hash &rarr; Entry Hash
                  </span>
                </th> */}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 text-xs">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/80 transition">
                  <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap align-top">
                    {formatDateTimeShort(entry.createdAt)}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap align-top">
                    <div className="font-semibold text-slate-900">
                      {entry.actorDisplayName}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {entry.actorType}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap align-top">
                    <span className="text-[11px] font-semibold text-brand-primary bg-blue-50 px-2 py-0.5 rounded">
                      {entry.action}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 max-w-md align-top">
                    {entry.summaryText}
                  </td>
                  {/* <td className="py-3.5 px-4 text-right text-[11px] text-slate-500 whitespace-nowrap align-top">
                    <span className="text-slate-400">
                      {entry.previousHash.slice(0, 8)}...
                    </span>{' '}
                    &rarr;{' '}
                    <span className="font-semibold text-slate-800">
                      {entry.entryHash.slice(0, 10)}...
                    </span>
                  </td> */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
