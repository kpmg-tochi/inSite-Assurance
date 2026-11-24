import React, { useMemo, useState } from 'react';
import { UserPlus, Smartphone } from 'lucide-react';
import {
  ORGANIZATION_CATEGORY_META,
  OrganizationCategoryEnum,
  type OrganizationCategory,
  type OrganizationRef,
  type RoleDto,
  type TenantUserDto,
} from '@insite/shared';
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
import { StandardTable, TableActionButton, type TableColumnDef } from '../table';
import { TAB_LIST_CLASS, tabCountClass, tabItemClass } from '../common/Tabs';
import { StatusText } from '../common/StatusText';
import { OrganizationInput } from '../organizations/OrganizationInput';

const isProvisionedRole = (role: RoleDto | undefined) =>
  Boolean(role && role.surface !== 'WEB');

/**
 * Mobile access (Phase 5): a separate mobile role, or none. When the main role is
 * itself a mobile role, it already gives mobile sign-in.
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
            ? 'No mobile role yet. In Roles, create a role for the mobile app first.'
            : 'People with a mobile role sign in to the app with this email and password and see every assigned project.'}
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

type UserFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'NO_PROJECTS';

const USER_FILTERS: Array<{ id: UserFilter; label: string; match: (u: TenantUserDto) => boolean }> = [
  { id: 'ALL', label: 'All', match: () => true },
  { id: 'ACTIVE', label: 'Active', match: (u) => u.isActive },
  { id: 'SUSPENDED', label: 'Suspended', match: (u) => !u.isActive },
  { id: 'NO_PROJECTS', label: 'No projects', match: (u) => !u.hasAllTenantProjects && u.projectAssignments.length === 0 },
];

export function UsersVisibilityTab() {
  const usersQuery = useTenantUsersQuery(true);
  const { data: users = [], isLoading: usersLoading } = usersQuery;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('ALL');
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
  const [organization, setOrganization] = useState<OrganizationRef | null>(null);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
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
    setOrganization(null);
    setOrganizationError(null);
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
    if (!organization || (!organization.id && !organization.name?.trim())) {
      setOrganizationError('Choose or enter an organisation');
      return;
    }
    setOrganizationError(null);
    await createUserMutation.mutateAsync({
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      roleId,
      ...(organization.id
        ? { organizationId: organization.id }
        : { organizationName: (organization.name ?? '').trim() }),
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

  const term = search.trim().toLowerCase();
  const searched = users.filter(
    (u) =>
      !term ||
      [u.fullName, u.email, u.organizationName, u.roleName, ...u.projectAssignments.map((a) => a.projectCodePrefix ?? '')].some((v) =>
        v.toLowerCase().includes(term)
      )
  );
  const activeFilter = USER_FILTERS.find((x) => x.id === filter)!;
  const shown = searched.filter(activeFilter.match);

  const columns: TableColumnDef<TenantUserDto>[] = [
    {
      id: 'user',
      header: 'User',
      cell: (u) => (
        <div>
          <div className="font-semibold text-slate-900">
            {u.fullName}
            {u.isPlatformSuperAdmin && <span className="ml-1.5 font-normal text-slate-500">(platform admin)</span>}
          </div>
          <div className="text-[11px] text-slate-500">
            {u.email} · {u.organizationName}
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (u) => (
        <div>
          <div className="text-slate-800">{u.roleName}</div>
          {u.hasMobileAccess && (
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500" title="Signs in to the mobile app with this account">
              <Smartphone className="h-3 w-3" aria-hidden="true" />
              Mobile app{u.mobileRoleName ? `: ${u.mobileRoleName}` : ''}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'projects',
      header: 'Projects they can see',
      cell: (u) =>
        u.hasAllTenantProjects ? (
          <span className="text-slate-800">All projects</span>
        ) : u.projectAssignments.length > 0 ? (
          <span className="text-slate-800">{u.projectAssignments.map((pa) => pa.projectCodePrefix || pa.projectId.slice(0, 8)).join(', ')}</span>
        ) : (
          <span className="text-amber-800">No projects assigned</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-28',
      cell: (u) => <StatusText label={u.isActive ? 'Active' : 'Suspended'} tone={u.isActive ? 'good' : 'bad'} />,
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      width: 'w-40',
      cell: (u) => <TableActionButton onClick={() => openEditUser(u)}>Edit role and projects</TableActionButton>,
    },
  ];

  if (usersQuery.isError) {
    return (
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 text-xs shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Users</h2>
        <p className="mt-1 text-rose-700">
          The users could not be loaded.{' '}
          <button type="button" onClick={() => usersQuery.refetch()} className="font-semibold underline">
            Try again
          </button>
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <StandardTable<TenantUserDto>
        title="Users"
        subtitle="Each user's role and the projects they can see. A role that can see every project ignores the project list."
        headerActions={
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add user
          </button>
        }
        search={{ value: search, onChange: setSearch, placeholder: 'Search name, email, organisation or project code' }}
        filters={
          <div role="group" aria-label="Show users" className={TAB_LIST_CLASS}>
            {USER_FILTERS.map((x) => (
              <button key={x.id} type="button" aria-pressed={filter === x.id} onClick={() => setFilter(x.id)} className={tabItemClass(filter === x.id)}>
                {x.label}
                <span className={tabCountClass(filter === x.id)}>{searched.filter(x.match).length}</span>
              </button>
            ))}
          </div>
        }
        columns={columns}
        data={shown}
        keyExtractor={(u) => u.id}
        onRowClick={openEditUser}
        selectedId={editingUser?.id ?? null}
        loading={usersLoading}
        minWidth="min-w-[760px]"
        emptyState={
          users.length > 0
            ? {
                title: 'No users match',
                description: 'Clear the search or choose another filter.',
                action: (
                  <TableActionButton
                    onClick={() => {
                      setSearch('');
                      setFilter('ALL');
                    }}
                  >
                    Clear filters
                  </TableActionButton>
                ),
              }
            : { title: 'No users yet', description: 'Add the first user with Add user.' }
        }
      />

      {/* Create Tenant User Drawer */}
      {createDrawerOpen && (
        <Drawer
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateDrawerOpen(false);
          }}
        >
          <form onSubmit={handleCreateUser} className="flex flex-col h-full">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Add a user</h3>
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

            <div className="space-y-2.5">
              <OrganizationInput
                label="Organisation *"
                value={organization}
                onChange={(next) => {
                  setOrganization(next);
                  if (next) setOrganizationError(null);
                }}
                error={organizationError}
              />
              <div>
                <label htmlFor="new-user-org-tag" className="block font-semibold text-slate-700 mb-1">
                  Organisation tag
                </label>
                <select
                  id="new-user-org-tag"
                  value={organizationCategory}
                  onChange={(e) =>
                    setOrganizationCategory(
                      e.target.value as OrganizationCategory
                    )
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                >
                  {OrganizationCategoryEnum.options.map((c) => (
                    <option key={c} value={c}>
                      {ORGANIZATION_CATEGORY_META[c].label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Added to the organisation if it is new or does not have this tag yet.
                </p>
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
              {createUserMutation.isPending ? 'Adding…' : 'Add user'}
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
                <h3 className="text-sm font-bold text-slate-900">
                  {editingUser.fullName}
                </h3>
                <p className="text-[11px] text-slate-500">Role and projects</p>
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
                  : 'Save role and projects'}
              </button>
            </div>
          </form>
        </Drawer>
      )}
    </div>
  );
}
