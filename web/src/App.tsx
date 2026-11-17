import React, { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "./lib/auth-context";
import { AppShell } from "./components/AppShell";
import Loader from "./components/Loader";
import { LoginPage } from "./pages/auth/LoginPage";
import { HomePage } from "./pages/public/HomePage";
import { AboutPage } from "./pages/public/AboutPage";
import { MobileAppPage } from "./pages/public/MobileAppPage";
import { PortfolioDashboardPage } from "./pages/dashboard/PortfolioDashboardPage";
import { PortfolioExecutivePage } from "./pages/dashboard/PortfolioExecutivePage";
import { ProjectsDirectoryPage } from "./pages/projects/ProjectsDirectoryPage";
import { CreateProjectPage } from "./pages/projects/CreateProjectPage";
import { ReconciliationWorkbenchPage } from "./pages/reconciliation/ReconciliationWorkbenchPage";
import { BoqAndHoldPointsPage } from "./pages/boq/BoqAndHoldPointsPage";
import { AuditLedgerPage } from "./pages/audit/AuditLedgerPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { Toaster } from "sonner";
import { useProjectsQuery } from "./queries/projects/useProjectsQueries";
import { useProjectBoqQuery } from "./queries/boq/useBoqQueries";
import { useProjectEvidenceQuery } from "./queries/evidence/useEvidenceQueries";
import { useProjectIpcsQuery } from "./queries/reconciliation/useReconciliationQueries";
import { downloadValuationReportPdf } from "./api/reconciliation/reconciliationApi";

function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

function AuthenticatedWorkspace() {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
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

  const boqQuery = useProjectBoqQuery(
    activeProject?.id,
    Boolean(user && activeProject?.id),
  );
  const evidenceQuery = useProjectEvidenceQuery(
    activeProject?.id,
    Boolean(user && activeProject?.id),
  );
  const ipcsQuery = useProjectIpcsQuery(
    activeProject?.id,
    Boolean(user && activeProject?.id),
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
      user?.role === "CONTRACTOR" && subRoute === "audit"
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

  const headerActions = (
    <>
      {selectedIpc && activeProject && user.role !== "CONTRACTOR" && (
        <button
          type="button"
          onClick={() =>
            downloadValuationReportPdf(activeProject.id, selectedIpc.id)
          }
          className="px-3.5 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition shadow-sm backdrop-blur-sm"
        >
          Export Valuation PDF
        </button>
      )}
      {user.role === "MONITOR" && (
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

  const isCreatingNewProject =
    projectMatch?.params.projectId === "new" ||
    location.pathname.endsWith("/projects/new");

  return (
    <AppShell
      projects={projects}
      selectedProject={activeProject}
      onSelectProject={handleSelectProject}
      openConflictBadgeCount={activeProject?.openConflictCount ?? 0}
      headerActions={headerActions}
    >
      {isCreatingNewProject ? (
        user.role === "MONITOR" ? (
          <CreateProjectPage
            cancelFallbackPath={
              activeProject
                ? `/app/projects/${activeProject.id}/projects`
                : "/app/projects"
            }
            onProjectCreated={(created) => {
              setSelectedProjectId(created.id);
              navigate(`/app/projects/${created.id}/boq`);
            }}
          />
        ) : (
          <Navigate
            to={
              activeProject
                ? `/app/projects/${activeProject.id}/dashboard`
                : "/app/projects"
            }
            replace
          />
        )
      ) : !activeProject ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center justify-center gap-3 text-xs text-slate-500">
          {projectsQuery.isLoading ? (
            <>
              <Loader size="sm" />
              <span>Loading capital projects...</span>
            </>
          ) : (
            "No capital projects found."
          )}
        </div>
      ) : (
        <Routes>
          <Route
            index
            element={
              <Navigate
                to={`/app/projects/${activeProject.id}/dashboard`}
                replace
              />
            }
          />
          <Route
            path="projects"
            element={
              <ProjectsDirectoryPage
                projects={projects}
                selectedProjectId={activeProject.id}
                onSelectProject={setSelectedProjectId}
                onNewProject={() => navigate("/app/projects/new")}
              />
            }
          />
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
              <ReconciliationWorkbenchPage
                project={activeProject}
                ipcs={ipcs}
                selectedIpc={selectedIpc}
                onSelectIpc={handleSelectIpc}
                boqItems={boqQuery.data || []}
                evidenceLogs={evidenceQuery.data || []}
              />
            }
          />
          <Route
            path="projects/:projectId/boq"
            element={
              <BoqAndHoldPointsPage
                project={activeProject}
                boqItems={boqQuery.data || []}
              />
            }
          />
          <Route
            path="projects/:projectId/audit"
            element={
              user.role === "CONTRACTOR" ? (
                <Navigate
                  to={`/app/projects/${activeProject.id}/dashboard`}
                  replace
                />
              ) : (
                <AuditLedgerPage project={activeProject} />
              )
            }
          />
          <Route
            path="executive"
            element={
              user.role === "CONTRACTOR" ? (
                <Navigate
                  to={`/app/projects/${activeProject.id}/dashboard`}
                  replace
                />
              ) : (
                <PortfolioExecutivePage
                  onSelectProject={(projectId) => {
                    setSelectedProjectId(projectId);
                    navigate(`/app/projects/${projectId}/dashboard`);
                  }}
                />
              )
            }
          />
          <Route
            path="settings"
            element={<SettingsPage project={activeProject} />}
          />

          {/* Legacy non-scoped route redirects */}
          <Route
            path="dashboard"
            element={
              <Navigate
                to={`/app/projects/${activeProject.id}/dashboard`}
                replace
              />
            }
          />
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
            element={
              <Navigate to={`/app/projects/${activeProject.id}/boq`} replace />
            }
          />
          <Route
            path="audit"
            element={
              <Navigate
                to={`/app/projects/${activeProject.id}/audit`}
                replace
              />
            }
          />
          <Route
            path="*"
            element={
              <Navigate
                to={`/app/projects/${activeProject.id}/dashboard`}
                replace
              />
            }
          />
        </Routes>
      )}
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
