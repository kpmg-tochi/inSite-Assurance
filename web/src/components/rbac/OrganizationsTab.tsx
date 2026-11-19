import React, { useMemo, useState } from 'react';
import { Archive, Building2, Pencil, Plus, RotateCcw } from 'lucide-react';
import {
  ORGANIZATION_CATEGORY_META,
  OrganizationCategoryEnum,
  type OrganizationCategory,
  type OrganizationDto,
} from '@insite/shared';
import { useAuth } from '../../lib/auth-context';
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

type FieldErrors = Partial<Record<'name' | 'categories' | 'registrationNumber' | 'contactEmail' | 'contactPhone', string>>;

interface FormState {
  name: string;
  categories: OrganizationCategory[];
  registrationNumber: string;
  contactEmail: string;
  contactPhone: string;
}

const emptyForm: FormState = {
  name: '',
  categories: [],
  registrationNumber: '',
  contactEmail: '',
  contactPhone: '',
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

  const createMutation = useCreateOrganizationMutation();
  const updateMutation = useUpdateOrganizationMutation();

  const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'edit'; org: OrganizationDto } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState<OrganizationDto | null>(null);

  const openCreate = () => {
    setForm({ ...emptyForm, categories: tagFilter ? [tagFilter] : [] });
    setErrors({});
    setDrawer({ mode: 'create' });
  };

  const openEdit = (org: OrganizationDto) => {
    setForm({
      name: org.name,
      categories: [...org.categories],
      registrationNumber: org.registrationNumber ?? '',
      contactEmail: org.contactEmail ?? '',
      contactPhone: org.contactPhone ?? '',
    });
    setErrors({});
    setDrawer({ mode: 'edit', org });
  };

  const toggleTag = (tag: OrganizationCategory) =>
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(tag) ? f.categories.filter((t) => t !== tag) : [...f.categories, tag],
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawer) return;
    const local: FieldErrors = {};
    if (form.name.trim().length < 2) local.name = 'Enter at least 2 characters';
    if (form.categories.length === 0) local.categories = 'Choose at least one tag';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const payload = {
      name: form.name.trim(),
      categories: form.categories,
      registrationNumber: form.registrationNumber.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
    };
    try {
      if (drawer.mode === 'create') await createMutation.mutateAsync(payload);
      else await updateMutation.mutateAsync({ organizationId: drawer.org.id, payload });
      setDrawer(null);
    } catch (err) {
      // The mutation hook shows the toast; keep the drawer open with field errors.
      setErrors(serverFieldErrors(err) as FieldErrors);
    }
  };

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
      cell: (o) => <span className="font-semibold text-slate-900">{o.name}</span>,
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
        subtitle="Monitors, lenders, contractors and other parties used on projects and user accounts."
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
        data={filtered}
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
                  value={form.name}
                  maxLength={160}
                  autoFocus
                  aria-invalid={Boolean(errors.name)}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={fieldClass(Boolean(errors.name))}
                />
                {errors.name && <p className="text-[11px] text-rose-600 mt-1">{errors.name}</p>}
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
                  value={form.registrationNumber}
                  maxLength={64}
                  placeholder="e.g. RC 123456"
                  onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
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
                    value={form.contactEmail}
                    maxLength={200}
                    onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
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
                    value={form.contactPhone}
                    maxLength={32}
                    onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                    className={fieldClass(Boolean(errors.contactPhone))}
                  />
                  {errors.contactPhone && <p className="text-[11px] text-rose-600 mt-1">{errors.contactPhone}</p>}
                </div>
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
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50"
              >
                {saving ? 'Saving...' : drawer.mode === 'create' ? 'Add organisation' : 'Save changes'}
              </button>
            </div>
          </form>
        </Drawer>
      )}

      {/* Archive / restore confirmation */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/35 flex items-center justify-center p-4"
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
        </div>
      )}
    </div>
  );
}
