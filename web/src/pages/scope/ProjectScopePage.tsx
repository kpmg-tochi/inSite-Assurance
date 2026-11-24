import React from "react";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { ScopeAndSprintsPanel } from "../../components/scope/ScopeAndSprintsPanel";
import { ProjectStageTabs } from "../../components/projects/ProjectStageTabs";

/** Redesign R2b: the project's "Scope & sprints" page (replaces "BOQ & hold points"). */
export function ProjectScopePage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("boq:upload_edit") && project.status !== "ARCHIVED";
  return (
    <div className="space-y-4">
      <ProjectStageTabs projectId={project.id} stage={project.stage} />
      <ScopeAndSprintsPanel projectId={project.id} readOnly={!canEdit} />
    </div>
  );
}
