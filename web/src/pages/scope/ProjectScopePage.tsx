import React from "react";
import { Boxes } from "lucide-react";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { ScopeAndSprintsPanel } from "../../components/scope/ScopeAndSprintsPanel";

/** Redesign R2b: the project's "Scope & sprints" page (replaces "BOQ & hold points"). */
export function ProjectScopePage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("boq:upload_edit") && project.status !== "ARCHIVED";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center">
          <Boxes className="w-5 h-5 text-brand-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Scope &amp; sprints</h1>
          <p className="text-xs text-slate-500">
            {project.name} · sprints, facility units and BoQ lines{canEdit ? "" : " (read-only)"}
          </p>
        </div>
      </div>
      <ScopeAndSprintsPanel projectId={project.id} readOnly={!canEdit} />
    </div>
  );
}
