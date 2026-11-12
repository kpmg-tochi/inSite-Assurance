import React, { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { CreateProjectRequest } from "@insite/shared";
import { useAuth } from "./lib/auth-context";
import { AppShell } from "./components/AppShell";
import Loader from "./components/Loader";
import { LoginPage } from "./pages/auth/LoginPage";
import { HomePage } from "./pages/public/HomePage";
import { AboutPage } from "./pages/public/AboutPage";
import { MobileAppPage } from "./pages/public/MobileAppPage";
import { PortfolioDashboardPage } from "./pages/dashboard/PortfolioDashboardPage";
import { PortfolioExecutivePage } from "./pages/dashboard/PortfolioExecutivePage";
import { ReconciliationWorkbenchPage } from "./pages/reconciliation/ReconciliationWorkbenchPage";
import { BoqAndHoldPointsPage } from "./pages/boq/BoqAndHoldPointsPage";
import { AuditLedgerPage } from "./pages/audit/AuditLedgerPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { Toaster } from "sonner";
import { useProjectsQuery } from "./queries/projects/useProjectsQueries";
import { useProjectBoqQuery } from "./queries/boq/useBoqQueries";
import { useProjectEvidenceQuery } from "./queries/evidence/useEvidenceQueries";
import { useProjectIpcsQuery } from "./queries/reconciliation/useReconciliationQueries";
import { useCreateProjectMutation } from "./mutations/projects/useProjectsMutations";
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

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedIpcId, setSelectedIpcId] = useState<string | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  const projectsQuery = useProjectsQuery(Boolean(user));
  const projects = projectsQuery.data || [];

  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const activeProject =
    projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

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

  const createProjectMutation = useCreateProjectMutation();

  const ipcs = ipcsQuery.data || [];

  useEffect(() => {
    if (ipcs.length > 0) {
      const stillValid = ipcs.some((i) => i.id === selectedIpcId);
      if (!stillValid) {
        setSelectedIpcId(ipcs[0].id);
      }
    } else {
      setSelectedIpcId(null);
    }
  }, [ipcs, selectedIpcId]);

  const selectedIpc =
    ipcs.find((i) => i.id === selectedIpcId) || ipcs[0] || null;

  const handleCreateProject = async (payload: CreateProjectRequest) => {
    const created = await createProjectMutation.mutateAsync(payload);
    setSelectedProjectId(created.id);
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
          onClick={() => {
            navigate("/app/dashboard");
            setShowNewProjectModal(true);
          }}
          className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-brand-navy text-xs font-bold transition shadow-sm"
        >
          + New Project
        </button>
      )}
    </>
  );

  return (
    <AppShell
      projects={projects}
      selectedProject={activeProject}
      onSelectProject={(projectId) => setSelectedProjectId(projectId)}
      openConflictBadgeCount={activeProject?.openConflictCount ?? 0}
      headerActions={headerActions}
    >
      {!activeProject ? (
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
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route
            path="dashboard"
            element={
              <PortfolioDashboardPage
                project={activeProject}
                evidenceLogs={evidenceQuery.data || []}
                latestIpc={selectedIpc}
                onNavigateToReconciliation={() =>
                  navigate("/app/reconciliation")
                }
                onCreateProject={handleCreateProject}
                showNewProjectModal={showNewProjectModal}
                onCloseNewProjectModal={() => setShowNewProjectModal(false)}
              />
            }
          />
          <Route
            path="executive"
            element={
              user.role === "CONTRACTOR" ? (
                <Navigate to="/app/dashboard" replace />
              ) : (
                <PortfolioExecutivePage
                  onSelectProject={(projectId) => {
                    setSelectedProjectId(projectId);
                    navigate("/app/dashboard");
                  }}
                />
              )
            }
          />
          <Route
            path="reconciliation"
            element={
              <ReconciliationWorkbenchPage
                project={activeProject}
                ipcs={ipcs}
                selectedIpc={selectedIpc}
                onSelectIpc={setSelectedIpcId}
                boqItems={boqQuery.data || []}
                evidenceLogs={evidenceQuery.data || []}
              />
            }
          />
          <Route
            path="boq"
            element={
              <BoqAndHoldPointsPage
                project={activeProject}
                boqItems={boqQuery.data || []}
              />
            }
          />
          <Route
            path="audit"
            element={
              user.role === "CONTRACTOR" ? (
                <Navigate to="/app/dashboard" replace />
              ) : (
                <AuditLedgerPage project={activeProject} />
              )
            }
          />
          <Route
            path="settings"
            element={<SettingsPage project={activeProject} />}
          />
          <Route path="*" element={<Navigate to="dashboard" replace />} />
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
