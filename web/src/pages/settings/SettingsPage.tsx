import React, { useState, useMemo } from "react";
import { ShieldCheck, User, KeyRound, Users, Palette, Building2 } from "lucide-react";
import { toast } from "sonner";
import type { FieldSessionRosterDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import {
  formatDateTimeShort,
  formatLicenseCredential,
} from "../../lib/formatters";
import ContractorVerificationQueue from "../../components/ContractorVerificationQueue";
import { useContractorVerificationsQuery } from "../../queries/projects/useContractorVerificationQueries";
import { useProjectFieldSessionsQuery } from "../../queries/rbac/useRbacQueries";
import { useUpdateFieldSessionStatusMutation } from "../../mutations/rbac/useRbacMutations";
import { RolesPermissionsTab } from "../../components/rbac/RolesPermissionsTab";
import { UsersVisibilityTab } from "../../components/rbac/UsersVisibilityTab";
import { TenantBrandingTab } from "../../components/rbac/TenantBrandingTab";
import { EvidenceRatingsCard } from "../../components/rbac/EvidenceRatingsCard";
import { OrganizationsTab } from "../../components/rbac/OrganizationsTab";
import { WorkspaceSettingsCard } from "../../components/rbac/WorkspaceSettingsCard";
import { JoinCodesPanel } from "../../components/JoinCodesPanel";
import { MobileDevicesPanel } from "../../components/rbac/MobileDevicesPanel";
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
  const { user, hasPermission, hasAnyPermission, changePassword } = useAuth();
  const canManageRoles = hasPermission("roles:create_edit");
  const canManageUsers = hasPermission("users:invite_manage");
  const canManageBranding = hasPermission("tenant:manage_branding");
  const canManageSettings = hasPermission("tenant:manage_settings");
  const canSeeTenantTab = canManageBranding || canManageSettings;
  const canManageOrganizations = hasPermission("organizations:manage");
  const canRevokeDevices = hasPermission("sessions:revoke_device");
  const canReviewCredentials = hasPermission("assurance:review_credentials");
  const canManageRoster = hasPermission("mobilization:manage_roster");
  const canViewRoster = hasAnyPermission("sessions:revoke_device", "mobilization:manage_roster");
  const canSeeAccessTab = canReviewCredentials || canViewRoster;

  type SettingsTab = "ACCESS" | "ROLES" | "USERS" | "ORGANIZATIONS" | "BRANDING" | "ACCOUNT";
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    canSeeAccessTab
      ? "ACCESS"
      : canManageRoles
        ? "ROLES"
        : canManageUsers
          ? "USERS"
          : canManageOrganizations
            ? "ORGANIZATIONS"
            : canSeeTenantTab
              ? "BRANDING"
              : "ACCOUNT",
  );

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
        (agent.joinCodeUsed ?? agent.userEmail ?? "").toLowerCase().includes(term) ||
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
              : `Contractor (${agent.assuranceWeight.toFixed(1)}x)`}
          </TableBadge>
        ),
      },
      {
        id: "joinCode",
        header: "How They Joined",
        tooltip:
          "A project join code, or a pre-provisioned account signed in on this device",
        width: "w-44",
        cell: (agent) =>
          agent.origin === "PROVISIONED_ACCOUNT" ? (
            <div>
              <TableBadge variant="success">Signed-in account</TableBadge>
              <div className="text-[11px] text-slate-500 mt-0.5">{agent.userEmail}</div>
            </div>
          ) : (
            <span className="font-semibold text-brand-primary">
              {agent.joinCodeUsed}
            </span>
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
                  ...(agent.joinCodeUsed
                    ? [
                        {
                          label: "Copy Join Code",
                          onClick: () => {
                            navigator.clipboard?.writeText(agent.joinCodeUsed!);
                            toast.success(`Copied join code ${agent.joinCodeUsed}`);
                          },
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          );
        },
      },
    ],
    [canRevokeDevices],
  );

  // Contractor Verifications from API
  const { data: verifications = [] } = useContractorVerificationsQuery(
    project?.id || "all",
    canReviewCredentials,
  );
  const pendingCount = verifications.filter(
    (v) => v.assuranceStatus === "PENDING_APPROVAL",
  ).length;

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
            Manage mobile field agent credentials, roles &amp; permissions,
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
            onClick={() => setActiveTab("ACCESS")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === "ACCESS"
                ? "bg-white text-brand-primary shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Access &amp; Assurance</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
          )}

          {canManageRoles && (
            <button
              type="button"
              onClick={() => setActiveTab("ROLES")}
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
              onClick={() => setActiveTab("USERS")}
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
              onClick={() => setActiveTab("ORGANIZATIONS")}
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

          {canSeeTenantTab && (
            <button
              type="button"
              onClick={() => setActiveTab("BRANDING")}
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
            onClick={() => setActiveTab("ACCOUNT")}
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
      {activeTab === "BRANDING" && canSeeTenantTab && (
        <div className="space-y-4">
          {canManageBranding && <TenantBrandingTab />}
          {canManageSettings && <WorkspaceSettingsCard />}
          {canManageSettings && <EvidenceRatingsCard />}
        </div>
      )}

      {/* 2. TAB A: Access Management & Contractor Assurance */}
      {activeTab === "ACCESS" && canSeeAccessTab && (
        <div className="space-y-4">
          {/* Assurance Value Proposition Notice */}
          <div className="bg-brand-primary/5 border border-brand-primary/25 rounded-2xl p-4 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
            <div className="text-xs text-brand-navy/90 leading-relaxed">
              <strong className="font-bold text-brand-navy block mb-0.5">
                Contractor Identity &amp; Competence Assurance
              </strong>
              Contractors joining via mobile submit a government photo ID, a
              guided selfie set (3 poses) and proof of professional
              qualifications (COREN / QSRBN). A reviewer compares them by eye;
              no automated liveness check is run. Reports from a contractor are
              held until the review is approved.
            </div>
          </div>

          {/* Pending Contractor Onboarding Approvals Queue */}
          {canReviewCredentials && (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
              <ContractorVerificationQueue projectId={project?.id || "all"} />
            </div>
          )}

          {canManageRoster && project && (
            <JoinCodesPanel projectId={project.id} projectCode={project.codePrefix} />
          )}

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
            subtitle="Field agents authorized to submit geotagged photos, audio notes, and Hold-Point logs"
            search={{
              value: rosterSearch,
              onChange: setRosterSearch,
              placeholder: "Search agent name, role, code, or phone...",
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
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
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">
                  Professional Credential
                </span>
                <span className="font-bold text-brand-primary">
                  {formatLicenseCredential(
                    user?.professionalLicenseType,
                    user?.professionalLicenseNumber,
                  )}
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
