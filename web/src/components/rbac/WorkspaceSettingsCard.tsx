import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  COMMON_TIME_ZONES,
  GEOFENCE_MODE_META,
  GeofenceModeEnum,
  type GeofenceMode,
  type OrgInputMode,
  type TenantSettingsDto,
} from '@insite/shared';
import { useTenantSettingsQuery } from '../../queries/organizations/useOrganizationQueries';
import { useUpdateTenantSettingsMutation } from '../../mutations/organizations/useOrganizationMutations';
import Loader from '../Loader';

const INPUT_MODES: Array<{ value: OrgInputMode; label: string; description: string }> = [
  {
    value: 'FREE_TEXT',
    label: 'Free text',
    description: 'People type an organisation name. A new organisation is added if none has that name.',
  },
  {
    value: 'DIRECTORY',
    label: 'Directory only',
    description: 'People pick from the Organisations list. Only administrators can add organisations.',
  },
  {
    value: 'BOTH',
    label: 'Directory or new name',
    description: 'People pick from the list, or type a new name that is added to the directory.',
  },
];

type FieldKey = keyof TenantSettingsDto;
type FieldErrors = Partial<Record<FieldKey | '_', string>>;

function serverFieldErrors(err: unknown): FieldErrors {
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

const inputClass = (hasError: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary ${
    hasError ? 'border-rose-400' : 'border-slate-200'
  }`;

/** Tenant-wide defaults used by forms and projects (Phase 6). Requires `tenant:manage_settings`. */
export function WorkspaceSettingsCard() {
  const { data, isLoading } = useTenantSettingsQuery();
  const saveMutation = useUpdateTenantSettingsMutation();

  const [mode, setMode] = useState<OrgInputMode>('BOTH');
  const [geofenceModes, setGeofenceModes] = useState<GeofenceMode[]>([]);
  const [tolerance, setTolerance] = useState('100');
  const [currency, setCurrency] = useState('');
  const [timezone, setTimezone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!data) return;
    setMode(data.organizationInputMode);
    setGeofenceModes(data.enabledGeofenceModes);
    setTolerance(String(data.defaultGeofenceToleranceMeters));
    setCurrency(data.defaultCurrency);
    setTimezone(data.timezone);
    setErrors({});
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex justify-center">
        <Loader size="sm" />
      </div>
    );
  }

  const toggleGeofenceMode = (m: GeofenceMode) =>
    setGeofenceModes((list) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: FieldErrors = {};
    const toleranceNum = Number(tolerance);
    if (geofenceModes.length === 0) local.enabledGeofenceModes = 'Enable at least one geofence mode';
    if (tolerance.trim() === '' || !Number.isInteger(toleranceNum) || toleranceNum < 0 || toleranceNum > 1000) {
      local.defaultGeofenceToleranceMeters = 'Enter a whole number from 0 to 1000';
    }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) local.defaultCurrency = 'Use a 3-letter ISO 4217 code, e.g. NGN';
    if (!timezone.trim()) local.timezone = 'Choose a time zone';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setErrors({});
    try {
      await saveMutation.mutateAsync({
        organizationInputMode: mode,
        // Keep the canonical order so the stored list is stable.
        enabledGeofenceModes: GeofenceModeEnum.options.filter((m) => geofenceModes.includes(m)),
        defaultGeofenceToleranceMeters: toleranceNum,
        defaultCurrency: currency.trim().toUpperCase(),
        timezone: timezone.trim(),
      });
    } catch (err) {
      // The mutation hook shows the toast; show field errors here.
      setErrors(serverFieldErrors(err));
    }
  };

  return (
    <form onSubmit={handleSave} noValidate className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-brand-primary" />
          <h3 className="text-sm font-bold text-slate-900">Workspace settings</h3>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Defaults for every project and form in this workspace. Projects can override the geofence tolerance and time
          zone.
        </p>
      </div>

      {/* Organisation input mode */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-800">How organisations are entered</legend>
        <p className="text-[11px] text-slate-500 mt-0.5 mb-2">
          Applies to monitor, lender and contractor fields on projects, and to a user&rsquo;s organisation.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {INPUT_MODES.map((opt) => {
            const checked = mode === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex gap-2.5 rounded-xl border p-3 cursor-pointer transition focus-within:ring-2 focus-within:ring-brand-primary/25 ${
                  checked ? 'border-brand-primary bg-brand-primary/5' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="organizationInputMode"
                  value={opt.value}
                  checked={checked}
                  onChange={() => setMode(opt.value)}
                  className="mt-0.5 h-4 w-4 border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-900">{opt.label}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">{opt.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.organizationInputMode && (
          <p className="text-[11px] text-rose-600 mt-1">{errors.organizationInputMode}</p>
        )}
      </fieldset>

      {/* Geofence modes */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-800">Geofence modes offered on new projects</legend>
        <p className="text-[11px] text-slate-500 mt-0.5 mb-2">
          At least one. A project keeps its mode if you turn that mode off later.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {GeofenceModeEnum.options.map((m) => {
            const checked = geofenceModes.includes(m);
            const meta = GEOFENCE_MODE_META[m];
            return (
              <label
                key={m}
                className={`flex gap-2.5 rounded-xl border p-3 cursor-pointer transition focus-within:ring-2 focus-within:ring-brand-primary/25 ${
                  checked ? 'border-brand-primary bg-brand-primary/5' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleGeofenceMode(m)}
                  className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-900">{meta.label}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">{meta.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.enabledGeofenceModes && (
          <p className="text-[11px] text-rose-600 mt-1">{errors.enabledGeofenceModes}</p>
        )}
      </fieldset>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div>
          <label htmlFor="ws-tolerance" className="block font-semibold text-slate-700 mb-1">
            Default geofence tolerance (m)
          </label>
          <input
            id="ws-tolerance"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            step={1}
            value={tolerance}
            aria-invalid={Boolean(errors.defaultGeofenceToleranceMeters)}
            aria-describedby="ws-tolerance-hint"
            onChange={(e) => setTolerance(e.target.value)}
            className={inputClass(Boolean(errors.defaultGeofenceToleranceMeters))}
          />
          <p id="ws-tolerance-hint" className="text-[11px] text-slate-500 mt-1">
            0 to 1000. Positions this far outside a site boundary still count, and are noted.
          </p>
          {errors.defaultGeofenceToleranceMeters && (
            <p className="text-[11px] text-rose-600 mt-1">{errors.defaultGeofenceToleranceMeters}</p>
          )}
        </div>

        <div>
          <label htmlFor="ws-currency" className="block font-semibold text-slate-700 mb-1">
            Default currency
          </label>
          <input
            id="ws-currency"
            type="text"
            maxLength={3}
            value={currency}
            placeholder="NGN"
            aria-invalid={Boolean(errors.defaultCurrency)}
            aria-describedby="ws-currency-hint"
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className={`${inputClass(Boolean(errors.defaultCurrency))} font-mono uppercase`}
          />
          <p id="ws-currency-hint" className="text-[11px] text-slate-500 mt-1">
            3-letter ISO code, e.g. NGN, USD, GBP.
          </p>
          {errors.defaultCurrency && <p className="text-[11px] text-rose-600 mt-1">{errors.defaultCurrency}</p>}
        </div>

        <div>
          <label htmlFor="ws-timezone" className="block font-semibold text-slate-700 mb-1">
            Time zone
          </label>
          <input
            id="ws-timezone"
            type="text"
            list="ws-timezone-options"
            value={timezone}
            placeholder="Africa/Lagos"
            autoComplete="off"
            aria-invalid={Boolean(errors.timezone)}
            aria-describedby="ws-timezone-hint"
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass(Boolean(errors.timezone))}
          />
          <datalist id="ws-timezone-options">
            {COMMON_TIME_ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <p id="ws-timezone-hint" className="text-[11px] text-slate-500 mt-1">
            Pick from the list or type any IANA zone. Defines the reporting day on new projects.
          </p>
          {errors.timezone && <p className="text-[11px] text-rose-600 mt-1">{errors.timezone}</p>}
        </div>
      </div>

      {errors._ && <p className="text-[11px] text-rose-600">{errors._}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save workspace settings'}
        </button>
      </div>
    </form>
  );
}
