import React, { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
} from "react-router-dom";
import { useAuth } from "./lib/auth-context";
import { useGuardedNavigate } from "./lib/navigationGuard";
import { AppShell } from "./components/AppShell";
import Loader from "./components/Loader";
import { LoginPage } from "./pages/auth/LoginPage";
import { HomePage } from "./pages/public/HomePage";
import { AboutPage } from "./pages/public/AboutPage";
import { MobileAppPage } from "./pages/public/MobileAppPage";
import { PortfolioDashboardPage } from "./pages/dashboard/PortfolioDashboardPage";
import { PortfolioOverviewPage } from "./pages/dashboard/PortfolioOverviewPage";
import { ProjectClosurePage } from "./pages/closure/ProjectClosurePage";
import { LessonsLibraryPage } from "./pages/lessons/LessonsLibraryPage";
import { ProgrammeKpisPage } from "./pages/kpis/ProgrammeKpisPage";
import { OrganizationRatingsPage } from "./pages/organizations/OrganizationRatingsPage";
import { ProjectsDirectoryPage } from "./pages/projects/ProjectsDirectoryPage";
import { NewProjectPage } from "./pages/projects/setup/NewProjectPage";
import { ProjectSetupShell } from "./pages/projects/setup/ProjectSetupShell";
import { ProjectPaymentsPage } from "./pages/payments/ProjectPaymentsPage";
import { ProjectScopePage } from "./pages/scope/ProjectScopePage";
import { AuditLedgerPage } from "./pages/audit/AuditLedgerPage";
import { ProjectHandoverPage } from "./pages/closeout/ProjectHandoverPage";
import { RetentionDefectsPage } from "./pages/closeout/RetentionDefectsPage";
import { ProjectVisitsPage } from "./pages/visits/ProjectVisitsPage";
import { VisitPlannerPage } from "./pages/visits/VisitPlannerPage";
import { ProjectDocumentsPage } from "./pages/documents/ProjectDocumentsPage";
import { ProjectMilestonesPage } from "./pages/milestones/ProjectMilestonesPage";
import { ProjectKickoffPage } from "./pages/milestones/ProjectKickoffPage";
import { MILESTONE_VIEW_PERMISSIONS } from "./components/contracts/contractUi";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { ChangePasswordPage } from "./pages/auth/ChangePasswordPage";
import { RequirePermission } from "./components/PermissionGate";
import { Toaster } from "sonner";
import { useProjectsQuery } from "./queries/projects/useProjectsQueries";
import { useProjectBoqQuery } from "./queries/boq/useBoqQueries";
import { useProjectEvidenceQuery } from "./queries/evidence/useEvidenceQueries";
import { APPLICATION_NAME } from "./config/appName";

function ProjectSetupRedirect({ mode }: { mode: "setup" | "settings" }) {
  const match = useMatch(`/app/projects/:projectId/${mode}`);
  return <Navigate to={`/app/projects/${match?.params.projectId}/${mode}/basics`} replace />;
}

function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

function AuthenticatedWorkspace() {
  const { user, isLoading: authLoading, hasPermission } = useAuth();
  const canViewBoq = hasPermission("boq:view");
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
  const boqQuery = useProjectBoqQuery(
    activeProject?.id,
    Boolean(user && activeProject?.id && canViewBoq),
  );
  const evidenceQuery = useProjectEvidenceQuery(
    activeProject?.id,
    Boolean(user && activeProject?.id && canViewReports),
  );
  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    const subRouteMatch = location.pathname.match(
      /\/app\/projects\/[^/]+\/(dashboard|payments|scope|audit|schedule|handover|retention|documents|milestones|kickoff|closure|inspections|visits)/,
    );
    const subRoute = subRouteMatch?.[1] || "dashboard";
    const safeSubRoute =
      !hasPermission("audit:view_ledger") && subRoute === "audit"
        ? "dashboard"
        : subRoute;
    navigate(`/app/projects/${projectId}/${safeSubRoute}`);
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

  // Project actions only on that project's own pages; "New Project" only on the portfolio and
  // the project list.
  const path = location.pathname.replace(/\/+$/, "");
  const onProjectPage = Boolean(urlProjectId && activeProject?.id === urlProjectId);
  const onProjectSetup = /^\/app\/projects\/[^/]+\/(setup|settings)(\/|$)/.test(path);
  const onProjectListPage = path === "/app/portfolio" || path === "/app/projects";

  const headerActions = (
    <>
      {onProjectPage && !onProjectSetup && activeProject && hasPermission("projects:edit_baseline") && (
        <button
          type="button"
          onClick={() => navigate(`/app/projects/${activeProject.id}/settings/basics`)}
          className="px-3.5 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition shadow-sm backdrop-blur-sm"
        >
          Project settings
        </button>
      )}
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

        {activeProject ? (
          <>
            {/* The portfolio dashboard is the central landing page for people who may see it. */}
            <Route
              index
              element={<Navigate to={hasPermission("projects:view_portfolio") ? "/app/portfolio" : projectHome} replace />}
            />
            <Route
              path="projects/:projectId/dashboard"
              element={
                <PortfolioDashboardPage
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
            <Route
              path="projects/:projectId/handover"
              element={
                <RequirePermission anyOf={["handover:record_response", "handover:review_feedback"]} backTo={projectHome}>
                  <ProjectHandoverPage project={activeProject} />
                </RequirePermission>
              }
            />
            <Route
              path="projects/:projectId/retention"
              element={
                <RequirePermission
                  anyOf={["retention:manage_defects", "payments:view", "payments:record", "audit:view_ledger"]}
                  backTo={projectHome}
                >
                  <RetentionDefectsPage project={activeProject} />
                </RequirePermission>
              }
            />
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
            <Route
              path="projects/:projectId/milestones"
              element={
                <RequirePermission anyOf={MILESTONE_VIEW_PERMISSIONS} backTo={projectHome}>
                  <ProjectMilestonesPage project={activeProject} />
                </RequirePermission>
              }
            />
            <Route
              path="projects/:projectId/kickoff"
              element={
                <RequirePermission anyOf={MILESTONE_VIEW_PERMISSIONS} backTo={projectHome}>
                  <ProjectKickoffPage project={activeProject} />
                </RequirePermission>
              }
            />
            {/* Phase 15: closure checklist, ratings, lessons and the closure pack (contractors see shared lessons) */}
            <Route path="projects/:projectId/closure" element={<ProjectClosurePage project={activeProject} />} />
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
        {/* Unauthenticated Public Marketing & Context Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/mobile-app" element={<MobileAppPage />} />

        {/* Login Route */}
        <Route
          path="/login"
          element={
            !authLoading && user ? (
              <Navigate to="/app/dashboard" replace />
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
