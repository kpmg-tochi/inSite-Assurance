import React, { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
  useParams,
} from "react-router-dom";
import { useAuth } from "./lib/auth-context";
import { useGuardedNavigate } from "./lib/navigationGuard";
import { AppShell } from "./components/AppShell";
import Loader from "./components/Loader";
import { LoginPage } from "./pages/auth/LoginPage";
import { HomePage } from "./pages/public/HomePage";
import { MobileAppPage } from "./pages/public/MobileAppPage";
import { ProjectOverviewPage } from "./pages/overview/ProjectOverviewPage";
import { PortfolioOverviewPage } from "./pages/dashboard/PortfolioOverviewPage";
import { LessonsLibraryPage } from "./pages/lessons/LessonsLibraryPage";
import { ProgrammeKpisPage } from "./pages/kpis/ProgrammeKpisPage";
import { OrganizationRatingsPage } from "./pages/organizations/OrganizationRatingsPage";
import { ProjectsDirectoryPage } from "./pages/projects/ProjectsDirectoryPage";
import { NewProjectPage } from "./pages/projects/setup/NewProjectPage";
import { ProjectSetupShell } from "./pages/projects/setup/ProjectSetupShell";
import { ProjectPaymentsPage } from "./pages/payments/ProjectPaymentsPage";
import { ProjectScopePage } from "./pages/scope/ProjectScopePage";
import { AuditLedgerPage } from "./pages/audit/AuditLedgerPage";
import { CompletionHandoverPage } from "./pages/completion/CompletionHandoverPage";
import { COMPLETION_PAGE_PERMISSIONS } from "./pages/completion/completionPermissions";
import { ProjectVisitsPage } from "./pages/visits/ProjectVisitsPage";
import { VisitPlannerPage } from "./pages/visits/VisitPlannerPage";
import { ProjectDocumentsPage } from "./pages/documents/ProjectDocumentsPage";
import { KickoffMobilisationPage } from "./pages/kickoff/KickoffMobilisationPage";
import { FormsFacilitiesPage } from "./pages/forms/FormsFacilitiesPage";
import { parseAppLocation, sameSubPageFor } from "./navigation/navItems";
import { MILESTONE_VIEW_PERMISSIONS } from "./components/contracts/contractUi";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { ChangePasswordPage } from "./pages/auth/ChangePasswordPage";
import { RequirePermission } from "./components/PermissionGate";
import { Toaster } from "sonner";
import { useProjectsQuery } from "./queries/projects/useProjectsQueries";
import { useProjectEvidenceQuery } from "./queries/evidence/useEvidenceQueries";
import { APPLICATION_NAME } from "./config/appName";

function ProjectSetupRedirect({ mode }: { mode: "setup" | "settings" }) {
  const match = useMatch(`/app/projects/:projectId/${mode}`);
  return <Navigate to={`/app/projects/${match?.params.projectId}/${mode}/project`} replace />;
}

/**
 * Redesign R6b: an old project page URL opens the tab of the merged page that replaced it, keeping
 * the query string (`?case=` from default-case links, `?ticket=` from defect links).
 */
function NavigateKeepingQuery({ page, tab }: { page: string; tab: string }) {
  const { projectId } = useParams();
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return <Navigate to={`/app/projects/${projectId}/${page}?${params.toString()}${hash}`} replace />;
}

function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

function AuthenticatedWorkspace() {
  const { user, isLoading: authLoading, hasPermission, hasAnyPermission } = useAuth();
  const canViewReports = hasPermission("reports:view_all");
  // Asks to save first when the setup wizard has unsaved changes (Phase 6).
  const navigate = useGuardedNavigate();
  const location = useLocation();
  const projectMatch = useMatch("/app/projects/:projectId/*");
  const urlProjectId =
    projectMatch?.params.projectId && projectMatch.params.projectId !== "new"
      ? projectMatch.params.projectId
      : null;

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );

  const projectsQuery = useProjectsQuery(Boolean(user));
  const projects = projectsQuery.data || [];

  useEffect(() => {
    if (urlProjectId && projects.some((p) => p.id === urlProjectId)) {
      if (selectedProjectId !== urlProjectId) {
        setSelectedProjectId(urlProjectId);
      }
      return;
    }
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId, urlProjectId]);

  const activeProject =
    (urlProjectId ? projects.find((p) => p.id === urlProjectId) : null) ||
    projects.find((p) => p.id === selectedProjectId) ||
    projects[0] ||
    null;

  // Only fetch what the role can see; the API would refuse the rest.
  const evidenceQuery = useProjectEvidenceQuery(
    activeProject?.id,
    Boolean(user && activeProject?.id && canViewReports),
  );
  // Switching project keeps the sub-page (looked up in the navigation config) when the user may see it.
  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    navigate(sameSubPageFor(parseAppLocation(location.pathname, location.search), projectId, hasAnyPermission));
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <Loader size="sm" />
        <span className="text-xs text-slate-500 font-medium">
          Loading {APPLICATION_NAME} Workspace...
        </span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  // "New Project" only on the portfolio and the project list (project settings: sidebar More, Settings).
  const path = location.pathname.replace(/\/+$/, "");
  const onProjectListPage = path === "/app/portfolio" || path === "/app/projects";

  // A project page URL for a project outside the live list (a draft, or one the user cannot see) must
  // not render another project's data under that URL: drafts have no Overview, so open their setup
  // (which also answers for a project the user may not open).
  const onSetupRoute = /^\/app\/projects\/[^/]+\/(setup|settings)(\/|$)/.test(path);
  if (urlProjectId && !onSetupRoute && projectsQuery.isSuccess && !projects.some((p) => p.id === urlProjectId)) {
    return <Navigate to={`/app/projects/${urlProjectId}/setup`} replace />;
  }

  const headerActions = (
    <>
      {onProjectListPage && hasPermission("projects:create") && (
        <button
          type="button"
          onClick={() => navigate("/app/projects/new")}
          className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-brand-navy text-xs font-bold transition shadow-sm"
        >
          + New Project
        </button>
      )}
    </>
  );

  const projectHome = activeProject
    ? `/app/projects/${activeProject.id}/dashboard`
    : "/app";

  return (
    <AppShell
      projects={projects}
      selectedProject={activeProject}
      onSelectProject={handleSelectProject}
      headerActions={headerActions}
    >
      <Routes>
        {/* Routes that work with or without a selected project */}
        <Route path="settings" element={<SettingsPage project={activeProject} />} />
        <Route
          path="projects/new"
          element={
            <RequirePermission anyOf={["projects:create"]} backTo={projectHome}>
              <NewProjectPage />
            </RequirePermission>
          }
        />
        {/* Staged wizard (Phase 6): drafts are not in the project list, so these work without one. */}
        <Route path="projects/:projectId/setup/:stepId" element={<ProjectSetupShell mode="setup" />} />
        <Route path="projects/:projectId/setup" element={<ProjectSetupRedirect mode="setup" />} />
        <Route path="projects/:projectId/settings/:stepId" element={<ProjectSetupShell mode="settings" />} />
        <Route path="projects/:projectId/settings" element={<ProjectSetupRedirect mode="settings" />} />
        <Route
          path="projects"
          element={
            <ProjectsDirectoryPage
              projects={projects}
              selectedProjectId={activeProject?.id ?? null}
              onSelectProject={setSelectedProjectId}
            />
          }
        />
        <Route
          path="portfolio"
          element={
            <RequirePermission anyOf={["projects:view_portfolio"]} backTo={projectHome}>
              <PortfolioOverviewPage
                onOpenProject={(projectId) => {
                  setSelectedProjectId(projectId);
                  navigate(`/app/projects/${projectId}/dashboard`);
                }}
              />
            </RequirePermission>
          }
        />
        {/* Redesign R4: the visit planner across the visible projects */}
        <Route
          path="visits"
          element={
            <RequirePermission anyOf={["visits:view"]} backTo={projectHome}>
              <VisitPlannerPage />
            </RequirePermission>
          }
        />
        {/* Phase 16: programme KPIs over the visible projects */}
        <Route
          path="kpis"
          element={
            <RequirePermission anyOf={["kpis:view"]} backTo={projectHome}>
              <ProgrammeKpisPage
                onOpenProject={(projectId) => {
                  setSelectedProjectId(projectId);
                  navigate(`/app/projects/${projectId}/dashboard`);
                }}
              />
            </RequirePermission>
          }
        />
        {/* Phase 15: the lessons-learned library and a contractor's ratings across projects */}
        <Route
          path="lessons"
          element={
            <RequirePermission anyOf={["lessons:view"]} backTo={projectHome}>
              <LessonsLibraryPage />
            </RequirePermission>
          }
        />
        <Route path="organizations/:organizationId/ratings" element={<OrganizationRatingsPage />} />
        <Route path="executive" element={<Navigate to="/app/portfolio" replace />} />
        {/* Redesign R6b (D-R6.25): the facility catalogue and the form library, moved out of Settings */}
        <Route
          path="forms"
          element={
            <RequirePermission anyOf={["facilities:manage", "forms:manage"]} backTo={projectHome}>
              <FormsFacilitiesPage />
            </RequirePermission>
          }
        />

        {activeProject ? (
          <>
            {/* The portfolio dashboard is the central landing page for people who may see it. */}
            <Route
              index
              element={<Navigate to={hasPermission("projects:view_portfolio") ? "/app/portfolio" : projectHome} replace />}
            />
            {/* Redesign R6c: the project Overview (route kept as /dashboard, D-R6.18) */}
            <Route
              path="projects/:projectId/dashboard"
              element={
                <ProjectOverviewPage
                  project={activeProject}
                  evidenceLogs={evidenceQuery.data || []}
                />
              }
            />
            <Route
              path="projects/:projectId/payments"
              element={
                <RequirePermission anyOf={["payments:view", "payments:record"]} backTo={projectHome}>
                  <ProjectPaymentsPage project={activeProject} />
                </RequirePermission>
              }
            />
            {/* Redesign R2b: "Scope & sprints" replaces "BOQ & hold points". */}
            <Route
              path="projects/:projectId/scope"
              element={
                <RequirePermission anyOf={["boq:view"]} backTo={projectHome}>
                  <ProjectScopePage project={activeProject} />
                </RequirePermission>
              }
            />
            <Route path="projects/:projectId/boq" element={<Navigate to={`/app/projects/${activeProject.id}/scope`} replace />} />
            {/* Redesign R2d: the schedule page is gone; sprints live on Scope & sprints. */}
            <Route path="projects/:projectId/schedule" element={<Navigate to={`/app/projects/${activeProject.id}/scope`} replace />} />
            {/* Redesign R6b (D-R6.16): certificate, handover, defects and closure on one page */}
            <Route
              path="projects/:projectId/completion"
              element={
                <RequirePermission anyOf={COMPLETION_PAGE_PERMISSIONS} backTo={projectHome}>
                  <CompletionHandoverPage project={activeProject} />
                </RequirePermission>
              }
            />
            <Route path="projects/:projectId/handover" element={<NavigateKeepingQuery page="completion" tab="handover" />} />
            <Route path="projects/:projectId/retention" element={<NavigateKeepingQuery page="completion" tab="defects" />} />
            <Route path="projects/:projectId/closure" element={<NavigateKeepingQuery page="completion" tab="closure" />} />
            {/* Redesign R4: the project's visits, findings and site log */}
            <Route
              path="projects/:projectId/visits"
              element={
                <RequirePermission anyOf={["visits:view"]} backTo={projectHome}>
                  <ProjectVisitsPage project={activeProject} />
                </RequirePermission>
              }
            />
            {/* Redesign R4f: inspections are replaced by visits. */}
            <Route path="projects/:projectId/inspections" element={<Navigate to={`/app/projects/${activeProject.id}/visits`} replace />} />
            {/* Phase 13: document register, contract milestones and the kick-off meeting */}
            <Route
              path="projects/:projectId/documents"
              element={
                <RequirePermission anyOf={["documents:view", "documents:upload"]} backTo={projectHome}>
                  <ProjectDocumentsPage project={activeProject} />
                </RequirePermission>
              }
            />
            {/* Redesign R6b (D-R6.15): kick-off, milestones and mobilisation on one page */}
            <Route
              path="projects/:projectId/kickoff"
              element={
                <RequirePermission anyOf={MILESTONE_VIEW_PERMISSIONS} backTo={projectHome}>
                  <KickoffMobilisationPage project={activeProject} />
                </RequirePermission>
              }
            />
            <Route path="projects/:projectId/milestones" element={<NavigateKeepingQuery page="kickoff" tab="milestones" />} />
            <Route
              path="projects/:projectId/audit"
              element={
                <RequirePermission anyOf={["audit:view_ledger"]} backTo={projectHome}>
                  <AuditLedgerPage project={activeProject} />
                </RequirePermission>
              }
            />

            {/* Legacy non-scoped route redirects */}
            <Route path="dashboard" element={<Navigate to={projectHome} replace />} />
            <Route
              path="boq"
              element={<Navigate to={`/app/projects/${activeProject.id}/scope`} replace />}
            />
            <Route
              path="audit"
              element={<Navigate to={`/app/projects/${activeProject.id}/audit`} replace />}
            />
            <Route path="*" element={<Navigate to={projectHome} replace />} />
          </>
        ) : (
          <Route
            path="*"
            element={
              <div className="bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center justify-center gap-3 text-xs text-slate-500">
                {projectsQuery.isLoading ? (
                  <>
                    <Loader size="sm" />
                    <span>Loading capital projects...</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-bold text-slate-900">No projects yet</span>
                    <span className="max-w-sm text-center">
                      {hasPermission("projects:create")
                        ? "Create the first project, or set up roles, users and branding in Settings."
                        : "You have not been given access to any project. You can still manage your account in Settings."}
                    </span>
                    <div className="flex items-center gap-2 pt-1">
                      {hasPermission("projects:create") && (
                        <button
                          type="button"
                          onClick={() => navigate("/app/projects/new")}
                          className="px-3.5 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold"
                        >
                          + New Project
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate("/app/settings")}
                        className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                      >
                        Open Settings
                      </button>
                    </div>
                  </>
                )}
              </div>
            }
          />
        )}
      </Routes>
    </AppShell>
  );
}

export function App() {
  const { user, isLoading: authLoading } = useAuth();

  return (
    <>
      <ScrollToTopOnNavigate />
      <Routes>
        {/* Public pages (redesign R6f, D-R6.26) */}
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<Navigate to="/" replace />} />
        <Route path="/mobile-app" element={<MobileAppPage />} />

        {/* Login Route */}
        <Route
          path="/login"
          element={
            !authLoading && user ? (
              <Navigate to="/app" replace />
            ) : (
              <LoginPage />
            )
          }
        />

        {/* Convenience Direct Route Redirects */}
        <Route
          path="/dashboard"
          element={<Navigate to="/app/dashboard" replace />}
        />
        <Route path="/boq" element={<Navigate to="/app/boq" replace />} />
        <Route path="/audit" element={<Navigate to="/app/audit" replace />} />
        <Route
          path="/settings"
          element={<Navigate to="/app/settings" replace />}
        />

        {/* Authenticated Portal Workspace */}
        <Route path="/app/*" element={<AuthenticatedWorkspace />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" richColors closeButton theme="light" />
    </>
  );
}
