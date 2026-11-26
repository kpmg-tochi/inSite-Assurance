import { useState, useMemo } from "react";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { ChangePasswordFormSchema } from "../auth/ChangePasswordPage";
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
import { Tabs, TabPanel, TAB_LIST_CLASS, tabCountClass, tabItemClass, useUrlTab } from "../../components/common/Tabs";
import { FormsFacilitiesSettings } from "../forms/FormsFacilitiesPage";
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableActionMenu,
  TableColumnDef,
} from "../../components/table";

/**
 * Settings sections that can be hidden without removing them. Every hidden section keeps its
 * component, permission checks and data hooks; it is only not rendered (and not fetched).
 */
type HideableSection =
  | "field-access" // tab: mobile field sessions and devices
  | "roles" // tab: roles & permissions
  | "organisations" // tab: organisations
  | "workflows" // tab: workflow templates
  | "regions" // card in Project types
  | "document-types" // card in Project types
  | "tenant"; // tab: branding, workspace settings, rating criteria, terminology

/**
 * UBEC demo: hidden for now, not deleted. To bring a section back, remove its id from this list
 * (one line); its tab or card reappears for users who hold its permission.
 */
const HIDDEN_SETTINGS_SECTIONS: ReadonlySet<HideableSection> = new Set<HideableSection>([
  "field-access",
  "roles",
  "organisations",
  "workflows",
  "regions",
  "document-types",
  "tenant",
]);
const isShown = (section: HideableSection) => !HIDDEN_SETTINGS_SECTIONS.has(section);

/** Tab ids are part of URLs (`/app/settings?tab=forms` is the target of `/app/forms`): keep them stable. */
type SettingsTab =
  | "users"
  | "roles"
  | "organisations"
  | "project-types"
  | "forms"
  | "workflows"
  | "supervisors"
  | "field-access"
  | "tenant"
  | "account";

const TAB_LABEL: Record<SettingsTab, string> = {
  users: "Users & visibility",
  roles: "Roles & permissions",
  organisations: "Organisations",
  "project-types": "Project types",
  forms: "Forms & facilities",
  workflows: "Workflow templates",
  supervisors: "Supervisors",
  "field-access": "Field access",
  tenant: "Workspace",
  account: "Account",
};

/** What each tab covers, joined into the page description so it names only what is visible. */
const TAB_SUMMARY: Record<SettingsTab, string> = {
  users: "users and what they can see",
  roles: "roles",
  organisations: "organisations",
  "project-types": "project types",
  forms: "forms and facilities",
  workflows: "workflow templates",
  supervisors: "supervisor workload",
  "field-access": "field devices",
  tenant: "workspace settings",
  account: "your account",
};

const TAB_PREFIX = "settings";

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

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
  const canRevokeDevices = hasPermission("users:revoke_device");
  const canViewRoster = hasPermission("users:revoke_device");
  const canSeeAccessTab = canViewRoster;
  // Phase 11: delivery models (project types and regions). The Direct Intervention and Matching
  // Grants rules are project types.
  const canManageProjectTypes = hasPermission("project_types:manage");
  const canManageRegions = hasPermission("regions:manage");
  // Phase 13: tenant document types sit with the delivery-model settings.
  const canManageDocumentTypes = hasPermission("documents:manage_types");
  const showRegions = isShown("regions") && canManageRegions;
  const showDocumentTypes = isShown("document-types") && canManageDocumentTypes;
  // The facility catalogue and the form library (UBEC: back in Settings from /app/forms).
  const canSeeFormsTab = hasPermission("facilities:manage") || hasPermission("forms:manage");
  // Phase 14: the supervisors view (redesign R5f: the legacy inspection settings are gone).
  const canSeeSupervisorsTab = hasPermission("visits:view");

  const tabAccess: Record<SettingsTab, boolean> = {
    users: canManageUsers,
    roles: isShown("roles") && canManageRoles,
    organisations: isShown("organisations") && canManageOrganizations,
    "project-types": canManageProjectTypes || showRegions || showDocumentTypes,
    forms: canSeeFormsTab,
    workflows: isShown("workflows") && canManageWorkflows,
    supervisors: canSeeSupervisorsTab,
    "field-access": isShown("field-access") && canSeeAccessTab,
    tenant: isShown("tenant") && canSeeTenantTab,
    account: true,
  };
  const tabOrder: SettingsTab[] = [
    "users",
    "roles",
    "organisations",
    "project-types",
    "forms",
    "workflows",
    "supervisors",
    "field-access",
    "tenant",
    "account",
  ];
  const visibleTabs = tabOrder.filter((id) => tabAccess[id]);
  const [activeTab, setActiveTab] = useUrlTab<SettingsTab>(visibleTabs);

  // Leaving a tab unmounts its editor: ask first when it has unsaved changes (useLeaveGuard).
  const requestLeave = useGuardedAction();
  const selectTab = (tab: SettingsTab) => {
    if (tab !== activeTab) requestLeave(() => setActiveTab(tab));
  };

  // Only fetch what the user is allowed to see.
  const { data: fieldAgents = [], isLoading: sessionsLoading } = useProjectFieldSessionsQuery(
    project?.id || "",
    Boolean(project?.id) && tabAccess["field-access"],
  );
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
          <span className="text-slate-600">
            {agent.fieldPersonaType === "INDEPENDENT_VERIFIER"
              ? `Independent (${agent.assuranceWeight.toFixed(1)}x)`
              : `Weight ${agent.assuranceWeight.toFixed(1)}x`}
          </span>
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

  // Account / Security form: the change-password contract plus the confirmation.
  const passwordDefaults = { currentPassword: "", newPassword: "", confirmPassword: "" };
  const passwordForm = useZodForm(ChangePasswordFormSchema, { defaultValues: passwordDefaults });

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

  const handlePasswordSubmit = passwordForm.handleSubmit(async (values) => {
    try {
      await changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      passwordForm.reset(passwordDefaults);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change your password.");
    }
  });

  const passwordInput =
    "w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Settings</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Manage {joinWithAnd(visibleTabs.map((id) => TAB_SUMMARY[id]))}.
        </p>
      </div>

      {activeTab && visibleTabs.length > 1 && (
        <Tabs
          tabs={visibleTabs.map((id) => ({ id, label: TAB_LABEL[id] }))}
          active={activeTab}
          onChange={selectTab}
          label="Settings"
          idPrefix={TAB_PREFIX}
        />
      )}

      {activeTab && (
        <TabPanel idPrefix={TAB_PREFIX} id={activeTab}>
          {activeTab === "users" && <UsersVisibilityTab />}
          {activeTab === "roles" && <RolesPermissionsTab />}
          {activeTab === "organisations" && <OrganizationsTab />}
          {activeTab === "workflows" && <WorkflowTemplatesTab />}
          {activeTab === "project-types" && (
            <div className="space-y-4">
              {canManageProjectTypes && <ProjectTypesTab />}
              {showRegions && <RegionsCard />}
              {showDocumentTypes && <DocumentTypesCard />}
            </div>
          )}
          {activeTab === "forms" && <FormsFacilitiesSettings />}
          {activeTab === "supervisors" && <SupervisorsCard />}
          {activeTab === "tenant" && (
            <div className="space-y-4">
              {canManageBranding && <TenantBrandingTab />}
              {canManageSettings && <WorkspaceSettingsCard />}
              {canManageSettings && <RatingCriteriaCard />}
              {canManageSettings && <TerminologyCard />}
            </div>
          )}

          {/* Field access (mobile sessions and devices) */}
          {activeTab === "field-access" && (
            <div className="space-y-4">
              <StandardTable<FieldSessionRosterDto>
                title={
                  <span>
                    Active Mobile Field Personnel
                    <span className="ml-2 font-normal text-white/80">
                      {sessionsLoading ? "Loading…" : `${fieldAgents.length} devices`}
                    </span>
                  </span>
                }
                subtitle="Field accounts signed in on a device for this project: monitoring visits, geotagged photos and voice notes"
                search={{
                  value: rosterSearch,
                  onChange: setRosterSearch,
                  placeholder: "Search agent name, role, account, or phone...",
                }}
                filters={
                  <div role="group" aria-label="Show sessions" className={TAB_LIST_CLASS}>
                    {(
                      [
                        ["ALL", "All", fieldAgents.length],
                        ["ACTIVE", "Active", fieldAgents.filter((a) => a.isActive).length],
                        ["REVOKED", "Revoked", fieldAgents.filter((a) => !a.isActive).length],
                      ] as const
                    ).map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={rosterStatusFilter === id}
                        onClick={() => setRosterStatusFilter(id)}
                        className={tabItemClass(rosterStatusFilter === id)}
                      >
                        {label}
                        <span className={tabCountClass(rosterStatusFilter === id)}>{count}</span>
                      </button>
                    ))}
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

              {(canRevokeDevices || canManageUsers) && (
                <MobileDevicesPanel canRevoke={canRevokeDevices} />
              )}
            </div>
          )}

          {activeTab === "account" && (
            <div className="space-y-4">
              <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm" aria-labelledby="settings-profile-heading">
                <h3 id="settings-profile-heading" className="text-sm font-bold text-slate-900 mb-2">
                  Your profile
                </h3>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-slate-500">Name</dt>
                    <dd className="font-semibold text-slate-900">{user?.fullName || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Email</dt>
                    <dd className="font-semibold text-slate-900 break-all">{user?.email || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Organisation</dt>
                    <dd className="font-semibold text-slate-900">{user?.organizationName || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Role</dt>
                    <dd className="font-semibold text-slate-900">{user?.roleName || "—"}</dd>
                  </div>
                </dl>
              </section>

              <form
                onSubmit={handlePasswordSubmit}
                noValidate
                className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4"
                aria-labelledby="settings-password-heading"
              >
                <div>
                  <h3 id="settings-password-heading" className="text-sm font-bold text-slate-900">
                    Change password
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    At least 10 characters, with a letter and a number. Changing it
                    signs out your other sessions.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
                  <div>
                    <label htmlFor="settings-current-password" className="block text-xs font-semibold text-slate-700 mb-1">
                      Current password
                    </label>
                    <input
                      id="settings-current-password"
                      type="password"
                      autoComplete="current-password"
                      {...passwordForm.register("currentPassword", { onChange: () => void passwordForm.trigger("newPassword") })}
                      {...fieldA11y(passwordForm, "currentPassword")}
                      className={`${passwordInput} ${invalidClass(passwordForm, "currentPassword")}`}
                    />
                    <FieldError form={passwordForm} name="currentPassword" />
                  </div>

                  <div>
                    <label htmlFor="settings-new-password" className="block text-xs font-semibold text-slate-700 mb-1">
                      New password
                    </label>
                    <input
                      id="settings-new-password"
                      type="password"
                      autoComplete="new-password"
                      {...passwordForm.register("newPassword", { onChange: () => void passwordForm.trigger("confirmPassword") })}
                      {...fieldA11y(passwordForm, "newPassword")}
                      className={`${passwordInput} ${invalidClass(passwordForm, "newPassword")}`}
                    />
                    <FieldError form={passwordForm} name="newPassword" />
                  </div>

                  <div>
                    <label htmlFor="settings-confirm-password" className="block text-xs font-semibold text-slate-700 mb-1">
                      Confirm new password
                    </label>
                    <input
                      id="settings-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      {...passwordForm.register("confirmPassword")}
                      {...fieldA11y(passwordForm, "confirmPassword")}
                      className={`${passwordInput} ${invalidClass(passwordForm, "confirmPassword")}`}
                    />
                    <FieldError form={passwordForm} name="confirmPassword" />
                  </div>
                </div>

                <div className="[&>span]:items-start">
                  <SubmitButton
                    form={passwordForm}
                    pendingLabel="Changing…"
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-800"
                  >
                    Change password
                  </SubmitButton>
                </div>
              </form>
            </div>
          )}
        </TabPanel>
      )}
    </div>
  );
}
