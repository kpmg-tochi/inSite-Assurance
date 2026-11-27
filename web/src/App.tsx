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
import { ProjectOverviewPage } from "./pages/overview/ProjectOverviewPage";
import { WorkspaceHomePage } from "./pages/dashboard/WorkspaceHomePage";
import { OrganizationRatingsPage } from "./pages/organizations/OrganizationRatingsPage";
import { ContractorsPage } from "./pages/contractors/ContractorsPage";
import { ContractorDetailPage } from "./pages/contractors/ContractorDetailPage";
import { NeedsAssessmentPage } from "./pages/needsAssessment/NeedsAssessmentPage";
import { ProposalPage } from "./pages/needsAssessment/ProposalPage";
import { StandardsPage } from "./pages/standards/StandardsPage";
import { NewProjectPage } from "./pages/projects/setup/NewProjectPage";
import { ProjectSetupShell } from "./pages/projects/setup/ProjectSetupShell";
import { ProjectPaymentsPage } from "./pages/payments/ProjectPaymentsPage";
import { ProjectScopePage } from "./pages/scope/ProjectScopePage";
import { AuditLedgerPage } from "./pages/audit/AuditLedgerPage";
import { CompletionHandoverPage } from "./pages/completion/CompletionHandoverPage";
import { COMPLETION_PAGE_PERMISSIONS } from "./pages/completion/completionPermissions";
import { ProjectVisitsPage } from "./pages/visits/ProjectVisitsPage";
import { ProjectDocumentsPage } from "./pages/documents/ProjectDocumentsPage";
import { KickoffMobilisationPage } from "./pages/kickoff/KickoffMobilisationPage";
import { PORTFOLIO_PERMISSION, workspaceHomePath } from "./navigation/navItems";
import { isOngoingProject } from "@insite/shared";
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

/** The project opened last on this browser (UBEC rebrand: the sidebar always shows a project). */
const LAST_PROJECT_KEY = "ubec:lastProjectId";
function readLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}
function rememberProjectId(id: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Storage can be unavailable (private window); the default then is the first ongoing project.
  }
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
  const canViewReports = hasPermission("visits:view");
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
        rememberProjectId(urlProjectId);
      }
      return;
    }
    if (projects.length > 0 && !selectedProjectId) {
      // The last project opened here, else the first ongoing one, else the first.
      const last = readLastProjectId();
      const fallback =
        projects.find((p) => p.id === last) ??
        projects.find(isOngoingProject) ??
        projects[0];
      setSelectedProjectId(fallback.id);
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
  // UBEC rebrand: projects are opened from the home page's map and table only (no switcher).
  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    rememberProjectId(projectId);
    navigate(`/app/projects/${projectId}/dashboard`);
  };
  const home = workspaceHomePath(hasAnyPermission);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <Loader size="sm" inline />
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

  const path = location.pathname.replace(/\/+$/, "");

  // A project page URL for a project outside the live list (a draft, or one the user cannot see) must
  // not render another project's data under that URL: drafts have no Overview, so open their setup
  // (which also answers for a project the user may not open).
  const onSetupRoute = /^\/app\/projects\/[^/]+\/(setup|settings)(\/|$)/.test(path);
  // Not while the list is refetching: right after activation the cached list still lacks the project,
  // and redirecting then would send the new Overview back to its setup.
  if (urlProjectId && !onSetupRoute && projectsQuery.isSuccess && !projectsQuery.isFetching && !projects.some((p) => p.id === urlProjectId)) {
    return <Navigate to={`/app/projects/${urlProjectId}/setup`} replace />;
  }

  const projectHome = activeProject
    ? `/app/projects/${activeProject.id}/dashboard`
    : home;

  return (
    <AppShell selectedProject={activeProject}>
      <Routes>
        {/* UBEC rebrand: the workspace home. Programme admins get the Portfolio, everyone else the Dashboard. */}
        <Route index element={<Navigate to={home} replace />} />
        <Route
          path="portfolio"
          element={
            hasPermission(PORTFOLIO_PERMISSION) ? (
              <WorkspaceHomePage variant="portfolio" onOpenProject={openProject} />
            ) : (
              <Navigate to="/app/dashboard" replace />
            )
          }
        />
        <Route
          path="dashboard"
          element={
            hasPermission(PORTFOLIO_PERMISSION) ? (
              <Navigate to="/app/portfolio" replace />
            ) : (
              <WorkspaceHomePage variant="dashboard" onOpenProject={openProject} />
            )
          }
        />
        {/* The old workspace pages are tabs of the home page now (or a Settings tab). */}
        <Route path="projects" element={<Navigate to={home} replace />} />
        <Route path="kpis" element={<Navigate to={`${home}?tab=kpis`} replace />} />
        <Route path="visits" element={<Navigate to={`${home}?tab=visits`} replace />} />
        {/* Client demo updates G.2: the programme-wide payments are a tab of the home page. */}
        <Route path="payments" element={<Navigate to={`${home}?tab=payments`} replace />} />
        <Route path="lessons" element={<Navigate to={home} replace />} />
        <Route path="forms" element={<Navigate to="/app/settings?tab=forms" replace />} />
        <Route path="executive" element={<Navigate to={home} replace />} />
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
        <Route path="organizations/:organizationId/ratings" element={<OrganizationRatingsPage />} />
        {/* Needs pipeline wave 2: the annual cycle (needs:view) with the E3 approved lists as a tab (approved_lists:view). */}
        <Route
          path="needs-assessment"
          element={
            <RequirePermission anyOf={["needs:view", "approved_lists:view"]} backTo={projectHome}>
              <NeedsAssessmentPage />
            </RequirePermission>
          }
        />
        <Route
          path="needs-assessment/proposals/:proposalId"
          element={
            <RequirePermission anyOf={["needs:view"]} backTo={projectHome}>
              <ProposalPage />
            </RequirePermission>
          }
        />
        {/* Needs pipeline wave 2 (N2): costing, design and monitoring standards (any web user). */}
        <Route path="standards" element={<StandardsPage />} />
        {/* Client demo updates F.1 (wave 2): the contractor register. */}
        <Route
          path="contractors"
          element={
            <RequirePermission anyOf={["contractors:view_register"]} backTo={projectHome}>
              <ContractorsPage />
            </RequirePermission>
          }
        />
        <Route
          path="contractors/:contractorId"
          element={
            <RequirePermission anyOf={["contractors:view_register"]} backTo={projectHome}>
              <ContractorDetailPage />
            </RequirePermission>
          }
        />

        {activeProject ? (
          <>
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
                <RequirePermission anyOf={["scope:view"]} backTo={projectHome}>
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
            <Route
              path="boq"
              element={<Navigate to={`/app/projects/${activeProject.id}/scope`} replace />}
            />
            <Route
              path="audit"
              element={<Navigate to={`/app/projects/${activeProject.id}/audit`} replace />}
            />
            <Route path="*" element={<Navigate to={home} replace />} />
          </>
        ) : (
          <Route
            path="*"
            element={
              <div className="bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center justify-center gap-3 text-xs text-slate-500">
                {projectsQuery.isLoading ? (
                  <>
                    <Loader size="sm" inline />
                    <span>Loading projects…</span>
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
  const publicEntry = authLoading ? null : <Navigate to={user ? "/app" : "/login"} replace />;

  return (
    <>
      <ScrollToTopOnNavigate />
      <Routes>
        {/* No public pages (redesign R7, D-R7.15): the old marketing URLs go to sign-in;
            a signed-in user keeps the normal landing. */}
        <Route path="/" element={publicEntry} />
        <Route path="/about" element={publicEntry} />
        <Route path="/mobile-app" element={publicEntry} />

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
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
      <Toaster position="top-right" richColors closeButton theme="light" />
    </>
  );
}
