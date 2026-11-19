import React, { useMemo, useState } from 'react';
import {
  Users,
  UserPlus,
  FolderCheck,
  Shield,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';
import type { OrganizationCategory, RoleDto, TenantUserDto } from '@insite/shared';
import {
  useTenantRolesQuery,
  useTenantUsersQuery,
} from '../../queries/rbac/useRbacQueries';
import { useProjectsQuery } from '../../queries/projects/useProjectsQueries';
import {
  useAssignUserProjectsMutation,
  useCreateTenantUserMutation,
} from '../../mutations/rbac/useRbacMutations';
import Drawer from '../Drawer';
import Loader from '../Loader';

const isProvisionedRole = (role: RoleDto | undefined) =>
  Boolean(role && role.surface !== 'WEB' && role.onboardingMode === 'PROVISIONED_ACCOUNT');

/**
 * Mobile access (Phase 5): a separate pre-provisioned mobile role, or none. When the main role is
 * itself a pre-provisioned mobile role, it already gives mobile sign-in.
 */
function MobileAccessFields(props: {
  provisionedRoles: RoleDto[];
  mainRole: RoleDto | undefined;
  mobileRoleId: string;
  onMobileRoleId: (id: string) => void;
  phoneNumber: string;
  onPhoneNumber: (value: string) => void;
}) {
  const mainGivesAccess = isProvisionedRole(props.mainRole);
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
        <Smartphone className="w-3.5 h-3.5 text-brand-primary" />
        Mobile access
      </div>
      <div>
        <label className="block font-semibold text-slate-700 mb-1">Mobile role</label>
        <select
          value={props.mobileRoleId}
          onChange={(e) => props.onMobileRoleId(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2"
        >
          <option value="">{mainGivesAccess ? 'Same as main role' : 'None (no mobile sign-in)'}</option>
          {props.provisionedRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-slate-500 mt-1">
          {props.provisionedRoles.length === 0
            ? 'No role is pre-provisioned yet. In Roles, set a mobile role to "Pre-provisioned account" first.'
            : 'People with a mobile role sign in to the app with this email and password and see every assigned project. No join code or identity check.'}
        </p>
      </div>
      <div>
        <label className="block font-semibold text-slate-700 mb-1">Phone number</label>
        <input
          type="tel"
          value={props.phoneNumber}
          onChange={(e) => props.onPhoneNumber(e.target.value)}
          placeholder="+234 803 000 0000"
          className="w-full rounded-xl border border-slate-200 px-3 py-2"
        />
      </div>
    </div>
  );
}

export function UsersVisibilityTab() {
  const { data: users = [], isLoading: usersLoading } =
    useTenantUsersQuery(true);
  const { data: roles = [] } = useTenantRolesQuery(true);
  const { data: projects = [] } = useProjectsQuery(true);

  const provisionedRoles = useMemo(() => roles.filter(isProvisionedRole), [roles]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const createUserMutation = useCreateTenantUserMutation();
  const assignProjectsMutation = useAssignUserProjectsMutation();

  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUserDto | null>(null);

  // Create User State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationCategory, setOrganizationCategory] =
    useState<OrganizationCategory>('ADVISORY_MONITOR');
  const [createProjectIds, setCreateProjectIds] = useState<string[]>([]);
  const [mobileRoleId, setMobileRoleId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Edit User Assignments State
  const [editRoleId, setEditRoleId] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editProjectIds, setEditProjectIds] = useState<string[]>([]);
  const [editMobileRoleId, setEditMobileRoleId] = useState('');
  const [editPhoneNumber, setEditPhoneNumber] = useState('');

  const openCreateModal = () => {
    setFullName('');
    setEmail('');
    setPassword('');
    setRoleId(roles[0]?.id || '');
    setOrganizationName('');
    setOrganizationCategory('ADVISORY_MONITOR');
    setCreateProjectIds([]);
    setMobileRoleId('');
    setPhoneNumber('');
    setCreateDrawerOpen(true);
  };

  const openEditUser = (target: TenantUserDto) => {
    setEditingUser(target);
    setEditRoleId(target.roleId);
    setEditIsActive(target.isActive);
    setEditProjectIds(target.projectAssignments.map((a) => a.projectId));
    setEditMobileRoleId(target.mobileRoleId ?? '');
    setEditPhoneNumber(target.phoneNumber ?? '');
  };

  const toggleProject = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    projectId: string
  ) => {
    setList(
      list.includes(projectId)
        ? list.filter((id) => id !== projectId)
        : [...list, projectId]
    );
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleId) return;
    await createUserMutation.mutateAsync({
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      roleId,
      organizationName: organizationName.trim(),
      organizationCategory,
      mobileRoleId: mobileRoleId || null,
      phoneNumber: phoneNumber.trim() || null,
      projectIds: createProjectIds,
    });
    setCreateDrawerOpen(false);
  };

  const handleSaveAssignments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    await assignProjectsMutation.mutateAsync({
      userId: editingUser.id,
      payload: {
        roleId: editRoleId || undefined,
        isActive: editIsActive,
        mobileRoleId: editMobileRoleId || null,
        phoneNumber: editPhoneNumber.trim() || null,
        projectIds: editProjectIds,
      },
    });
    setEditingUser(null);
  };

  if (usersLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-10 flex items-center justify-center gap-3">
        <Loader size="sm" />
        <span className="text-xs text-slate-500">
          Loading tenant directory and project scoping...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-primary" />
            <h3 className="text-sm font-bold text-slate-900">
              Tenant Users &amp; Project Visibility Assignments
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Assign custom roles and restrict which facilities a user can access unless their role
            holds <span className="font-mono font-semibold">projects:view_all_tenant</span>.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Add Tenant User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3 px-4">User &amp; Organization</th>
              <th className="py-3 px-4">Assigned Role</th>
              <th className="py-3 px-4">Project Visibility Scope</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/70">
                <td className="py-3 px-4">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span>{u.fullName}</span>
                    {u.isPlatformSuperAdmin && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">
                        Platform Admin
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {u.email} · {u.organizationName}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-brand-primary border border-blue-200 text-[11px] font-semibold">
                    <Shield className="w-3 h-3" />
                    {u.roleName}
                  </span>
                  {u.hasMobileAccess && (
                    <span
                      className="mt-1 flex w-fit items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold"
                      title="Signs in to the mobile app with this account"
                    >
                      <Smartphone className="w-3 h-3" />
                      Mobile{u.mobileRoleName ? `: ${u.mobileRoleName}` : ''}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {u.hasAllTenantProjects ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                      <FolderCheck className="w-3.5 h-3.5" />
                      All Tenant Projects
                    </span>
                  ) : u.projectAssignments.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.projectAssignments.map((pa) => (
                        <span
                          key={pa.id}
                          className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold"
                        >
                          {pa.projectCodePrefix || pa.projectId.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-amber-700 text-[11px] font-medium">
                      No projects assigned
                    </span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      u.isActive
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {u.isActive ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => openEditUser(u)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition"
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    Role &amp; Scope
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Tenant User Drawer */}
      {createDrawerOpen && (
        <Drawer
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateDrawerOpen(false);
          }}
        >
          <form onSubmit={handleCreateUser} className="flex flex-col h-full">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
                User Provisioning
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Add New User to Tenant
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setCreateDrawerOpen(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Work Email *
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Temporary Password * (user must change it at first sign-in)
              </label>
              <input
                type="text"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Role Assignment *
              </label>
              <select
                required
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Organization Name *
                </label>
                <input
                  type="text"
                  required
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Org Category
                </label>
                <select
                  value={organizationCategory}
                  onChange={(e) =>
                    setOrganizationCategory(
                      e.target.value as OrganizationCategory
                    )
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                >
                  <option value="ADVISORY_MONITOR">Advisory / Monitor</option>
                  <option value="FINANCIER_LENDER">Financier / Lender</option>
                  <option value="CONTRACTOR">Contractor</option>
                  <option value="CLIENT_OWNER">Client Owner</option>
                  <option value="GOVERNMENT_MDA">Government MDA</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>

            <MobileAccessFields
              provisionedRoles={provisionedRoles}
              mainRole={roleById.get(roleId)}
              mobileRoleId={mobileRoleId}
              onMobileRoleId={setMobileRoleId}
              phoneNumber={phoneNumber}
              onPhoneNumber={setPhoneNumber}
            />

            <div className="pt-2">
              <div className="font-semibold text-slate-700 mb-1.5">
                Assign Visible Projects (ignored if role has view-all)
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto border border-slate-200 rounded-xl p-2.5">
                {projects.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={createProjectIds.includes(p.id)}
                      onChange={() =>
                        toggleProject(
                          createProjectIds,
                          setCreateProjectIds,
                          p.id
                        )
                      }
                      className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary"
                    />
                    <span className="font-semibold text-brand-primary">
                      {p.codePrefix}
                    </span>
                    <span className="text-slate-700 truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateDrawerOpen(false)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createUserMutation.isPending}
              className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50"
            >
              {createUserMutation.isPending ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
        </Drawer>
      )}

      {/* Edit User Role & Project Assignments Drawer */}
      {editingUser && (
        <Drawer
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingUser(null);
          }}
        >
          <form
            onSubmit={handleSaveAssignments}
            className="flex flex-col h-full"
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
                  Access &amp; Project Scoping
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {editingUser.fullName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-xs font-semibold text-slate-500"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Assigned Tenant Role
                </label>
                <select
                  value={editRoleId}
                  onChange={(e) => setEditRoleId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </div>

              <MobileAccessFields
                provisionedRoles={provisionedRoles}
                mainRole={roleById.get(editRoleId)}
                mobileRoleId={editMobileRoleId}
                onMobileRoleId={setEditMobileRoleId}
                phoneNumber={editPhoneNumber}
                onPhoneNumber={setEditPhoneNumber}
              />

              <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary"
                />
                <span className="font-semibold text-slate-800">
                  Account Active (Uncheck to suspend portal login)
                </span>
              </label>

              <div>
                <div className="font-semibold text-slate-700 mb-1.5">
                  Explicitly Assigned Facilities
                </div>
                <div className="space-y-1.5 border border-slate-200 rounded-xl p-2.5 max-h-60 overflow-y-auto">
                  {projects.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={editProjectIds.includes(p.id)}
                        onChange={() =>
                          toggleProject(editProjectIds, setEditProjectIds, p.id)
                        }
                        className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary"
                      />
                      <span className="font-semibold text-brand-primary">
                        {p.codePrefix}
                      </span>
                      <span className="text-slate-700 truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assignProjectsMutation.isPending}
                className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50"
              >
                {assignProjectsMutation.isPending
                  ? 'Saving...'
                  : 'Save Assignments'}
              </button>
            </div>
          </form>
        </Drawer>
      )}
    </div>
  );
}
