import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort } from "../../lib/formatters";
import Loader from "../../components/Loader";
import { MobilisationCompliancePanel } from "../../components/contracts/MobilisationCompliancePanel";
import { sectionClass } from "../../components/contracts/contractUi";
import { ConfirmationText, officersText, VisitStatusChip } from "../../components/visits/visitUi";
import { useMilestonesQuery } from "../../queries/contracts/useContractQueries";
import { useProjectVisitsQuery } from "../../queries/visits/useVisitQueries";
import { MilestoneRow } from "./MilestonesTab";

/**
 * Kick-off & mobilisation → Mobilisation (redesign R6b, D-R6.15): the contractor-on-site milestone,
 * the mobilisation check visits (R4) and contractor mobilisation compliance.
 */
export function MobilisationTab({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const [, setParams] = useSearchParams();
  const milestones = useMilestonesQuery(project.id);
  const onSite = (milestones.data?.milestones ?? []).filter((m) => m.completionMode === "AUTO_CONTRACTOR_ON_SITE");
  const canSeeVisits = hasPermission("visits:view");

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        From the kick-off to the contractor working on site: the on-site milestone, the officers' mobilisation checks and the contractor's
        compliance.
      </p>

      <section className={sectionClass} aria-labelledby="mob-on-site">
        <h2 id="mob-on-site" className="text-sm font-bold text-slate-900">
          Mobilised to site
        </h2>
        {milestones.isLoading ? (
          <Loader />
        ) : onSite.length === 0 ? (
          <p className="text-xs text-slate-500">This project has no "Mobilised to site" milestone (its project type defines none).</p>
        ) : (
          <ol className="space-y-2">
            {onSite.map((m) => (
              <MilestoneRow
                key={m.id}
                projectId={project.id}
                m={m}
                onOpenCase={(id) => setParams({ tab: "milestones", case: id }, { replace: true })}
              />
            ))}
          </ol>
        )}
      </section>

      {canSeeVisits && <MobilisationChecks projectId={project.id} />}

      <MobilisationCompliancePanel projectId={project.id} />
    </div>
  );
}

function MobilisationChecks({ projectId }: { projectId: string }) {
  const q = useProjectVisitsQuery(projectId, { visitKind: "MOBILISATION_CHECK" });
  const visits = [...(q.data?.visits ?? [])].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  return (
    <section className={sectionClass} aria-labelledby="mob-checks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mob-checks" className="text-sm font-bold text-slate-900">
          Mobilisation checks
        </h2>
        <Link to={`/app/projects/${projectId}/visits`} className="text-[11px] font-semibold text-brand-primary hover:underline">
          All monitoring visits
        </Link>
      </div>
      {q.isLoading ? (
        <Loader />
      ) : q.isError ? (
        <p className="text-xs text-slate-500">Could not load the monitoring visits.</p>
      ) : visits.length === 0 ? (
        <p className="text-xs text-slate-500">No mobilisation checks. They are proposed from the project type's monitoring plan.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visits.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <Link to={`/app/projects/${projectId}/visits?visitId=${v.id}`} className="min-w-0 hover:underline">
                <span className="font-semibold text-slate-900 tabular-nums">{formatDateShort(v.plannedDate)}</span>
                <span className="text-slate-500">
                  {" "}
                  · {officersText(v)}
                  {v.status === "PLANNED" && (
                    <>
                      {" "}
                      · <ConfirmationText visit={v} />
                    </>
                  )}
                </span>
              </Link>
              <VisitStatusChip status={v.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
