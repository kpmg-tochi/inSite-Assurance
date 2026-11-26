import React from "react";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { ScopeAndSprintsPanel } from "../../components/scope/ScopeAndSprintsPanel";
import { ProjectStageTabs } from "../../components/projects/ProjectStageTabs";

/**
 * Redesign R2b: the project's "BoQ & work phases" page (replaces "BOQ & hold points").
 * Design refinement (2026-11-26): the panel's tabs ("Units & BoQ", "Work phases") live in `?tab=`.
 */
export function ProjectScopePage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("scope:edit") && project.status !== "ARCHIVED";
  return (
    <div className="space-y-4">
      <ProjectStageTabs projectId={project.id} stage={project.stage} />
      <ScopeAndSprintsPanel projectId={project.id} readOnly={!canEdit} urlTabs />
    </div>
  );
}
