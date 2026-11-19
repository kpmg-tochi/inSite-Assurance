import React, { useMemo, useState } from 'react';
import {
  KeyRound,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  CheckSquare,
  Square,
  Sparkles,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import {
  PERMISSION_CATEGORY_META,
  type FieldPersonaType,
  type PermissionCategory,
  type PermissionDto,
  type RoleDto,
  type RoleOnboardingImpactDto,
  type RoleOnboardingMode,
  type RoleSurface,
} from '@insite/shared';
import { getRoleOnboardingImpact } from '../../api/rbac/rbacApi';
import {
  usePermissionsCatalogQuery,
  useTenantRolesQuery,
} from '../../queries/rbac/useRbacQueries';
import {
  useCreateRoleMutation,
  useDeleteRoleMutation,
  useUpdateRoleMutation,
} from '../../mutations/rbac/useRbacMutations';
import Drawer from '../Drawer';
import Loader from '../Loader';

const CATEGORY_ORDER: PermissionCategory[] = [
  'TENANT_ADMIN',
  'PORTFOLIO_PROJECTS',
  'BOQ_SCHEDULE',
  'MOBILIZATION_ASSURANCE',
  'FIELD_PRESENCE',
  'REPORT_APPROVALS',
  'FINANCIAL_IPC',
  'AUDIT_CLOSEOUT',
];

export function RolesPermissionsTab() {
  const { data: roles = [], isLoading: rolesLoading } = useTenantRolesQuery(true);
  const { data: catalog = [], isLoading: catalogLoading } =
    usePermissionsCatalogQuery(true);

  const createRoleMutation = useCreateRoleMutation();
  const updateRoleMutation = useUpdateRoleMutation();
  const deleteRoleMutation = useDeleteRoleMutation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDto | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeSuffix, setCodeSuffix] = useState('');
  const [description, setDescription] = useState('');
  const [surface, setSurface] = useState<RoleSurface>('WEB');
  const [fieldPersonaType, setFieldPersonaType] =
    useState<FieldPersonaType>('NONE');
  const [assuranceWeight, setAssuranceWeight] = useState<number>(1.0);
  const [requiresIdentityAssurance, setRequiresIdentityAssurance] =
    useState(false);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<
    string[]
  >([]);
  const [onboardingMode, setOnboardingMode] = useState<RoleOnboardingMode>('JOIN_CODE');
  // Set while the admin confirms an onboarding-mode change on an existing role.
  const [pendingImpact, setPendingImpact] = useState<RoleOnboardingImpactDto | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const isProvisioned = surface !== 'WEB' && onboardingMode === 'PROVISIONED_ACCOUNT';

  const permissionsByCategory = useMemo(() => {
    const grouped: Record<string, PermissionDto[]> = {};
    for (const perm of catalog) {
      if (!grouped[perm.category]) grouped[perm.category] = [];
      grouped[perm.category].push(perm);
    }
    return grouped;
  }, [catalog]);

  const unlockedViewsPreview = useMemo(() => {
    const idSet = new Set(selectedPermissionIds);
    const views = new Set<string>();
    for (const perm of catalog) {
      if (idSet.has(perm.id)) {
        views.add(perm.name);
      }
    }
    return Array.from(views);
  }, [catalog, selectedPermissionIds]);

  const openCreateDrawer = () => {
    setEditingRole(null);
    setName('');
    setCode('');
    setCodeSuffix('');
    setDescription('');
    setSurface('WEB');
    setFieldPersonaType('NONE');
    setAssuranceWeight(1.0);
    setRequiresIdentityAssurance(false);
    setSelectedPermissionIds([]);
    setOnboardingMode('JOIN_CODE');
    setPendingImpact(null);
    setDrawerOpen(true);
  };

  const openEditDrawer = (role: RoleDto) => {
    setEditingRole(role);
    setName(role.name);
    setCode(role.code);
    setCodeSuffix(role.codeSuffix || '');
    setDescription(role.description || '');
    setSurface(role.surface);
    setFieldPersonaType(role.fieldPersonaType);
    setAssuranceWeight(role.assuranceWeight);
    setRequiresIdentityAssurance(role.requiresIdentityAssurance);
    setSelectedPermissionIds(role.permissions.map((p) => p.id));
    setOnboardingMode(role.onboardingMode);
    setPendingImpact(null);
    setDrawerOpen(true);
  };

  const chooseOnboardingMode = (mode: RoleOnboardingMode) => {
    setOnboardingMode(mode);
    // The account is the identity, so a pre-provisioned role never asks for ID review.
    if (mode === 'PROVISIONED_ACCOUNT') setRequiresIdentityAssurance(false);
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissionIds((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId]
    );
  };

  const toggleCategory = (category: PermissionCategory) => {
    const perms = permissionsByCategory[category] || [];
    const permIds = perms.map((p) => p.id);
    const allSelected =
      permIds.length > 0 &&
      permIds.every((id) => selectedPermissionIds.includes(id));

    if (allSelected) {
      setSelectedPermissionIds((prev) =>
        prev.filter((id) => !permIds.includes(id))
      );
    } else {
      setSelectedPermissionIds((prev) =>
        Array.from(new Set([...prev, ...permIds]))
      );
    }
  };

  const effectiveMode: RoleOnboardingMode = surface === 'WEB' ? 'JOIN_CODE' : onboardingMode;

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPermissionIds.length === 0) return;

    // Changing how people join touches join codes on live projects: confirm first.
    if (editingRole && effectiveMode !== editingRole.onboardingMode && !pendingImpact) {
      setImpactLoading(true);
      try {
        setPendingImpact(await getRoleOnboardingImpact(editingRole.id));
      } finally {
        setImpactLoading(false);
      }
      return;
    }
    await saveRole();
  };

  const saveRole = async () => {
    if (editingRole) {
      await updateRoleMutation.mutateAsync({
        roleId: editingRole.id,
        payload: {
          name: name.trim(),
          codeSuffix:
            surface !== 'WEB' && codeSuffix.trim()
              ? codeSuffix.trim().toUpperCase()
              : null,
          description: description.trim() || null,
          surface,
          fieldPersonaType: surface === 'WEB' ? 'NONE' : fieldPersonaType,
          assuranceWeight: Number(assuranceWeight),
          requiresIdentityAssurance: isProvisioned ? false : requiresIdentityAssurance,
          onboardingMode: effectiveMode,
          permissionIds: selectedPermissionIds,
        },
      });
    } else {
      const normalizedCode = code
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_');
      await createRoleMutation.mutateAsync({
        name: name.trim(),
        code: normalizedCode,
        codeSuffix:
          surface !== 'WEB' && codeSuffix.trim()
            ? codeSuffix.trim().toUpperCase()
            : null,
        description: description.trim() || undefined,
        surface,
        fieldPersonaType: surface === 'WEB' ? 'NONE' : fieldPersonaType,
        assuranceWeight: Number(assuranceWeight),
        requiresIdentityAssurance: isProvisioned ? false : requiresIdentityAssurance,
        onboardingMode: effectiveMode,
        permissionIds: selectedPermissionIds,
      });
    }
    setPendingImpact(null);
    setDrawerOpen(false);
  };

  const handleDeleteRole = async (role: RoleDto) => {
    if (role.isSystemDefault) return;
    await deleteRoleMutation.mutateAsync(role.id);
  };

  if (rolesLoading || catalogLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-10 flex items-center justify-center gap-3">
        <Loader size="sm" />
        <span className="text-xs text-slate-500">
          Loading normalized Role &amp; Permission matrix...
        </span>
      </div>
    );
  }

  const isSaving = createRoleMutation.isPending || updateRoleMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-primary" />
            <h3 className="text-sm font-bold text-slate-900">
              Configurable Tenant Roles &amp; Relational Permissions
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Rename roles, toggle permissions by governance category, and configure mobile field
            personas (<span className="font-semibold">Independent Verifier</span> vs.{' '}
            <span className="font-semibold">Contractor Executor</span>) for client workflows.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateDrawer}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create Custom Role
        </button>
      </div>

      {/* Role Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {roles.map((role) => (
          <div
            key={role.id}
            className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between gap-3"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">
                      {role.name}
                    </span>
                    {role.isSystemDefault && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                        Default Template
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {role.code}
                    {role.codeSuffix && role.onboardingMode !== 'PROVISIONED_ACCOUNT'
                      ? ` · Join Suffix -${role.codeSuffix}`
                      : ''}
                  </div>
                  {role.surface !== 'WEB' && role.onboardingMode === 'PROVISIONED_ACCOUNT' && (
                    <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <Smartphone className="w-3 h-3" />
                      Pre-provisioned: signs in with account
                    </span>
                  )}
                </div>

                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                    role.surface === 'MOBILE'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : role.surface === 'BOTH'
                        ? 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                        : 'bg-blue-50 text-brand-primary border border-blue-200'
                  }`}
                >
                  {role.surface}
                </span>
              </div>

              {role.description && (
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  {role.description}
                </p>
              )}

              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Field Persona</span>
                  <span className="font-semibold text-slate-800">
                    {role.fieldPersonaType === 'INDEPENDENT_VERIFIER'
                      ? 'Independent Verifier'
                      : role.fieldPersonaType === 'CONTRACTOR_EXECUTOR'
                        ? 'Contractor Executor'
                        : 'Web Governance Only'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">
                    Weight / Permissions
                  </span>
                  <span className="font-semibold text-slate-800">
                    {role.assuranceWeight.toFixed(1)}x ·{' '}
                    {role.permissions.length} perms
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                {role.userCount ?? 0} assigned user
                {(role.userCount ?? 0) === 1 ? '' : 's'}
                {role.requiresIdentityAssurance ? ' · ID review required' : ''}
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openEditDrawer(role)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition"
                >
                  <Pencil className="w-3 h-3" />
                  Customize
                </button>
                {!role.isSystemDefault && (
                  <button
                    type="button"
                    disabled={deleteRoleMutation.isPending}
                    onClick={() => handleDeleteRole(role)}
                    title="Delete custom role"
                    className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Role Builder & Permission Matrix Drawer */}
      {drawerOpen && (
        <Drawer
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
        >
          <form onSubmit={handleSaveRole} className="flex flex-col h-full">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
                RBAC Role Builder
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                {editingRole
                  ? `Customize Role: ${editingRole.name}`
                  : 'Create New Tenant Role'}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"
            >
              Close
            </button>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            {/* Role Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Display Role Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. M&E Evaluation Lead"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  System Code *
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingRole)}
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
                    )
                  }
                  placeholder="ME_EVAL_LEAD"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-brand-primary disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  App Surface
                </label>
                <select
                  value={surface}
                  onChange={(e) => {
                    const nextSurface = e.target.value as RoleSurface;
                    setSurface(nextSurface);
                    if (nextSurface === 'WEB') {
                      setFieldPersonaType('NONE');
                    } else if (fieldPersonaType === 'NONE') {
                      setFieldPersonaType('INDEPENDENT_VERIFIER');
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary"
                >
                  <option value="WEB">WEB (Portal Workspace)</option>
                  <option value="MOBILE">MOBILE (Field App Only)</option>
                  <option value="BOTH">BOTH (Web Portal &amp; Field App)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Join Code Suffix (2–4 chars, Mobile/Both)
                </label>
                <input
                  type="text"
                  disabled={surface === 'WEB' || isProvisioned}
                  maxLength={4}
                  value={codeSuffix}
                  onChange={(e) =>
                    setCodeSuffix(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                    )
                  }
                  placeholder={surface === 'WEB' ? 'N/A for WEB' : 'e.g. ME'}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-brand-primary disabled:bg-slate-100"
                />
              </div>

              {surface !== 'WEB' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mobile AI &amp; Workflow Persona
                    </label>
                    <select
                      value={fieldPersonaType}
                      onChange={(e) =>
                        setFieldPersonaType(e.target.value as FieldPersonaType)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary"
                    >
                      <option value="INDEPENDENT_VERIFIER">
                        Independent Verifier (Inspection &amp; M&amp;E Briefs)
                      </option>
                      <option value="CONTRACTOR_EXECUTOR">
                        Contractor Executor (Work Execution Briefs)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Assurance Corroboration Weight (0.1 – 1.0)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      max={1.0}
                      step={0.1}
                      value={assuranceWeight}
                      onChange={(e) =>
                        setAssuranceWeight(Number(e.target.value))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Role Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe responsibilities for this client role..."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary"
              />
            </div>

            {surface !== 'WEB' && (
              <fieldset className="space-y-2">
                <legend className="block text-xs font-semibold text-slate-700 mb-1">Onboarding</legend>
                {(
                  [
                    {
                      mode: 'JOIN_CODE',
                      label: 'Join code',
                      hint: 'People join each project with a role-specific code. Use for contractors and anyone without an account.',
                    },
                    {
                      mode: 'PROVISIONED_ACCOUNT',
                      label: 'Pre-provisioned account',
                      hint: 'People sign in with their account and see every assigned project. No code, no identity check.',
                    },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.mode}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer text-xs ${
                      onboardingMode === opt.mode
                        ? 'border-brand-primary bg-blue-50/60'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="onboardingMode"
                      checked={onboardingMode === opt.mode}
                      onChange={() => chooseOnboardingMode(opt.mode)}
                      className="mt-0.5 h-4 w-4 border-slate-300 text-brand-primary"
                    />
                    <span>
                      <span className="font-semibold text-slate-800 block">{opt.label}</span>
                      <span className="text-[11px] text-slate-500">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {surface !== 'WEB' && (
              <label
                className={`flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs ${
                  isProvisioned ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={isProvisioned}
                  checked={!isProvisioned && requiresIdentityAssurance}
                  onChange={(e) =>
                    setRequiresIdentityAssurance(e.target.checked)
                  }
                  className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary"
                />
                <span className="font-semibold text-slate-800">
                  Require photo ID, guided selfie set &amp; license review on mobile
                  {isProvisioned && (
                    <span className="block font-normal text-[11px] text-slate-500">
                      Not used for pre-provisioned roles: the account is the identity.
                    </span>
                  )}
                </span>
              </label>
            )}

            {/* Live Unlocked Capabilities Summary */}
            <div className="rounded-xl bg-blue-50/70 border border-blue-200 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-brand-primary">
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  Selected Permissions ({selectedPermissionIds.length})
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-1">
                {unlockedViewsPreview.length > 0
                  ? unlockedViewsPreview.slice(0, 8).join(' · ') +
                    (unlockedViewsPreview.length > 8
                      ? ` (+${unlockedViewsPreview.length - 8} more)`
                      : '')
                  : 'Select at least one permission below.'}
              </div>
            </div>

            {/* Categorized Permissions Matrix */}
            <div className="space-y-3">
              {CATEGORY_ORDER.map((category) => {
                const perms = permissionsByCategory[category] || [];
                if (perms.length === 0) return null;
                const meta = PERMISSION_CATEGORY_META[category];
                const selectedInCat = perms.filter((p) =>
                  selectedPermissionIds.includes(p.id)
                ).length;
                const allSelected = selectedInCat === perms.length;

                return (
                  <div
                    key={category}
                    className="rounded-xl border border-slate-200 overflow-hidden"
                  >
                    <div className="bg-slate-50 px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">
                          {meta.label}{' '}
                          <span className="text-[11px] font-normal text-slate-500">
                            ({selectedInCat}/{perms.length})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {meta.description}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCategory(category)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0"
                      >
                        {allSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-brand-primary" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        {allSelected ? 'Clear All' : 'Select All'}
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100 bg-white">
                      {perms.map((perm) => {
                        const checked = selectedPermissionIds.includes(perm.id);
                        return (
                          <label
                            key={perm.id}
                            className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(perm.id)}
                              className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-brand-primary"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-900">
                                  {perm.name}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                  {perm.key}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {perm.description}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {pendingImpact && (
            <div className="mx-3.5 mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
              <div className="flex items-center gap-1.5 font-bold">
                <TriangleAlert className="w-3.5 h-3.5" />
                Confirm onboarding change
              </div>
              {effectiveMode === 'PROVISIONED_ACCOUNT' ? (
                <>
                  <p>
                    {pendingImpact.activeJoinCodeCount === 0
                      ? 'This role has no active join codes.'
                      : `${pendingImpact.activeJoinCodeCount} active join code(s) for this role will be deactivated on:`}
                  </p>
                  {pendingImpact.projects.length > 0 && (
                    <ul className="list-disc pl-5">
                      {pendingImpact.projects.map((p) => (
                        <li key={p.id}>
                          <span className="font-mono">{p.codePrefix}</span> {p.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p>
                    {pendingImpact.activeJoinCodeSessionCount} person(s) who already joined with a code keep
                    working until you revoke them. From now on, people in this role sign in with their account.
                  </p>
                </>
              ) : (
                <p>
                  Users who have this as their mobile role lose mobile sign-in straight away. A new join code
                  is issued for this role on every project.
                </p>
              )}
            </div>
          )}

          <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => (pendingImpact ? setPendingImpact(null) : setDrawerOpen(false))}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {pendingImpact ? 'Back' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSaving || impactLoading || selectedPermissionIds.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {isSaving || impactLoading
                ? 'Saving...'
                : pendingImpact
                  ? 'Confirm and save'
                  : editingRole
                    ? 'Save Role Permissions'
                    : 'Create Role'}
            </button>
          </div>
        </form>
        </Drawer>
      )}
    </div>
  );
}
