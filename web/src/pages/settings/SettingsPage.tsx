import React, { useState, useMemo } from "react";
import { ShieldCheck, User, KeyRound, Users, Palette, Building2, Workflow, Layers, UserCheck } from "lucide-react";
import { ProjectTypesTab } from "../../components/deliveryModels/ProjectTypesTab";
import { SupervisorsCard } from "../../components/supervision/SupervisorsCard";
import { RegionsCard } from "../../components/deliveryModels/RegionsCard";
import { DocumentTypesCard } from "../../components/documents/DocumentTypesCard";
import { TerminologyCard } from "../../components/deliveryModels/TerminologyCard";
import { toast } from "sonner";
import type { FieldSessionRosterDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { useGuardedAction } from "../../lib/navigationGuard";
import { formatDateTimeShort } from "../../lib/formatters";
import { useProjectFieldSessionsQuery } from "../../queries/rbac/useRbacQueries";
import { useUpdateFieldSessionStatusMutation } from "../../mutations/rbac/useRbacMutations";
import { RolesPermissionsTab } from "../../components/rbac/RolesPermissionsTab";
import { UsersVisibilityTab } from "../../components/rbac/UsersVisibilityTab";
import { TenantBrandingTab } from "../../components/rbac/TenantBrandingTab";
import { RatingCriteriaCard } from "../../components/closure/RatingCriteriaCard";
import { OrganizationsTab } from "../../components/rbac/OrganizationsTab";
import { WorkspaceSettingsCard } from "../../components/rbac/WorkspaceSettingsCard";
import { MobileDevicesPanel } from "../../components/rbac/MobileDevicesPanel";
import { WorkflowTemplatesTab } from "../../components/process/WorkflowTemplatesTab";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableActionMenu,
  TableColumnDef,
} from "../../components/table";

interface SettingsPageProps {
  project: ProjectSummaryDto | null;
}

export function SettingsPage({ project }: SettingsPageProps) {
  const { user, hasPermission, changePassword } = useAuth();
  const canManageRoles = hasPermission("roles:create_edit");
  const canManageUsers = hasPermission("users:invite_manage");
  const canManageBranding = hasPermission("tenant:manage_branding");
  const canManageSettings = hasPermission("tenant:manage_settings");
  const canSeeTenantTab = canManageBranding || canManageSettings;
  const canManageOrganizations = hasPermission("organizations:manage");
  const canManageWorkflows = hasPermission("templates:manage_workflows");
  const canRevokeDevices = hasPermission("sessions:revoke_device");
  const canViewRoster = hasPermission("sessions:revoke_device");
  const canSeeAccessTab = canViewRoster;
  // Phase 11: delivery models (project types and regions).
  const canManageProjectTypes = hasPermission("project_types:manage");
  const canManageRegions = hasPermission("regions:manage");
  // Phase 13: tenant document types sit with the delivery-model settings.
  const canManageDocumentTypes = hasPermission("documents:manage_types");
  const canSeeDeliveryTab = canManageProjectTypes || canManageRegions || canManageDocumentTypes;
  // Redesign R6b: the facility catalogue and the form library moved to the tenant page /app/forms.

  // Phase 14: the supervisors view (redesign R5f: the legacy inspection settings are gone).
  const canSeeSupervisorsTab = hasPermission("inspections:view");

  type SettingsTab = "ACCESS" | "ROLES" | "USERS" | "ORGANIZATIONS" | "WORKFLOWS" | "DELIVERY" | "SUPERVISORS" | "BRANDING" | "ACCOUNT";
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    canSeeAccessTab
      ? "ACCESS"
      : canManageRoles
        ? "ROLES"
        : canManageUsers
          ? "USERS"
          : canManageOrganizations
            ? "ORGANIZATIONS"
            : canManageWorkflows
              ? "WORKFLOWS"
              : canSeeDeliveryTab
              ? "DELIVERY"
              : canSeeSupervisorsTab
              ? "SUPERVISORS"
              : canSeeTenantTab
              ? "BRANDING"
              : "ACCOUNT",
  );
  // Leaving a tab unmounts its editor: ask first when it has unsaved changes (useLeaveGuard).
  const requestLeave = useGuardedAction();
  const selectTab = (tab: SettingsTab) => {
    if (tab !== activeTab) requestLeave(() => setActiveTab(tab));
  };

  // Only fetch what the user is allowed to see.
  const { data: fieldAgents = [], isLoading: sessionsLoading } =
    useProjectFieldSessionsQuery(project?.id || "", Boolean(project?.id) && canViewRoster);
  const updateSessionMutation = useUpdateFieldSessionStatusMutation(
    project?.id || "",
  );

  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterStatusFilter, setRosterStatusFilter] = useState<
    "ALL" | "ACTIVE" | "REVOKED"
  >("ALL");

  const filteredFieldAgents = useMemo(() => {
    return fieldAgents.filter((agent) => {
      const term = rosterSearch.toLowerCase();
      const matchesSearch =
        agent.agentFullName.toLowerCase().includes(term) ||
        agent.roleName.toLowerCase().includes(term) ||
        (agent.userEmail ?? "").toLowerCase().includes(term) ||
        agent.agentPhoneNumber.toLowerCase().includes(term);

      const matchesStatus =
        rosterStatusFilter === "ALL" ||
        (rosterStatusFilter === "ACTIVE" && agent.isActive) ||
        (rosterStatusFilter === "REVOKED" && !agent.isActive);

      return matchesSearch && matchesStatus;
    });
  }, [fieldAgents, rosterSearch, rosterStatusFilter]);

  const rosterColumns: TableColumnDef<FieldSessionRosterDto>[] = useMemo(
    () => [
      {
        id: "agent",
        header: "Agent & Role",
        tooltip:
          "Authorized field engineer or inspector registered on this project",
        width: "w-64",
        cell: (agent) => (
          <div>
            <div className="font-bold text-slate-900">
              {agent.agentFullName}
            </div>
            <div className="text-[11px] text-slate-500">
              {agent.roleName} · {agent.deviceModel || agent.deviceId}
            </div>
          </div>
        ),
      },
      {
        id: "persona",
        header: "Assurance Persona",
        tooltip:
          "Role persona & corroboration weight assigned to evidence from this mobile session",
        width: "w-52",
        cell: (agent) => (
          <TableBadge
            variant={
              agent.fieldPersonaType === "INDEPENDENT_VERIFIER"
                ? "info"
                : "neutral"
            }
          >
            {agent.fieldPersonaType === "INDEPENDENT_VERIFIER"
              ? `Independent (${agent.assuranceWeight.toFixed(1)}x)`
              : `Weight ${agent.assuranceWeight.toFixed(1)}x`}
          </TableBadge>
        ),
      },
      {
        id: "account",
        header: "Account",
        tooltip: "The account signed in on this device",
        width: "w-44",
        cell: (agent) => (
          <span className="text-slate-600">{agent.userEmail ?? "—"}</span>
        ),
      },
      {
        id: "phone",
        header: "Phone",
        tooltip: "Registered contact number for device verification challenges",
        width: "w-36",
        cell: (agent) => (
          <span className="text-slate-600">{agent.agentPhoneNumber}</span>
        ),
      },
      {
        id: "lastActive",
        header: "Last Activity",
        tooltip:
          "Most recent geotagged evidence capture or sync received from this device",
        width: "w-36",
        cell: (agent) => (
          <span className="text-slate-500 whitespace-nowrap">
            {formatDateTimeShort(agent.lastSyncAt || agent.createdAt)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Access Status",
        tooltip: "Whether mobile app upload permissions are active or revoked",
        width: "w-32",
        cell: (agent) => (
          <TableBadge variant={agent.isActive ? "success" : "danger"}>
            {agent.isActive ? "Active Session" : "Access Revoked"}
          </TableBadge>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        tooltip: "Manage field agent permissions and device credentials",
        align: "right",
        width: "w-36",
        cell: (agent) => {
          if (!canRevokeDevices) return null;

          return (
            <div className="flex items-center justify-end gap-1.5">
              <TableActionButton
                onClick={() =>
                  handleToggleAgentStatus(agent.id, !agent.isActive)
                }
                variant={agent.isActive ? "danger" : "default"}
              >
                {agent.isActive ? "Revoke" : "Restore"}
              </TableActionButton>
              <TableActionMenu
                actions={[
                  {
                    label: agent.isActive ? "Revoke Access" : "Restore Access",
                    variant: agent.isActive ? "danger" : "default",
                    onClick: () =>
                      handleToggleAgentStatus(agent.id, !agent.isActive),
                  },
                ]}
              />
            </div>
          );
        },
      },
    ],
    [canRevokeDevices],
  );

  // Account / Security Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const handleToggleAgentStatus = async (
    agentId: string,
    nextActive: boolean,
  ) => {
    if (!project?.id) return;
    await updateSessionMutation.mutateAsync({
      sessionId: agentId,
      payload: { isActive: nextActive },
    });
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error("Please enter your current and new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match.");
      return;
    }
    try {
      setSavingPassword(true);
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">
              Governance &amp; App Settings
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-brand-primary/5 text-brand-primary border border-brand-primary/25">
              {user?.roleName || "Workspace Controls"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Manage mobile field access, roles &amp; permissions,
            tenant branding, and your account.
          </p>
        </div>
      </div>

      {/* Tab Switcher Pills */}
      <div className="w-fit">
        <div className="flex flex-wrap items-center bg-slate-100 p-1 rounded-xl self-start md:self-auto gap-1">
          {canSeeAccessTab && (
          <button
            type="button"
            onClick={() => selectTab("ACCESS")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === "ACCESS"
                ? "bg-white text-brand-primary shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Field access</span>
          </button>
          )}

          {canManageRoles && (
            <button
              type="button"
              onClick={() => selectTab("ROLES")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "ROLES"
                  ? "bg-white text-brand-primary shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Roles &amp; Permissions</span>
            </button>
          )}

          {canManageUsers && (
            <button
              type="button"
              onClick={() => selectTab("USERS")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "USERS"
                  ? "bg-white text-brand-primary shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Users &amp; Visibility</span>
            </button>
          )}

          {canManageOrganizations && (
            <button
              type="button"
              onClick={() => selectTab("ORGANIZATIONS")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "ORGANIZATIONS"
                  ? "bg-white text-brand-primary shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Organisations</span>
            </button>
          )}

          {canManageWorkflows && (
            <button
              type="button"
              onClick={() => selectTab("WORKFLOWS")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "WORKFLOWS"
                  ? "bg-white text-brand-primary shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Workflow className="w-4 h-4" />
              <span>Workflow templates</span>
            </button>
          )}

          {canSeeDeliveryTab && (
            <button
              type="button"
              onClick={() => selectTab("DELIVERY")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "DELIVERY"
                  ? "bg-white text-brand-primary shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Project types, regions &amp; documents</span>
            </button>
          )}

          {canSeeSupervisorsTab && (
            <button
              type="button"
              onClick={() => selectTab("SUPERVISORS")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "SUPERVISORS"
                  ? "bg-white text-brand-primary shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Supervisors</span>
            </button>
          )}

          {canSeeTenantTab && (
            <button
              type="button"
              onClick={() => selectTab("BRANDING")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "BRANDING"
                  ? "bg-white text-brand-primary shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Palette className="w-4 h-4" />
              <span>Tenant Settings</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => selectTab("ACCOUNT")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === "ACCOUNT"
                ? "bg-white text-brand-primary shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <User className="w-4 h-4" />
            <span>Account &amp; Security</span>
          </button>
        </div>
      </div>

      {activeTab === "ROLES" && canManageRoles && <RolesPermissionsTab />}
      {activeTab === "USERS" && canManageUsers && <UsersVisibilityTab />}
      {activeTab === "ORGANIZATIONS" && canManageOrganizations && <OrganizationsTab />}
      {activeTab === "WORKFLOWS" && canManageWorkflows && <WorkflowTemplatesTab />}
      {activeTab === "DELIVERY" && canSeeDeliveryTab && (
        <div className="space-y-4">
          {canManageProjectTypes && <ProjectTypesTab />}
          {canManageRegions && <RegionsCard />}
          {canManageDocumentTypes && <DocumentTypesCard />}
        </div>
      )}
      {activeTab === "SUPERVISORS" && canSeeSupervisorsTab && (
        <div className="space-y-4">
          <SupervisorsCard />
        </div>
      )}
      {activeTab === "BRANDING" && canSeeTenantTab && (
        <div className="space-y-4">
          {canManageBranding && <TenantBrandingTab />}
          {canManageSettings && <WorkspaceSettingsCard />}
          {canManageSettings && <RatingCriteriaCard />}
          {canManageSettings && <TerminologyCard />}
        </div>
      )}

      {/* 2. TAB A: Field access (mobile sessions and devices) */}
      {activeTab === "ACCESS" && canSeeAccessTab && (
        <div className="space-y-4">
          {/* Active Field Agent Roster & Revocation Standard Table */}
          {canViewRoster && (
          <StandardTable<FieldSessionRosterDto>
            title={
              <div className="flex items-center gap-2.5">
                <span>Active Mobile Field Personnel</span>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-white/90 border border-white/15">
                  {sessionsLoading
                    ? "Loading..."
                    : `${fieldAgents.length} Enrolled Devices`}
                </span>
              </div>
            }
            subtitle="Field accounts signed in on a device for this project: visits, geotagged photos and voice notes"
            search={{
              value: rosterSearch,
              onChange: setRosterSearch,
              placeholder: "Search agent name, role, account, or phone...",
            }}
            filters={
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setRosterStatusFilter("ALL")}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                    rosterStatusFilter === "ALL"
                      ? "bg-brand-navy text-white shadow-2xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  All ({fieldAgents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterStatusFilter("ACTIVE")}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                    rosterStatusFilter === "ACTIVE"
                      ? "bg-emerald-600 text-white shadow-2xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  Active Sessions (
                  {fieldAgents.filter((a) => a.isActive).length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterStatusFilter("REVOKED")}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                    rosterStatusFilter === "REVOKED"
                      ? "bg-rose-600 text-white shadow-2xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  Revoked ({fieldAgents.filter((a) => !a.isActive).length})
                </button>
              </div>
            }
            columns={rosterColumns}
            data={filteredFieldAgents}
            keyExtractor={(item) => item.id}
            emptyState={{
              title: "No field agents match your search",
              description:
                "Try adjusting the keyword search or active status filter.",
            }}
          />
          )}

          {(canRevokeDevices || canManageUsers) && (
            <MobileDevicesPanel canRevoke={canRevokeDevices} />
          )}
        </div>
      )}

      {/* Account & Security */}
      {activeTab === "ACCOUNT" && (
        <div className="space-y-4">
          {/* Active Profile Summary */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              Professional Profile
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">
                  Full Name
                </span>
                <span className="font-bold text-slate-900">
                  {user?.fullName || "User"}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">
                  Corporate Email
                </span>
                <span className="font-bold text-slate-900">
                  {user?.email || "—"}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">
                  Organization
                </span>
                <span className="font-bold text-slate-900">
                  {user?.organizationName || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Change Password */}
          <form
            onSubmit={handlePasswordSubmit}
            className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Change Password
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  At least 10 characters, with a letter and a number. Changing it
                  signs out your other sessions.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
            >
              {savingPassword ? "Saving..." : "Update Password"}
            </button>
          </form>

        </div>
      )}
    </div>
  );
}
