import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Controller } from 'react-hook-form';
import { Archive, Building2, ChevronDown, ChevronRight, Pencil, Plus, RotateCcw } from 'lucide-react';
import {
  CreateOrganizationRequestSchema,
  ORGANIZATION_CATEGORY_META,
  OrganizationCategoryEnum,
  organizationDescendants,
  organizationTreeOrder,
  type OrganizationCategory,
  type OrganizationDto,
} from '@insite/shared';
import { useAuth } from '../../lib/auth-context';
import { SubmitButton, useZodForm, visibleError } from '../../lib/forms';
import { Overlay } from '../common/Overlay';
import { useOrganizationsQuery } from '../../queries/organizations/useOrganizationQueries';
import {
  useCreateOrganizationMutation,
  useUpdateOrganizationMutation,
} from '../../mutations/organizations/useOrganizationMutations';
import { CustomSelect } from '../common';
import Drawer from '../Drawer';
import {
  StandardTable,
  TableActionButton,
  TableBadge,
  type TableColumnDef,
} from '../table';

const ALL_TAGS = OrganizationCategoryEnum.options;

type FieldKey = 'name' | 'categories' | 'registrationNumber' | 'contactEmail' | 'contactPhone' | 'parentOrganizationId';

/** The drawer's inputs, mapped to CreateOrganizationRequestSchema (an update sends the same fields). */
const OrganizationFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the organisation name (at least 2 characters)').max(160, 'Name is too long (at most 160 characters)'),
    categories: z.array(OrganizationCategoryEnum).min(1, 'Choose at least one tag'),
    registrationNumber: z.string().trim().max(64, 'Registration number is too long (at most 64 characters)'),
    contactEmail: z
      .string()
      .trim()
      .max(200, 'Email is too long (at most 200 characters)')
      .refine((v) => !v || z.string().email().safeParse(v).success, 'Enter a valid email, or leave it empty'),
    contactPhone: z.string().trim().max(32, 'Phone is too long (at most 32 characters)'),
    /** Phase 11: '' for a top-level organisation. */
    parentOrganizationId: z.string(),
  })
  .transform((v) => ({
    name: v.name,
    categories: v.categories,
    registrationNumber: v.registrationNumber || null,
    contactEmail: v.contactEmail || null,
    contactPhone: v.contactPhone || null,
    parentOrganizationId: v.parentOrganizationId || null,
  }))
  .pipe(CreateOrganizationRequestSchema);
type FormState = z.input<typeof OrganizationFormSchema>;

const emptyForm: FormState = {
  name: '',
  categories: [],
  registrationNumber: '',
  contactEmail: '',
  contactPhone: '',
  parentOrganizationId: '',
};

/** Reads `{ path, message }[]` from a 400 response into a field map. */
function serverFieldErrors(err: unknown): Record<string, string> {
  const issues = (err as { response?: { data?: { error?: { issues?: unknown } } } })?.response?.data?.error?.issues;
  const out: Record<string, string> = {};
  if (!Array.isArray(issues)) return out;
  for (const issue of issues as Array<{ path?: string | Array<string | number>; message?: string }>) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : issue.path ?? '';
    const key = path.split('.')[0] || '_';
    if (!out[key] && issue.message) out[key] = issue.message;
  }
  return out;
}

const fieldClass = (hasError: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary ${
    hasError ? 'border-rose-400' : 'border-slate-200'
  }`;

/** Settings > Organisations: the tenant's organisation directory. */
export function OrganizationsTab() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('organizations:manage');

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<OrganizationCategory | ''>('');
  const [showArchived, setShowArchived] = useState(false);

  // Fetch the whole directory once per archived toggle and filter locally; directories are small.
  const { data: orgs = [], isLoading } = useOrganizationsQuery({ includeArchived: showArchived });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgs.filter(
      (o) =>
        (!tagFilter || o.categories.includes(tagFilter)) &&
        (!q ||
          o.name.toLowerCase().includes(q) ||
          (o.registrationNumber ?? '').toLowerCase().includes(q) ||
          (o.contactEmail ?? '').toLowerCase().includes(q)),
    );
  }, [orgs, search, tagFilter]);

  // Phase 11: the hierarchy as a tree (indented, collapsible) when no search or tag filter is set.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const treeMode = !search.trim() && !tagFilter;
  const levelOf = useMemo(() => new Map<string, number>(), []);
  const rows = useMemo(() => {
    levelOf.clear();
    if (!treeMode) return filtered;
    const ordered = organizationTreeOrder(filtered);
    const hidden = new Set<string>();
    const out: OrganizationDto[] = [];
    for (const { node, level } of ordered) {
      levelOf.set(node.id, level);
      if (node.parentOrganizationId && (hidden.has(node.parentOrganizationId) || collapsed.has(node.parentOrganizationId))) {
        hidden.add(node.id);
        continue;
      }
      out.push(node);
    }
    return out;
  }, [filtered, treeMode, collapsed, levelOf]);
  const hasChildren = useMemo(() => new Set(orgs.map((o) => o.parentOrganizationId).filter(Boolean) as string[]), [orgs]);
  const toggleCollapsed = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const createMutation = useCreateOrganizationMutation();
  const updateMutation = useUpdateOrganizationMutation();

  const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'edit'; org: OrganizationDto } | null>(null);
  const orgForm = useZodForm(OrganizationFormSchema, { defaultValues: emptyForm });
  const form = orgForm.watch();
  const errorKeys: FieldKey[] = ['name', 'categories', 'registrationNumber', 'contactEmail', 'contactPhone', 'parentOrganizationId'];
  const errors: Partial<Record<FieldKey, string>> = Object.fromEntries(errorKeys.map((k) => [k, visibleError(orgForm, k)]));
  const [confirming, setConfirming] = useState<OrganizationDto | null>(null);

  const openCreate = () => {
    orgForm.reset({ ...emptyForm, categories: tagFilter ? [tagFilter] : [] });
    setDrawer({ mode: 'create' });
  };

  const openEdit = (org: OrganizationDto) => {
    orgForm.reset({
      name: org.name,
      categories: [...org.categories],
      registrationNumber: org.registrationNumber ?? '',
      contactEmail: org.contactEmail ?? '',
      contactPhone: org.contactPhone ?? '',
      parentOrganizationId: org.parentOrganizationId ?? '',
    });
    setDrawer({ mode: 'edit', org });
  };

  const toggleTag = (tag: OrganizationCategory) => {
    const current = orgForm.getValues('categories');
    orgForm.setValue('categories', current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag], {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const handleSubmit = orgForm.handleSubmit(async (payload) => {
    if (!drawer) return;
    try {
      if (drawer.mode === 'create') await createMutation.mutateAsync(payload);
      else await updateMutation.mutateAsync({ organizationId: drawer.org.id, payload });
      setDrawer(null);
    } catch (err) {
      // The mutation hook shows the toast; keep the drawer open with field errors.
      for (const [key, message] of Object.entries(serverFieldErrors(err))) {
        if (errorKeys.includes(key as FieldKey)) orgForm.setError(key as FieldKey, { type: 'server', message });
      }
    }
  });

  const handleArchiveToggle = async () => {
    if (!confirming) return;
    try {
      await updateMutation.mutateAsync({
        organizationId: confirming.id,
        payload: { isArchived: !confirming.isArchived },
      });
    } finally {
      setConfirming(null);
    }
  };

  const columns: TableColumnDef<OrganizationDto>[] = [
    {
      id: 'name',
      header: 'Organisation',
      cell: (o) => {
        const level = treeMode ? levelOf.get(o.id) ?? 0 : 0;
        return (
          <span className="flex items-center gap-1" style={{ paddingLeft: level * 18 }}>
            {treeMode && hasChildren.has(o.id) ? (
              <button
                type="button"
                aria-label={collapsed.has(o.id) ? `Expand ${o.name}` : `Collapse ${o.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(o.id);
                }}
                className="rounded p-0.5 text-slate-500 hover:bg-slate-100"
              >
                {collapsed.has(o.id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            ) : (
              treeMode && <span className="inline-block w-[18px]" />
            )}
            <span className="font-semibold text-slate-900">{o.name}</span>
            {o.parentIsArchived && (
              <TableBadge variant="warning" title="The parent organisation is archived.">
                Parent archived
              </TableBadge>
            )}
          </span>
        );
      },
    },
    {
      id: 'tags',
      header: 'Tags',
      cell: (o) => (
        <div className="flex flex-wrap gap-1">
          {o.categories.map((c) => (
            <TableBadge key={c} variant="neutral">
              {ORGANIZATION_CATEGORY_META[c].label}
            </TableBadge>
          ))}
        </div>
      ),
    },
    {
      id: 'reg',
      header: 'Registration no.',
      cell: (o) => <span className="font-mono text-slate-700">{o.registrationNumber || '-'}</span>,
    },
    {
      id: 'contact',
      header: 'Contact',
      cell: (o) =>
        o.contactEmail || o.contactPhone ? (
          <div className="text-slate-700 leading-tight">
            {o.contactEmail && <div>{o.contactEmail}</div>}
            {o.contactPhone && <div className="text-[11px] text-slate-500">{o.contactPhone}</div>}
          </div>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    { id: 'users', header: 'Users', align: 'right', cell: (o) => o.userCount ?? '-' },
    { id: 'projects', header: 'Projects', align: 'right', cell: (o) => o.projectCount ?? '-' },
    {
      id: 'status',
      header: 'Status',
      cell: (o) => (
        <TableBadge variant={o.isArchived ? 'neutral' : 'success'}>{o.isArchived ? 'Archived' : 'Active'}</TableBadge>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: '',
            align: 'right' as const,
            cell: (o: OrganizationDto) => (
              <div className="flex justify-end gap-1.5">
                <TableActionButton onClick={() => openEdit(o)} icon={<Pencil className="w-3.5 h-3.5" />}>
                  Edit
                </TableActionButton>
                <TableActionButton
                  variant={o.isArchived ? 'default' : 'danger'}
                  onClick={() => setConfirming(o)}
                  icon={o.isArchived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                >
                  {o.isArchived ? 'Restore' : 'Archive'}
                </TableActionButton>
              </div>
            ),
          },
        ]
      : []),
  ];

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <StandardTable<OrganizationDto>
        title={
          <span className="inline-flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Organisations
          </span>
        }
        subtitle="Owners, monitors, funders, contractors and other parties used on projects and user accounts."
        headerActions={
          canManage ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <Plus className="w-4 h-4" />
              Add organisation
            </button>
          ) : undefined
        }
        search={{ value: search, onChange: setSearch, placeholder: 'Search name, registration no. or email' }}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <CustomSelect<string>
                size="sm"
                value={tagFilter}
                onChange={(v) => setTagFilter(v as OrganizationCategory | '')}
                options={[
                  { value: '', label: 'All tags' },
                  ...ALL_TAGS.map((t) => ({ value: t, label: ORGANIZATION_CATEGORY_META[t].label })),
                ]}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
              />
              Show archived
            </label>
          </div>
        }
        columns={columns}
        data={rows}
        keyExtractor={(o) => o.id}
        loading={isLoading}
        rowClassName={(o) => (o.isArchived ? 'opacity-60' : '')}
        emptyState={{
          title: search || tagFilter ? 'No organisation matches' : 'No organisations yet',
          description: canManage
            ? 'Add organisations here, or they are added when a name is typed on a project or user.'
            : 'Organisations appear here once they are used on a project or user.',
        }}
      />

      {/* Add / edit drawer */}
      {drawer && (
        <Drawer
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setDrawer(null);
          }}
          onClose={() => !saving && setDrawer(null)}
          label={drawer.mode === 'create' ? 'Add organisation' : `Edit ${drawer.org.name}`}
        >
          <form onSubmit={handleSubmit} className="flex flex-col h-full" noValidate>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">Organisation</div>
                <h3 className="text-sm font-bold text-slate-900">
                  {drawer.mode === 'create' ? 'Add organisation' : `Edit ${drawer.org.name}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3.5 overflow-y-auto flex-1 text-xs">
              <div>
                <label htmlFor="org-name" className="block font-semibold text-slate-700 mb-1">
                  Name *
                </label>
                <input
                  id="org-name"
                  type="text"
                  {...orgForm.register('name')}
                  maxLength={160}
                  autoFocus
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'org-name-error' : undefined}
                  className={fieldClass(Boolean(errors.name))}
                />
                {errors.name && <p id="org-name-error" className="text-[11px] text-rose-600 mt-1">{errors.name}</p>}
              </div>

              <fieldset>
                <legend className="block font-semibold text-slate-700 mb-1">Tags *</legend>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  The parts this organisation can play. Tags filter the organisation lists on projects.
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_TAGS.map((tag) => {
                    const checked = form.categories.includes(tag);
                    return (
                      <label
                        key={tag}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition focus-within:ring-2 focus-within:ring-brand-primary/20 ${
                          checked ? 'border-brand-primary bg-brand-primary/5' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTag(tag)}
                          className="h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
                        />
                        <span className="font-medium text-slate-800">{ORGANIZATION_CATEGORY_META[tag].label}</span>
                      </label>
                    );
                  })}
                </div>
                {errors.categories && <p className="text-[11px] text-rose-600 mt-1">{errors.categories}</p>}
              </fieldset>

              <div>
                <label htmlFor="org-reg" className="block font-semibold text-slate-700 mb-1">
                  Registration number
                </label>
                <input
                  id="org-reg"
                  type="text"
                  {...orgForm.register('registrationNumber')}
                  maxLength={64}
                  placeholder="e.g. RC 123456"
                  aria-invalid={Boolean(errors.registrationNumber)}
                  className={fieldClass(Boolean(errors.registrationNumber))}
                />
                {errors.registrationNumber && (
                  <p className="text-[11px] text-rose-600 mt-1">{errors.registrationNumber}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="org-email" className="block font-semibold text-slate-700 mb-1">
                    Contact email
                  </label>
                  <input
                    id="org-email"
                    type="email"
                    {...orgForm.register('contactEmail')}
                    maxLength={200}
                    aria-invalid={Boolean(errors.contactEmail)}
                    className={fieldClass(Boolean(errors.contactEmail))}
                  />
                  {errors.contactEmail && <p className="text-[11px] text-rose-600 mt-1">{errors.contactEmail}</p>}
                </div>
                <div>
                  <label htmlFor="org-phone" className="block font-semibold text-slate-700 mb-1">
                    Contact phone
                  </label>
                  <input
                    id="org-phone"
                    type="tel"
                    {...orgForm.register('contactPhone')}
                    maxLength={32}
                    aria-invalid={Boolean(errors.contactPhone)}
                    className={fieldClass(Boolean(errors.contactPhone))}
                  />
                  {errors.contactPhone && <p className="text-[11px] text-rose-600 mt-1">{errors.contactPhone}</p>}
                </div>
              </div>

              <div className="text-xs">
                <p className="block font-semibold text-slate-700 mb-1">Part of (parent organisation)</p>
                <Controller
                  control={orgForm.control}
                  name="parentOrganizationId"
                  render={({ field }) => (
                <CustomSelect
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  options={[
                    { value: '', label: 'None (top level)' },
                    ...orgs
                      .filter((o) =>
                        drawer.mode === 'edit'
                          ? !organizationDescendants(orgs, drawer.org.id).includes(o.id)
                          : true
                      )
                      .map((o) => ({ value: o.id, label: o.name })),
                  ]}
                  searchable
                  size="sm"
                />
                  )}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  A subsidiary sits under its flagship. People with organisation-tree visibility see the projects their organisation
                  and everything under it owns. At most five levels.
                </p>
                {errors.parentOrganizationId && (
                  <p className="text-[11px] text-rose-600 mt-1">{errors.parentOrganizationId}</p>
                )}
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDrawer(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <SubmitButton
                form={orgForm}
                pending={saving}
                pendingLabel="Saving..."
                className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
              >
                {drawer.mode === 'create' ? 'Add organisation' : 'Save changes'}
              </SubmitButton>
            </div>
          </form>
        </Drawer>
      )}

      {/* Archive / restore confirmation */}
      {confirming && (
        <Overlay
          className="flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !updateMutation.isPending) setConfirming(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="org-confirm-title"
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl p-5 space-y-3"
          >
            <h3 id="org-confirm-title" className="text-sm font-bold text-slate-900">
              {confirming.isArchived ? `Restore ${confirming.name}?` : `Archive ${confirming.name}?`}
            </h3>
            <p className="text-xs text-slate-600">
              {confirming.isArchived
                ? 'It will appear again in organisation lists on projects and users.'
                : 'It will no longer appear in organisation lists. Projects and users already linked to it keep the link.'}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updateMutation.isPending}
                onClick={handleArchiveToggle}
                className={`px-4 py-2 rounded-xl text-white text-xs font-semibold disabled:opacity-50 ${
                  confirming.isArchived ? 'bg-brand-primary hover:bg-brand-hover' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {updateMutation.isPending ? 'Working...' : confirming.isArchived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
