import React, { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
  useSearchParams,
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
import { PortfolioExecutivePage } from "./pages/dashboard/PortfolioExecutivePage";
import { ProjectsDirectoryPage } from "./pages/projects/ProjectsDirectoryPage";
import { NewProjectPage } from "./pages/projects/setup/NewProjectPage";
import { ProjectSetupShell } from "./pages/projects/setup/ProjectSetupShell";
import { ReconciliationWorkbenchPage } from "./pages/reconciliation/ReconciliationWorkbenchPage";
import { BoqAndHoldPointsPage } from "./pages/boq/BoqAndHoldPointsPage";
import { AuditLedgerPage } from "./pages/audit/AuditLedgerPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { ChangePasswordPage } from "./pages/auth/ChangePasswordPage";
import { RequirePermission } from "./components/PermissionGate";
import { Toaster } from "sonner";
import { useProjectsQuery } from "./queries/projects/useProjectsQueries";
import { useProjectBoqQuery } from "./queries/boq/useBoqQueries";
import { useProjectEvidenceQuery } from "./queries/evidence/useEvidenceQueries";
import { useProjectIpcsQuery } from "./queries/reconciliation/useReconciliationQueries";
import { useDownloadValuationPdfMutation } from "./mutations/reconciliation/useReconciliationMutations";

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
  const canViewIpcs = hasPermission("ipc:view");
  // Asks to save first when the setup wizard has unsaved changes (Phase 6).
  const navigate = useGuardedNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectMatch = useMatch("/app/projects/:projectId/*");
  const urlProjectId =
    projectMatch?.params.projectId && projectMatch.params.projectId !== "new"
      ? projectMatch.params.projectId
      : null;

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedIpcId, setSelectedIpcId] = useState<string | null>(null);

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
  const ipcsQuery = useProjectIpcsQuery(
    activeProject?.id,
    Boolean(user && activeProject?.id && canViewIpcs),
  );

  const ipcs = ipcsQuery.data || [];
  const urlIpcId = searchParams.get("ipc");

  useEffect(() => {
    if (ipcs.length > 0) {
      if (urlIpcId && ipcs.some((i) => i.id === urlIpcId)) {
        if (selectedIpcId !== urlIpcId) {
          setSelectedIpcId(urlIpcId);
        }
        return;
      }
      const stillValid = ipcs.some((i) => i.id === selectedIpcId);
      if (!stillValid) {
        setSelectedIpcId(ipcs[0].id);
      }
    } else {
      setSelectedIpcId(null);
    }
  }, [ipcs, selectedIpcId, urlIpcId]);

  const selectedIpc =
    ipcs.find((i) => i.id === selectedIpcId) || ipcs[0] || null;
  const pdfMutation = useDownloadValuationPdfMutation(activeProject?.id);

  const handleSelectIpc = (ipcId: string) => {
    setSelectedIpcId(ipcId);
    if (location.pathname.includes("/reconciliation")) {
      const next = new URLSearchParams(searchParams);
      next.set("ipc", ipcId);
      setSearchParams(next, { replace: true });
    }
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    const subRouteMatch = location.pathname.match(
      /\/app\/projects\/[^/]+\/(dashboard|reconciliation|boq|audit)/,
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
          Loading InSite Assurance Workspace...
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

  const headerActions = (
    <>
      {selectedIpc && activeProject && hasPermission("valuation:export_pdf") && (
        <button
          type="button"
          disabled={pdfMutation.isPending}
          onClick={() => pdfMutation.mutate(selectedIpc.id)}
          className="px-3.5 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition shadow-sm backdrop-blur-sm"
        >
          {pdfMutation.isPending ? "Exporting..." : "Export Valuation PDF"}
        </button>
      )}
      {activeProject && hasPermission("projects:edit_baseline") && (
        <button
          type="button"
          onClick={() => navigate(`/app/projects/${activeProject.id}/settings/basics`)}
          className="px-3.5 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition shadow-sm backdrop-blur-sm"
        >
          Project settings
        </button>
      )}
      {hasPermission("projects:create") && (
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
      openConflictBadgeCount={activeProject?.openConflictCount ?? 0}
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
              onNewProject={() => navigate("/app/projects/new")}
            />
          }
        />
        <Route
          path="executive"
          element={
            <RequirePermission anyOf={["projects:view_executive_matrix"]} backTo={projectHome}>
              <PortfolioExecutivePage
                onSelectProject={(projectId) => {
                  setSelectedProjectId(projectId);
                  navigate(`/app/projects/${projectId}/dashboard`);
                }}
              />
            </RequirePermission>
          }
        />

        {activeProject ? (
          <>
            <Route index element={<Navigate to={projectHome} replace />} />
            <Route
              path="projects/:projectId/dashboard"
              element={
                <PortfolioDashboardPage
                  project={activeProject}
                  evidenceLogs={evidenceQuery.data || []}
                  latestIpc={selectedIpc}
                  onNavigateToReconciliation={() =>
                    navigate(`/app/projects/${activeProject.id}/reconciliation`)
                  }
                />
              }
            />
            <Route
              path="projects/:projectId/reconciliation"
              element={
                <RequirePermission anyOf={["ipc:view"]} backTo={projectHome}>
                  <ReconciliationWorkbenchPage
                    project={activeProject}
                    ipcs={ipcs}
                    selectedIpc={selectedIpc}
                    onSelectIpc={handleSelectIpc}
                    boqItems={boqQuery.data || []}
                  />
                </RequirePermission>
              }
            />
            <Route
              path="projects/:projectId/boq"
              element={
                <RequirePermission anyOf={["boq:view"]} backTo={projectHome}>
                  <BoqAndHoldPointsPage
                    project={activeProject}
                    boqItems={boqQuery.data || []}
                  />
                </RequirePermission>
              }
            />
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
              path="reconciliation"
              element={
                <Navigate
                  to={`/app/projects/${activeProject.id}/reconciliation${location.search}`}
                  replace
                />
              }
            />
            <Route
              path="boq"
              element={<Navigate to={`/app/projects/${activeProject.id}/boq`} replace />}
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
        <Route
          path="/executive"
          element={<Navigate to="/app/executive" replace />}
        />
        <Route
          path="/reconciliation"
          element={<Navigate to="/app/reconciliation" replace />}
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
