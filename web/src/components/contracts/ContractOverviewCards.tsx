import React from "react";
import { Link } from "react-router-dom";
import { Gavel } from "lucide-react";
import { useDefaultCasesQuery } from "../../queries/contracts/useContractQueries";
import { DEFAULT_CASE_STATUS_META, StatusChip } from "./contractUi";

/** Phase 13: "Open default cases" card for the project overview; renders nothing when there are none. */
export function OpenDefaultCasesCard({ projectId }: { projectId: string }) {
  const q = useDefaultCasesQuery(projectId, { openOnly: true });
  const cases = q.data ?? [];
  if (cases.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-rose-200 p-5 shadow-sm space-y-3" aria-label="Open default cases">
      <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
        <Gavel className="w-4 h-4 text-rose-600" /> Open default cases ({cases.length})
      </h2>
      <ul className="divide-y divide-slate-100">
        {cases.map((c) => {
          const s = DEFAULT_CASE_STATUS_META[c.status];
          const current = c.approval.steps.find((st) => st.state === "CURRENT");
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <Link to={`/app/projects/${projectId}/kickoff?tab=milestones&case=${c.id}`} className="min-w-0 hover:underline">
                <span className="font-semibold text-slate-900">{c.contractorName}</span>
                <span className="text-slate-500">
                  {c.milestoneLabel ? ` · ${c.milestoneLabel}` : ""}
                  {current ? ` · waiting on ${current.label}` : ""}
                </span>
              </Link>
              <StatusChip label={s.label} cls={s.cls} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
