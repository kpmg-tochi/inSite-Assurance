import { useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { UserPlus, Smartphone } from 'lucide-react';
import {
  AssignUserProjectsRequestSchema,
  CreateTenantUserRequestSchema,
  ORGANIZATION_CATEGORY_META,
  OrganizationCategoryEnum,
  formatProjectCode,
  type OrganizationRef,
  type RoleDto,
  type TenantUserDto,
} from '@insite/shared';
import {
  FieldError,
  SubmitButton,
  fieldA11y,
  invalidClass,
  useZodForm,
  visibleError,
  zChoice,
  zEmail,
  type AnyForm,
} from '../../lib/forms';
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

/** Optional phone: empty, or the format the server accepts. */
const PhoneText = z
  .string()
  .trim()
  .refine((v) => !v || /^\+?[0-9 ()-]{7,20}$/.test(v), 'Enter a phone number of 7 to 20 digits, e.g. +234 803 000 0000, or leave it empty');

/** Add a user: the inputs, mapped to CreateTenantUserRequestSchema (which still decides). */
const CreateUserFormSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter the full name (at least 2 characters)').max(120, 'Full name is too long (at most 120 characters)'),
    email: zEmail('work email'),
    password: z.string().min(8, 'Enter a temporary password of at least 8 characters'),
    roleId: zChoice('role'),
    organization: z
      .custom<OrganizationRef | null>()
      .refine((v) => Boolean(v && (v.id || v.name?.trim())), 'Choose or enter an organisation')
      .refine((v) => !v || Boolean(v.id) || ((v.name ?? '').trim().length >= 2 && (v.name ?? '').trim().length <= 160), 'Enter the organisation name (2 to 160 characters)'),
    organizationCategory: OrganizationCategoryEnum,
    mobileRoleId: z.string(),
    phoneNumber: PhoneText,
    projectIds: z.array(z.string()),
  })
  .transform((v) => ({
    fullName: v.fullName,
    email: v.email,
    password: v.password,
    roleId: v.roleId,
    ...(v.organization?.id ? { organizationId: v.organization.id } : { organizationName: (v.organization?.name ?? '').trim() }),
    organizationCategory: v.organizationCategory,
    mobileRoleId: v.mobileRoleId || null,
    phoneNumber: v.phoneNumber || null,
    projectIds: v.projectIds,
  }))
  .pipe(CreateTenantUserRequestSchema);

/** Edit role and projects: the inputs, mapped to AssignUserProjectsRequestSchema. */
const EditUserFormSchema = z
  .object({
    roleId: zChoice('role'),
    isActive: z.boolean(),
    mobileRoleId: z.string(),
    phoneNumber: PhoneText,
    projectIds: z.array(z.string()),
  })
  .transform((v) => ({
    roleId: v.roleId,
    isActive: v.isActive,
    mobileRoleId: v.mobileRoleId || null,
    phoneNumber: v.phoneNumber || null,
    projectIds: v.projectIds,
  }))
  .pipe(AssignUserProjectsRequestSchema);

/**
 * Mobile access (Phase 5): a separate mobile role, or none. When the main role is
 * itself a mobile role, it already gives mobile sign-in.
 */
function MobileAccessFields(props: {
  provisionedRoles: RoleDto[];
  mainRole: RoleDto | undefined;
  /** A form with `mobileRoleId` and `phoneNumber` text fields. */
  form: AnyForm;
}) {
  const { form } = props;
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
          {...form.register('mobileRoleId')}
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
          {...form.register('phoneNumber')}
          {...fieldA11y(form, 'phoneNumber')}
          placeholder="+234 803 000 0000"
          className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(form, 'phoneNumber')}`}
        />
        <FieldError form={form} name="phoneNumber" />
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

  // Add user form
  const createForm = useZodForm(CreateUserFormSchema, {
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      roleId: '',
      organization: null,
      organizationCategory: 'ADVISORY_MONITOR',
      mobileRoleId: '',
      phoneNumber: '',
      projectIds: [],
    },
  });
  const createRoleId = createForm.watch('roleId');
  const createProjectIds = createForm.watch('projectIds');

  // Edit role and projects form
  const editForm = useZodForm(EditUserFormSchema, {
    defaultValues: { roleId: '', isActive: true, mobileRoleId: '', phoneNumber: '', projectIds: [] },
  });
  const editRoleId = editForm.watch('roleId');
  const editProjectIds = editForm.watch('projectIds');

  const openCreateModal = () => {
    createForm.reset({
      fullName: '',
      email: '',
      password: '',
      roleId: roles[0]?.id || '',
      organization: null,
      organizationCategory: 'ADVISORY_MONITOR',
      mobileRoleId: '',
      phoneNumber: '',
      projectIds: [],
    });
    setCreateDrawerOpen(true);
  };

  const openEditUser = (target: TenantUserDto) => {
    setEditingUser(target);
    editForm.reset({
      roleId: target.roleId,
      isActive: target.isActive,
      projectIds: target.projectAssignments.map((a) => a.projectId),
      mobileRoleId: target.mobileRoleId ?? '',
      phoneNumber: target.phoneNumber ?? '',
    });
  };

  const toggleProject = (form: typeof createForm | typeof editForm, list: string[], projectId: string) => {
    const next = list.includes(projectId) ? list.filter((id) => id !== projectId) : [...list, projectId];
    (form as AnyForm).setValue('projectIds', next, { shouldDirty: true, shouldValidate: true });
  };

  const handleCreateUser = createForm.handleSubmit(async (payload) => {
    await createUserMutation.mutateAsync(payload);
    setCreateDrawerOpen(false);
  });

  const handleSaveAssignments = editForm.handleSubmit(async (payload) => {
    if (!editingUser) return;
    await assignProjectsMutation.mutateAsync({ userId: editingUser.id, payload });
    setEditingUser(null);
  });

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
          <span className="text-slate-800">{u.projectAssignments.map((pa) => formatProjectCode(pa.projectCodePrefix) || pa.projectId.slice(0, 8)).join(', ')}</span>
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
          <form onSubmit={handleCreateUser} noValidate className="flex flex-col h-full">
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
                {...createForm.register('fullName')}
                {...fieldA11y(createForm, 'fullName')}
                className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(createForm, 'fullName')}`}
              />
              <FieldError form={createForm} name="fullName" />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Work Email *
              </label>
              <input
                type="email"
                {...createForm.register('email')}
                {...fieldA11y(createForm, 'email')}
                className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(createForm, 'email')}`}
              />
              <FieldError form={createForm} name="email" />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Temporary Password * (user must change it at first sign-in)
              </label>
              <input
                type="text"
                {...createForm.register('password')}
                {...fieldA11y(createForm, 'password')}
                className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(createForm, 'password')}`}
              />
              <FieldError form={createForm} name="password" />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Role Assignment *
              </label>
              <select
                {...createForm.register('roleId')}
                {...fieldA11y(createForm, 'roleId')}
                className="w-full rounded-xl border border-slate-200 px-3 py-2"
              >
                {roles.length === 0 && <option value="">No roles yet</option>}
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
              <FieldError form={createForm} name="roleId" />
            </div>

            <div className="space-y-2.5">
              <Controller
                control={createForm.control}
                name="organization"
                render={({ field }) => (
                  <OrganizationInput
                    label="Organisation *"
                    value={field.value ?? null}
                    onChange={(next) => {
                      field.onChange(next);
                      field.onBlur();
                    }}
                    error={visibleError(createForm, 'organization') ?? null}
                  />
                )}
              />
              <div>
                <label htmlFor="new-user-org-tag" className="block font-semibold text-slate-700 mb-1">
                  Organisation tag
                </label>
                <select
                  id="new-user-org-tag"
                  {...createForm.register('organizationCategory')}
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
              mainRole={roleById.get(createRoleId)}
              form={createForm}
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
                      onChange={() => toggleProject(createForm, createProjectIds, p.id)}
                      className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary"
                    />
                    <span className="font-semibold text-brand-primary">
                      {formatProjectCode(p.codePrefix)}
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
            <SubmitButton
              form={createForm}
              pending={createUserMutation.isPending}
              pendingLabel="Adding…"
              className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
            >
              Add user
            </SubmitButton>
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
            noValidate
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
                  {...editForm.register('roleId')}
                  {...fieldA11y(editForm, 'roleId')}
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
                form={editForm}
              />

              <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  {...editForm.register('isActive')}
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
                        onChange={() => toggleProject(editForm, editProjectIds, p.id)}
                        className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary"
                      />
                      <span className="font-semibold text-brand-primary">
                        {formatProjectCode(p.codePrefix)}
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
              <SubmitButton
                form={editForm}
                pending={assignProjectsMutation.isPending}
                pendingLabel="Saving..."
                className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
              >
                Save role and projects
              </SubmitButton>
            </div>
          </form>
        </Drawer>
      )}
    </div>
  );
}
