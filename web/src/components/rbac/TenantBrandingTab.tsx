import { useEffect } from 'react';
import { z } from 'zod';
import { Palette, Building2, Plus, CheckCircle2 } from 'lucide-react';
import { CreateTenantRequestSchema, UpdateTenantBrandingRequestSchema, type TenantDto } from '@insite/shared';
import { applyTenantBranding, useAuth } from '../../lib/auth-context';
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zEmail } from '../../lib/forms';
import {
  useAllTenantsQuery,
  useCurrentTenantQuery,
} from '../../queries/rbac/useRbacQueries';
import {
  useCreateTenantMutation,
  useUpdateTenantBrandingMutation,
} from '../../mutations/rbac/useRbacMutations';
import Loader from '../Loader';
import { APPLICATION_NAME } from "../../config/appName";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const hexText = (label: string) => z.string().trim().regex(HEX_RE, `Enter the ${label} as # and six hex digits, e.g. #00338D`);
const maxText = (label: string, max: number) => z.string().trim().max(max, `${label} is too long (at most ${max} characters)`);

/** Branding inputs, mapped to UpdateTenantBrandingRequestSchema (which still decides). */
const BrandingFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the workspace name (at least 2 characters)').max(160, 'Workspace name is too long (at most 160 characters)'),
    logoUrl: maxText('Logo URL', 500),
    primaryColorHex: hexText('primary colour'),
    navyColorHex: hexText('navy colour'),
    tagline: maxText('Tagline', 120),
    pdfHeaderTitle: maxText('PDF header title', 160),
    pdfFooterDisclaimer: maxText('PDF footer disclaimer', 500),
  })
  .transform((v) => ({
    name: v.name || undefined,
    // Currency and time zone are workspace settings (Phase 6), not branding.
    brandingConfig: {
      logoUrl: v.logoUrl || null,
      primaryColorHex: v.primaryColorHex,
      navyColorHex: v.navyColorHex,
      tagline: v.tagline || undefined,
      pdfHeaderTitle: v.pdfHeaderTitle || undefined,
      pdfFooterDisclaimer: v.pdfFooterDisclaimer || undefined,
    },
  }))
  .pipe(UpdateTenantBrandingRequestSchema);

const brandingDefaults = (tenant: TenantDto | undefined): z.input<typeof BrandingFormSchema> => ({
  name: tenant?.name ?? '',
  logoUrl: tenant?.brandingConfig?.logoUrl || '',
  primaryColorHex: tenant?.brandingConfig?.primaryColorHex || '#00338D',
  navyColorHex: tenant?.brandingConfig?.navyColorHex || '#0C233C',
  tagline: tenant?.brandingConfig?.tagline || '',
  pdfHeaderTitle: tenant?.brandingConfig?.pdfHeaderTitle || '',
  pdfFooterDisclaimer: tenant?.brandingConfig?.pdfFooterDisclaimer || '',
});

/** New client tenant inputs, mapped to CreateTenantRequestSchema (which still decides). */
const NewTenantFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the client tenant name (at least 2 characters)').max(160, 'Tenant name is too long (at most 160 characters)'),
    slug: z.string().trim().min(1, 'Enter a slug').regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only'),
    primaryColorHex: hexText('brand colour'),
    adminFullName: z.string().trim().refine((v) => !v || (v.length >= 2 && v.length <= 120), 'Enter 2 to 120 characters, or leave it empty'),
    adminEmail: z.string().trim().refine((v) => !v || zEmail().safeParse(v).success, 'Enter a valid email, or leave it empty'),
    adminPassword: z.string().refine((v) => !v || v.length >= 8, 'Enter at least 8 characters, or leave it empty'),
  })
  .transform((v) => ({
    name: v.name,
    slug: v.slug.toLowerCase(),
    defaultCurrency: 'NGN',
    timezone: 'Africa/Lagos',
    brandingConfig: {
      primaryColorHex: v.primaryColorHex,
      navyColorHex: '#0C233C',
      tagline: 'Capital Projects Assurance Platform',
    },
    adminFullName: v.adminFullName || undefined,
    adminEmail: v.adminEmail || undefined,
    adminPassword: v.adminPassword || undefined,
  }))
  .pipe(CreateTenantRequestSchema);

export function TenantBrandingTab() {
  const { user, refreshUser } = useAuth();
  const { data: tenant, isLoading } = useCurrentTenantQuery(true);
  const { data: allTenants = [] } = useAllTenantsQuery(
    Boolean(user?.isPlatformSuperAdmin)
  );

  const updateBrandingMutation = useUpdateTenantBrandingMutation();
  const createTenantMutation = useCreateTenantMutation();

  const brandingForm = useZodForm(BrandingFormSchema, { defaultValues: brandingDefaults(undefined) });
  const { register, reset, watch, setValue } = brandingForm;
  const tenantName = watch('name');
  const logoUrl = watch('logoUrl');
  const tagline = watch('tagline');
  const primaryColorHex = watch('primaryColorHex');
  const navyColorHex = watch('navyColorHex');

  // Platform Super Admin Tenant Provisioning
  const tenantForm = useZodForm(NewTenantFormSchema, {
    defaultValues: { name: '', slug: '', primaryColorHex: '#00338D', adminFullName: '', adminEmail: '', adminPassword: '' },
  });
  const newPrimaryHex = tenantForm.watch('primaryColorHex');

  useEffect(() => {
    if (!tenant) return;
    reset(brandingDefaults(tenant));
  }, [tenant, reset]);

  const handleSaveBranding = brandingForm.handleSubmit(async (payload) => {
    const updated = await updateBrandingMutation.mutateAsync(payload);
    applyTenantBranding(updated.brandingConfig);
    await refreshUser();
  });

  // Live preview: the colours apply to this page as you edit and revert if you leave unsaved.
  const validHex = (h: string) => HEX_RE.test(h);
  useEffect(() => {
    if (!tenant) return;
    if (validHex(primaryColorHex) && validHex(navyColorHex)) applyTenantBranding({ primaryColorHex, navyColorHex });
  }, [primaryColorHex, navyColorHex, tenant]);
  useEffect(
    () => () => {
      // Back to the saved branding when leaving the tab.
      applyTenantBranding(user?.tenant?.brandingConfig);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleCreateTenant = tenantForm.handleSubmit(async (payload) => {
    await createTenantMutation.mutateAsync(payload);
    tenantForm.reset({ ...tenantForm.getValues(), name: '', slug: '', adminFullName: '', adminEmail: '' });
  });

  const setColour = (name: 'primaryColorHex' | 'navyColorHex', value: string) =>
    setValue(name, value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-10 flex items-center justify-center gap-3">
        <Loader size="sm" inline />
        <span className="text-xs text-slate-500">
          Loading white-label tenant theme configuration...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSaveBranding}
        noValidate
        className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-brand-primary" />
              <h3 className="text-sm font-bold text-slate-900">
                Workspace Branding &amp; PDF Identity
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Customize portal colors, sidebar workspace branding, and the headers of generated PDFs (certificates, closure packs)
              for <span className="font-semibold text-slate-700">{tenant?.name}</span>.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-mono text-[11px] font-semibold">
            {tenant?.slug}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Tenant Organization Display Name
            </label>
            <input
              type="text"
              {...register('name')}
              {...fieldA11y(brandingForm, 'name')}
              className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(brandingForm, 'name')}`}
            />
            <FieldError form={brandingForm} name="name" />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Sidebar Tagline
            </label>
            <input
              type="text"
              {...register('tagline')}
              {...fieldA11y(brandingForm, 'tagline')}
              placeholder="Shown under the workspace name"
              className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(brandingForm, 'tagline')}`}
            />
            <FieldError form={brandingForm} name="tagline" />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Logo image URL (leave blank for the InSite mark)
            </label>
            <input
              type="text"
              {...register('logoUrl')}
              {...fieldA11y(brandingForm, 'logoUrl')}
              placeholder="https://..."
              className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(brandingForm, 'logoUrl')}`}
            />
            <FieldError form={brandingForm} name="logoUrl" />
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="font-semibold text-slate-700 mb-2">Preview</p>
            <div className="rounded-lg p-3 flex items-center gap-2.5" style={{ backgroundColor: validHex(navyColorHex) ? navyColorHex : '#0C233C' }}>
              <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center p-1 shrink-0">
                {logoUrl.trim() ? (
                  <img src={logoUrl.trim()} alt="" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[10px] font-bold text-slate-700">IS</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-white font-semibold text-sm truncate">{tenantName || 'Workspace name'}</div>
                <div className="text-[11px] text-white/70 truncate">{tagline || APPLICATION_NAME}</div>
              </div>
              <span
                className="ml-auto rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white"
                style={{ backgroundColor: validHex(primaryColorHex) ? primaryColorHex : '#00338D' }}
              >
                Button
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Colours also preview on this page while you edit; they are saved only when you save.</p>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Primary Brand Color (Hex)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Primary colour picker"
                value={validHex(primaryColorHex) ? primaryColorHex : '#000000'}
                onChange={(e) => setColour('primaryColorHex', e.target.value.toUpperCase())}
                className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                {...register('primaryColorHex')}
                {...fieldA11y(brandingForm, 'primaryColorHex')}
                className={`flex-1 rounded-xl border border-slate-200 px-3 py-2 font-mono ${invalidClass(brandingForm, 'primaryColorHex')}`}
              />
            </div>
            <FieldError form={brandingForm} name="primaryColorHex" />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Navy Surface Color (Hex)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Navy colour picker"
                value={validHex(navyColorHex) ? navyColorHex : '#000000'}
                onChange={(e) => setColour('navyColorHex', e.target.value.toUpperCase())}
                className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                {...register('navyColorHex')}
                {...fieldA11y(brandingForm, 'navyColorHex')}
                className={`flex-1 rounded-xl border border-slate-200 px-3 py-2 font-mono ${invalidClass(brandingForm, 'navyColorHex')}`}
              />
            </div>
            <FieldError form={brandingForm} name="navyColorHex" />
          </div>

          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">
              PDF Header Title
            </label>
            <input
              type="text"
              {...register('pdfHeaderTitle')}
              {...fieldA11y(brandingForm, 'pdfHeaderTitle')}
              placeholder="e.g. Programme Delivery Monitoring"
              className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(brandingForm, 'pdfHeaderTitle')}`}
            />
            <FieldError form={brandingForm} name="pdfHeaderTitle" />
          </div>

          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">
              PDF Footer Disclaimer
            </label>
            <textarea
              rows={2}
              {...register('pdfFooterDisclaimer')}
              {...fieldA11y(brandingForm, 'pdfFooterDisclaimer')}
              placeholder="Confidential — Prepared for authorized facility stakeholders..."
              className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(brandingForm, 'pdfFooterDisclaimer')}`}
            />
            <FieldError form={brandingForm} name="pdfFooterDisclaimer" />
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <SubmitButton
            form={brandingForm}
            pending={updateBrandingMutation.isPending}
            pendingLabel={
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Applying Branding...
              </>
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Save & Apply Tenant Branding
          </SubmitButton>
        </div>
      </form>

      {/* Platform Super Admin: Multi-Tenant Client Provisioning */}
      {user?.isPlatformSuperAdmin && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-brand-primary" />
                <h3 className="text-sm font-bold text-slate-900">
                  Platform Super Admin: Client Tenants ({allTenants.length})
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Provision isolated client tenants with cloned default roles, permissions, and an
                initial Tenant Super Admin account.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {allTenants.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-slate-200 p-3 bg-slate-50/60 flex items-center justify-between"
              >
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    {t.name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {t.slug} · {t.defaultCurrency}
                  </div>
                </div>
                <span
                  className="w-5 h-5 rounded-full border border-slate-300 shrink-0"
                  style={{ backgroundColor: t.brandingConfig.primaryColorHex }}
                  title={t.brandingConfig.primaryColorHex}
                />
              </div>
            ))}
          </div>

          <form
            onSubmit={handleCreateTenant}
            noValidate
            className="pt-4 border-t border-slate-200 space-y-3 text-xs"
          >
            <div className="font-bold text-slate-800">
              Provision New Client Tenant
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <input
                  type="text"
                  placeholder="Client Tenant Name (e.g. InfraCorp)"
                  aria-label="Client tenant name"
                  {...tenantForm.register('name')}
                  {...fieldA11y(tenantForm, 'name')}
                  className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(tenantForm, 'name')}`}
                />
                <FieldError form={tenantForm} name="name" />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="slug (e.g. infracorp)"
                  aria-label="Slug"
                  {...tenantForm.register('slug', {
                    onChange: (e: { target: { value: string } }) =>
                      tenantForm.setValue('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'), { shouldValidate: true }),
                  })}
                  {...fieldA11y(tenantForm, 'slug')}
                  className={`w-full rounded-xl border border-slate-200 px-3 py-2 font-mono ${invalidClass(tenantForm, 'slug')}`}
                />
                <FieldError form={tenantForm} name="slug" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Brand:</span>
                <input
                  type="color"
                  aria-label="Brand colour"
                  value={newPrimaryHex}
                  onChange={(e) => tenantForm.setValue('primaryColorHex', e.target.value.toUpperCase(), { shouldValidate: true })}
                  className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer"
                />
                <span className="font-mono text-slate-600">{newPrimaryHex}</span>
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Initial Admin Name (optional)"
                  aria-label="Initial admin name"
                  {...tenantForm.register('adminFullName')}
                  {...fieldA11y(tenantForm, 'adminFullName')}
                  className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(tenantForm, 'adminFullName')}`}
                />
                <FieldError form={tenantForm} name="adminFullName" />
              </div>
              <div>
                <input
                  type="email"
                  placeholder="Initial Admin Email (optional)"
                  aria-label="Initial admin email"
                  {...tenantForm.register('adminEmail')}
                  {...fieldA11y(tenantForm, 'adminEmail')}
                  className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(tenantForm, 'adminEmail')}`}
                />
                <FieldError form={tenantForm} name="adminEmail" />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Temporary password (changed at first sign-in)"
                  aria-label="Temporary password"
                  {...tenantForm.register('adminPassword')}
                  {...fieldA11y(tenantForm, 'adminPassword')}
                  className={`w-full rounded-xl border border-slate-200 px-3 py-2 ${invalidClass(tenantForm, 'adminPassword')}`}
                />
                <FieldError form={tenantForm} name="adminPassword" />
              </div>
            </div>

            <div className="flex justify-end">
              <SubmitButton
                form={tenantForm}
                pending={createTenantMutation.isPending}
                pendingLabel={
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    Provisioning Tenant...
                  </>
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-navy hover:bg-slate-800 text-white text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-navy"
              >
                <Plus className="w-3.5 h-3.5" />
                Provision New Tenant
              </SubmitButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
