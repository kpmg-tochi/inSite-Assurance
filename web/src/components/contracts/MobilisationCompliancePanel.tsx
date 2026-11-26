import React from "react";
import { Link } from "react-router-dom";
import { Truck } from "lucide-react";
import type { MobilisationComplianceRow } from "@insite/shared";
import Loader from "../Loader";
import { formatDateTimeShort } from "../../lib/formatters";
import { useMobilisationComplianceQuery } from "../../queries/contracts/useContractQueries";
import { DaysLeft, MILESTONE_STATUS_META, sectionClass, StatusChip } from "./contractUi";

/**
 * Phase 13: per contractor, the mobilisation deadline (kick-off + N days), whether it has checked in
 * on site, documents still missing before mobilisation, and any open default case.
 */
export function MobilisationCompliancePanel({ projectId, bare = false }: { projectId: string; bare?: boolean }) {
  const q = useMobilisationComplianceQuery(projectId);
  const rows = q.data ?? [];

  const body = q.isLoading ? (
    <Loader />
  ) : q.isError ? (
    <p className="text-xs text-slate-500">Mobilisation compliance could not be loaded.</p>
  ) : rows.length === 0 ? (
    <p className="text-xs text-slate-500">No contractors on this project yet.</p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
            <th className="py-2 pr-3 font-semibold">Contractor</th>
            <th className="py-2 pr-3 font-semibold">Mobilisation deadline</th>
            <th className="py-2 pr-3 font-semibold">Mobilised to site</th>
            <th className="py-2 pr-3 font-semibold">Documents missing</th>
            <th className="py-2 font-semibold">Default case</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <Row key={r.projectContractorId} projectId={projectId} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );

  if (bare) return body;
  return (
    <section className={sectionClass} aria-label="Mobilisation compliance">
      <div>
        <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <Truck className="w-4 h-4 text-brand-primary" /> Contractor mobilisation
        </h2>
        <p className="text-[11px] text-slate-500">A contractor counts as mobilised once an officer marks the "Mobilised to site" milestone complete.</p>
      </div>
      {body}
    </section>
  );
}

function Row({ projectId, r }: { projectId: string; r: MobilisationComplianceRow }) {
  const terminated = r.contractStatus === "TERMINATED";
  const m = r.milestone;
  return (
    <tr className={terminated ? "text-slate-400" : ""}>
      <td className="py-2.5 pr-3 align-top">
        <p className={`font-semibold ${terminated ? "text-slate-500" : "text-slate-900"}`}>
          {r.organizationName} <span className="font-normal text-slate-500">({r.tradeCode})</span>
        </p>
        {terminated && <StatusChip label="Terminated" cls="bg-rose-50 text-rose-700 border-rose-200" />}
      </td>
      <td className="py-2.5 pr-3 align-top">
        {m ? (
          <div className="space-y-0.5">
            <p className="text-slate-700">{m.dueDate ?? "No date yet (kick-off not set)"}</p>
            <div className="flex items-center gap-2">
              <StatusChip label={MILESTONE_STATUS_META[m.status].label} cls={MILESTONE_STATUS_META[m.status].cls} />
              {m.status !== "DONE" && m.status !== "WAIVED" && <DaysLeft daysLeft={m.daysLeft} />}
            </div>
          </div>
        ) : (
          <span className="text-slate-400">No mobilisation milestone</span>
        )}
      </td>
      <td className="py-2.5 pr-3 align-top">
        {r.onSite ? (
          <span className="text-emerald-700 font-semibold">
            Mobilised{m?.completedAt ? <span className="block font-normal text-[11px] text-slate-500">Confirmed {formatDateTimeShort(m.completedAt)}</span> : null}
          </span>
        ) : (
          <span className="text-slate-500">Not yet</span>
        )}
      </td>
      <td className="py-2.5 pr-3 align-top">
        {r.missingDocuments.length === 0 ? (
          <span className="text-slate-500">None</span>
        ) : (
          <ul className="space-y-0.5">
            {r.missingDocuments.map((d) => (
              <li key={d.code}>
                <Link to={`/app/projects/${projectId}/documents?type=${encodeURIComponent(d.code)}`} className="text-amber-800 hover:underline">
                  {d.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="py-2.5 align-top">
        {r.openDefaultCaseId ? (
          <Link to={`/app/projects/${projectId}/kickoff?tab=milestones&case=${r.openDefaultCaseId}`} className="font-semibold text-rose-700 hover:underline">
            Open case
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
}
