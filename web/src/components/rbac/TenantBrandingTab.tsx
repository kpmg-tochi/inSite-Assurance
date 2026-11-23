import React, { useEffect, useState } from 'react';
import { Palette, Building2, Plus, CheckCircle2 } from 'lucide-react';
import { applyTenantBranding, useAuth } from '../../lib/auth-context';
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

export function TenantBrandingTab() {
  const { user, refreshUser } = useAuth();
  const { data: tenant, isLoading } = useCurrentTenantQuery(true);
  const { data: allTenants = [] } = useAllTenantsQuery(
    Boolean(user?.isPlatformSuperAdmin)
  );

  const updateBrandingMutation = useUpdateTenantBrandingMutation();
  const createTenantMutation = useCreateTenantMutation();

  const [tenantName, setTenantName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColorHex, setPrimaryColorHex] = useState('#00338D');
  const [navyColorHex, setNavyColorHex] = useState('#0C233C');
  const [tagline, setTagline] = useState('');
  const [pdfHeaderTitle, setPdfHeaderTitle] = useState('');
  const [pdfFooterDisclaimer, setPdfFooterDisclaimer] = useState('');

  // Platform Super Admin Tenant Provisioning State
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newPrimaryHex, setNewPrimaryHex] = useState('#00338D');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  useEffect(() => {
    if (!tenant) return;
    setTenantName(tenant.name);
    setLogoUrl(tenant.brandingConfig?.logoUrl || '');
    setPrimaryColorHex(tenant.brandingConfig?.primaryColorHex || '#00338D');
    setNavyColorHex(tenant.brandingConfig?.navyColorHex || '#0C233C');
    setTagline(tenant.brandingConfig?.tagline || '');
    setPdfHeaderTitle(tenant.brandingConfig?.pdfHeaderTitle || '');
    setPdfFooterDisclaimer(tenant.brandingConfig?.pdfFooterDisclaimer || '');
  }, [tenant]);

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await updateBrandingMutation.mutateAsync({
      name: tenantName.trim() || undefined,
      // Currency and time zone are workspace settings (Phase 6), not branding.
      brandingConfig: {
        logoUrl: logoUrl.trim() || null,
        primaryColorHex,
        navyColorHex,
        tagline: tagline.trim() || undefined,
        pdfHeaderTitle: pdfHeaderTitle.trim() || undefined,
        pdfFooterDisclaimer: pdfFooterDisclaimer.trim() || undefined,
      },
    });
    applyTenantBranding(updated.brandingConfig);
    await refreshUser();
  };

  // Live preview: the colours apply to this page as you edit and revert if you leave unsaved.
  const validHex = (h: string) => /^#[0-9A-Fa-f]{6}$/.test(h);
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

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    await createTenantMutation.mutateAsync({
      name: newName.trim(),
      slug: newSlug.trim().toLowerCase(),
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      brandingConfig: {
        primaryColorHex: newPrimaryHex,
        navyColorHex: '#0C233C',
        tagline: 'Capital Projects Assurance Platform',
      },
      adminFullName: newAdminName.trim() || undefined,
      adminEmail: newAdminEmail.trim() || undefined,
      adminPassword: newAdminPassword || undefined,
    });
    setNewName('');
    setNewSlug('');
    setNewAdminName('');
    setNewAdminEmail('');
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-10 flex items-center justify-center gap-3">
        <Loader size="sm" />
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
        className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-brand-primary" />
              <h3 className="text-sm font-bold text-slate-900">
                Tenant White-Label Branding &amp; Valuation PDF Identity
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Customize portal colors, sidebar workspace branding, and Valuation Report PDF headers
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
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Sidebar Tagline
            </label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Shown under the workspace name"
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Logo image URL (leave blank for the InSite mark)
            </label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            />
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
                value={primaryColorHex}
                onChange={(e) => setPrimaryColorHex(e.target.value.toUpperCase())}
                className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                pattern="^#[0-9A-Fa-f]{6}$"
                value={primaryColorHex}
                onChange={(e) => setPrimaryColorHex(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Navy Surface Color (Hex)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={navyColorHex}
                onChange={(e) => setNavyColorHex(e.target.value.toUpperCase())}
                className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                pattern="^#[0-9A-Fa-f]{6}$"
                value={navyColorHex}
                onChange={(e) => setNavyColorHex(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 font-mono"
              />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">
              Valuation Report PDF Header Title
            </label>
            <input
              type="text"
              value={pdfHeaderTitle}
              onChange={(e) => setPdfHeaderTitle(e.target.value)}
              placeholder="e.g. Capital Projects Assurance Valuation Certificate"
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">
              Valuation Report PDF Footer Disclaimer
            </label>
            <textarea
              rows={2}
              value={pdfFooterDisclaimer}
              onChange={(e) => setPdfFooterDisclaimer(e.target.value)}
              placeholder="Confidential — Prepared for authorized facility stakeholders..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={updateBrandingMutation.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {updateBrandingMutation.isPending
              ? 'Applying Branding...'
              : 'Save & Apply Tenant Branding'}
          </button>
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
            className="pt-4 border-t border-slate-200 space-y-3 text-xs"
          >
            <div className="font-bold text-slate-800">
              Provision New Client Tenant
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                placeholder="Client Tenant Name (e.g. InfraCorp)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2"
              />
              <input
                type="text"
                required
                placeholder="slug (e.g. infracorp)"
                value={newSlug}
                onChange={(e) =>
                  setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                }
                className="rounded-xl border border-slate-200 px-3 py-2 font-mono"
              />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Brand:</span>
                <input
                  type="color"
                  value={newPrimaryHex}
                  onChange={(e) => setNewPrimaryHex(e.target.value.toUpperCase())}
                  className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer"
                />
                <span className="font-mono text-slate-600">{newPrimaryHex}</span>
              </div>
              <input
                type="text"
                placeholder="Initial Admin Name (optional)"
                value={newAdminName}
                onChange={(e) => setNewAdminName(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2"
              />
              <input
                type="email"
                placeholder="Initial Admin Email (optional)"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2"
              />
              <input
                type="text"
                placeholder="Temporary password (changed at first sign-in)"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={createTenantMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-navy hover:bg-slate-800 text-white text-xs font-semibold transition disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {createTenantMutation.isPending
                  ? 'Provisioning Tenant...'
                  : 'Provision New Tenant'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
