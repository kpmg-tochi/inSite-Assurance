import React from "react";
import type { ProjectScopeDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { ScopeAndSprintsPanel } from "../../components/scope/ScopeAndSprintsPanel";
import { ProjectStageTabs } from "../../components/projects/ProjectStageTabs";
import { FacilitiesBreakdownTab } from "../../components/needs/integration/FacilitiesBreakdownTab";
import { useProjectNeedsOriginQuery } from "../../queries/needs/useIntegrationQueries";

/**
 * Redesign R2b: the project's "BoQ & work phases" page (replaces "BOQ & hold points").
 * Design refinement (2026-11-26): the panel's tabs ("Units & BoQ", "Work phases") live in `?tab=`.
 * Needs pipeline wave 4 (C5): a project from a needs assessment gets a third tab, "Facilities".
 */
export function ProjectScopePage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("scope:edit") && project.status !== "ARCHIVED";
  const origin = useProjectNeedsOriginQuery(project.id);
  const breakdown = origin.data?.breakdown ?? [];
  const facilitiesTab =
    breakdown.length > 0
      ? {
          count: breakdown.length,
          render: (scope: ProjectScopeDto) => (
            <FacilitiesBreakdownTab projectId={project.id} rows={breakdown} units={scope.units} live={scope.projectStatus !== "DRAFT"} />
          ),
        }
      : null;
  return (
    <div className="space-y-4">
      <ProjectStageTabs projectId={project.id} stage={project.stage} />
      <ScopeAndSprintsPanel projectId={project.id} readOnly={!canEdit} urlTabs facilitiesTab={facilitiesTab} />
    </div>
  );
}
