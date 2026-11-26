import React, { useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { Overlay } from "../common/Overlay";
import { useDialogFocus } from "../common/ModalShell";
import { usePortfolioOverviewQuery } from "../../queries/projects/useProjectsQueries";
import { useAuth } from "../../lib/auth-context";
import { useGuardedNavigate } from "../../lib/navigationGuard";
import { parseAppLocation, sameSubPageFor } from "../../navigation/navItems";
import { PortfolioProjectsTable, type ProjectTableFilter } from "../../pages/dashboard/PortfolioProjectsTable";

const closeButtonClass =
  "p-1 rounded-lg text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

/**
 * UBEC rebrand: "Change project" in the sidebar. The same projects table as the home page, as the
 * whole dialog (one header: title, count, close); picking a project keeps the page you are on (e.g.
 * its Reports) when you may see it there. Focus stays inside, Escape closes, focus returns on close.
 */
export function ChangeProjectDialog({ currentProjectId, onClose }: { currentProjectId: string | null; onClose: () => void }) {
  const { hasAnyPermission } = useAuth();
  const navigate = useGuardedNavigate();
  const location = useLocation();
  const [filter, setFilter] = useState<ProjectTableFilter>("all");
  const { data, isLoading, isError, refetch } = usePortfolioOverviewQuery({});
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialogFocus(dialogRef, onClose);

  const pick = (projectId: string) => {
    onClose();
    if (projectId === currentProjectId) return;
    const loc = parseAppLocation(location.pathname, location.search);
    navigate(loc.projectId ? sameSubPageFor(loc, projectId, hasAnyPermission) : `/app/projects/${projectId}/dashboard`);
  };

  // In the table header the close button stays top right on a phone too (the header stacks there).
  const closeButton = (placed: string) => (
    <button type="button" onClick={onClose} aria-label="Close" className={`${closeButtonClass} ${placed}`}>
      <X className="w-4 h-4" aria-hidden="true" />
    </button>
  );

  return (
    <Overlay className="flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative w-full max-w-7xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl focus:outline-none"
      >
        {isError && !data ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 bg-brand-navy px-5 py-3.5 text-white">
              <h2 id={titleId} className="text-sm font-bold">
                Change project
              </h2>
              {closeButton("")}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-rose-700">
              <span>The projects could not be loaded. Check your connection, then try again.</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <PortfolioProjectsTable
            projects={data?.projects ?? []}
            loading={isLoading}
            filter={filter}
            onFilterChange={setFilter}
            onOpenProject={pick}
            hideCreate
            pageSize={8}
            selectedId={currentProjectId}
            title={<span id={titleId}>Change project</span>}
            subtitle={(shown, total) => (isLoading ? "Loading projects…" : `${shown} of ${total} shown. Select a project to open it.`)}
            headerAction={closeButton("absolute right-4 top-3 sm:static")}
          />
        )}
      </div>
    </Overlay>
  );
}
