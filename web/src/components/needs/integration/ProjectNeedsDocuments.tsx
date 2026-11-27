import React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Lock } from "lucide-react";
import type { ProjectNeedsDocument } from "@insite/shared";
import { formatDateShort } from "../../../lib/formatters";
import { getProjectNeedsFileLink } from "../../../api/needsIntegration";
import { useProjectNeedsOriginQuery } from "../../../queries/needs/useIntegrationQueries";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import { formatBytes } from "../needsUi";

/**
 * Needs pipeline wave 4 (C5, wave 4 section 0 item 3: read-through): the project's Documents page
 * shows the documents of the proposed project it came from and of its cycle under "Needs assessment":
 * the needs assessment versions, the proposal's documents and the cycle documents that cover it
 * (validated list, cost estimate, portfolio, approval memo …). Read-only: they stay on the proposal.
 */

const SCOPE_LABELS: Record<ProjectNeedsDocument["scope"], string> = {
  VERSION: "Needs assessment versions",
  PROPOSAL: "Proposed project documents",
  CYCLE: "Cycle documents",
};
const SCOPE_ORDER: ProjectNeedsDocument["scope"][] = ["VERSION", "PROPOSAL", "CYCLE"];

export function ProjectNeedsDocuments({ projectId }: { projectId: string }) {
  const query = useProjectNeedsOriginQuery(projectId);
  const openFile = useOpenNeedsFileMutation();
  const data = query.data;
  if (!data || data.documents.length === 0) return null;
  const proposal = data.proposal;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="needs-docs-heading">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 id="needs-docs-heading" className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            Needs assessment <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span className="sr-only">(read-only)</span>
          </h3>
          <p className="text-[11px] text-slate-500">
            From the proposed project
            {proposal ? (
              proposal.canOpenProposal ? (
                <>
                  {" "}
                  <Link to={`/app/needs-assessment/proposals/${proposal.id}`} className="font-semibold text-brand-primary hover:underline">
                    {proposal.reference}
                  </Link>
                </>
              ) : (
                ` ${proposal.reference}`
              )
            ) : null}{" "}
            and its cycle. Read-only here.
          </p>
        </div>
      </header>
      <div className="divide-y divide-slate-100">
        {SCOPE_ORDER.map((scope) => {
          const docs = data.documents.filter((d) => d.scope === scope);
          if (docs.length === 0) return null;
          return (
            <div key={scope} className="px-4 py-3">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{SCOPE_LABELS[scope]}</h4>
              <ul className="mt-1 space-y-1.5">
                {docs.map((d) => (
                  <li key={`${d.scope}-${d.id}`} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-900">{d.title}</span>
                      <span className="text-slate-600"> · {d.kindLabel}</span>
                      <span className="block text-[11px] text-slate-500">
                        {d.fileName} · {formatBytes(d.byteSize)} · {d.uploadedByName}, {formatDateShort(d.uploadedAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline disabled:opacity-50"
                      disabled={openFile.isPending}
                      onClick={() => openFile.mutate(() => getProjectNeedsFileLink(projectId, d))}
                      aria-label={`Open ${d.title}`}
                    >
                      Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
