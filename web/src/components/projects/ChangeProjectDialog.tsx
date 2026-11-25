import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { ModalShell } from "../common/ModalShell";
import Loader from "../Loader";
import { usePortfolioOverviewQuery } from "../../queries/projects/useProjectsQueries";
import { useAuth } from "../../lib/auth-context";
import { useGuardedNavigate } from "../../lib/navigationGuard";
import { parseAppLocation, sameSubPageFor } from "../../navigation/navItems";
import { PortfolioProjectsTable, type ProjectTableFilter } from "../../pages/dashboard/PortfolioProjectsTable";

/**
 * UBEC rebrand: "Change project" in the sidebar. The same projects table as the home page, in a
 * dialog; picking a project keeps the page you are on (e.g. its Reports) when you may see it there.
 */
export function ChangeProjectDialog({ currentProjectId, onClose }: { currentProjectId: string | null; onClose: () => void }) {
  const { hasAnyPermission } = useAuth();
  const navigate = useGuardedNavigate();
  const location = useLocation();
  const [filter, setFilter] = useState<ProjectTableFilter>("all");
  const { data, isLoading, isError, refetch } = usePortfolioOverviewQuery({});

  const pick = (projectId: string) => {
    onClose();
    if (projectId === currentProjectId) return;
    const loc = parseAppLocation(location.pathname, location.search);
    navigate(loc.projectId ? sameSubPageFor(loc, projectId, hasAnyPermission) : `/app/projects/${projectId}/dashboard`);
  };

  return (
    <ModalShell title="Change project" subtitle="Select a project to open it." onClose={onClose} maxWidth="max-w-6xl">
      <div className="overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center p-10">
            <Loader inline />
          </div>
        ) : isError || !data ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 p-4 text-sm text-rose-700">
            <span>The projects could not be loaded. Check your connection, then try again.</span>
            <button type="button" onClick={() => refetch()} className="rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-50">
              Try again
            </button>
          </div>
        ) : (
          <PortfolioProjectsTable projects={data.projects} filter={filter} onFilterChange={setFilter} onOpenProject={pick} hideCreate pageSize={8} selectedId={currentProjectId} />
        )}
      </div>
    </ModalShell>
  );
}
