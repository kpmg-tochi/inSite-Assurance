import { useEffect } from 'react';
import { z } from 'zod';
import { SlidersHorizontal } from 'lucide-react';
import {
  COMMON_TIME_ZONES,
  GEOFENCE_MODE_META,
  GeofenceModeEnum,
  OrgInputModeEnum,
  UpdateTenantSettingsRequestSchema,
  type GeofenceMode,
  type OrgInputMode,
  type TenantSettingsDto,
} from '@insite/shared';
import { useTenantSettingsQuery } from '../../queries/organizations/useOrganizationQueries';
import { useUpdateTenantSettingsMutation } from '../../mutations/organizations/useOrganizationMutations';
import { SubmitButton, useZodForm, visibleError } from '../../lib/forms';
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

/** A whole number typed into a number input, within [min, max]. Output is a number. */
const wholeNumberText = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max, message)
    .transform(Number);

/** The inputs, mapped to UpdateTenantSettingsRequestSchema (which still decides). */
const WorkspaceSettingsFormSchema = z
  .object({
    organizationInputMode: OrgInputModeEnum,
    enabledGeofenceModes: z.array(GeofenceModeEnum).min(1, 'Enable at least one geofence mode'),
    defaultGeofenceToleranceMeters: wholeNumberText(0, 1000, 'Enter a whole number from 0 to 1000'),
    defaultGeofenceRadiusMeters: wholeNumberText(20, 50000, 'Enter a whole number from 20 to 50,000'),
    visitRescheduleToleranceWorkdays: wholeNumberText(0, 10, 'Enter a whole number from 0 to 10'),
    defaultCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter ISO 4217 code, e.g. NGN'),
    timezone: z.string().trim().min(1, 'Choose a time zone'),
  })
  .transform((v) => ({
    ...v,
    // Keep the canonical order so the stored list is stable.
    enabledGeofenceModes: GeofenceModeEnum.options.filter((m) => v.enabledGeofenceModes.includes(m)),
    defaultCurrency: v.defaultCurrency.toUpperCase(),
  }))
  .pipe(UpdateTenantSettingsRequestSchema);
type WorkspaceSettingsFormValues = z.input<typeof WorkspaceSettingsFormSchema>;

const formDefaults = (data: TenantSettingsDto | undefined): WorkspaceSettingsFormValues => ({
  organizationInputMode: data?.organizationInputMode ?? 'BOTH',
  enabledGeofenceModes: data?.enabledGeofenceModes ?? [],
  defaultGeofenceToleranceMeters: String(data?.defaultGeofenceToleranceMeters ?? 100),
  defaultGeofenceRadiusMeters: String(data?.defaultGeofenceRadiusMeters ?? 150),
  visitRescheduleToleranceWorkdays: String(data?.visitRescheduleToleranceWorkdays ?? 2),
  defaultCurrency: data?.defaultCurrency ?? '',
  timezone: data?.timezone ?? '',
});

/** Tenant-wide defaults used by forms and projects (Phase 6). Requires `tenant:manage_settings`. */
export function WorkspaceSettingsCard() {
  const { data, isLoading } = useTenantSettingsQuery();
  const saveMutation = useUpdateTenantSettingsMutation();

  const form = useZodForm(WorkspaceSettingsFormSchema, { defaultValues: formDefaults(undefined) });
  const { register, reset, watch, setValue, setError, handleSubmit, formState } = form;
  const mode = watch('organizationInputMode');
  const geofenceModes = watch('enabledGeofenceModes');

  useEffect(() => {
    if (!data) return;
    reset(formDefaults(data));
  }, [data, reset]);

  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex justify-center">
        <Loader size="sm" inline />
      </div>
    );
  }

  // Client checks once touched; server issues (set after a failed save) once submitted.
  const errors: FieldErrors = {
    organizationInputMode: visibleError(form, 'organizationInputMode'),
    enabledGeofenceModes: visibleError(form, 'enabledGeofenceModes'),
    defaultGeofenceToleranceMeters: visibleError(form, 'defaultGeofenceToleranceMeters'),
    defaultGeofenceRadiusMeters: visibleError(form, 'defaultGeofenceRadiusMeters'),
    visitRescheduleToleranceWorkdays: visibleError(form, 'visitRescheduleToleranceWorkdays'),
    defaultCurrency: visibleError(form, 'defaultCurrency'),
    timezone: visibleError(form, 'timezone'),
    _: formState.errors.root?.server?.message,
  };

  const toggleGeofenceMode = (m: GeofenceMode) =>
    setValue(
      'enabledGeofenceModes',
      geofenceModes.includes(m) ? geofenceModes.filter((x) => x !== m) : [...geofenceModes, m],
      { shouldDirty: true, shouldTouch: true, shouldValidate: true }
    );

  const handleSave = handleSubmit(async (payload) => {
    try {
      await saveMutation.mutateAsync(payload);
    } catch (err) {
      // The mutation hook shows the toast; show field errors here.
      for (const [key, message] of Object.entries(serverFieldErrors(err))) {
        if (!message) continue;
        if (key === '_' || !(key in formDefaults(undefined))) setError('root.server', { type: 'server', message });
        else setError(key as keyof WorkspaceSettingsFormValues, { type: 'server', message });
      }
    }
  });

  return (
    <form onSubmit={handleSave} noValidate className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-brand-primary" />
          <h3 className="text-sm font-bold text-slate-900">Workspace settings</h3>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Defaults for every project and form in this workspace. Projects can override the geofence radius, tolerance and
          time zone.
        </p>
      </div>

      {/* Organisation input mode */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-800">How organisations are entered</legend>
        <p className="text-[11px] text-slate-500 mt-0.5 mb-2">
          Applies to monitor, funder and contractor fields on projects, and to a user&rsquo;s organisation.
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
                  value={opt.value}
                  {...register('organizationInputMode')}
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
            {...register('defaultGeofenceToleranceMeters')}
            aria-invalid={Boolean(errors.defaultGeofenceToleranceMeters)}
            aria-describedby="ws-tolerance-hint"
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
          <label htmlFor="ws-radius" className="block font-semibold text-slate-700 mb-1">
            Default site radius (m)
          </label>
          <input
            id="ws-radius"
            type="number"
            inputMode="numeric"
            min={20}
            max={50000}
            step={1}
            {...register('defaultGeofenceRadiusMeters')}
            aria-invalid={Boolean(errors.defaultGeofenceRadiusMeters)}
            aria-describedby="ws-radius-hint"
            className={inputClass(Boolean(errors.defaultGeofenceRadiusMeters))}
          />
          <p id="ws-radius-hint" className="text-[11px] text-slate-500 mt-1">
            20 to 50,000. A new radial site boundary, and the one made from a needs assessment's GPS point, start with this radius.
            Each project can change its own.
          </p>
          {errors.defaultGeofenceRadiusMeters && (
            <p className="text-[11px] text-rose-600 mt-1">{errors.defaultGeofenceRadiusMeters}</p>
          )}
        </div>

        <div>
          <label htmlFor="ws-visit-tolerance" className="block font-semibold text-slate-700 mb-1">
            Visit move tolerance (working days)
          </label>
          <input
            id="ws-visit-tolerance"
            type="number"
            inputMode="numeric"
            min={0}
            max={10}
            step={1}
            {...register('visitRescheduleToleranceWorkdays')}
            aria-invalid={Boolean(errors.visitRescheduleToleranceWorkdays)}
            aria-describedby="ws-visit-tolerance-hint"
            className={inputClass(Boolean(errors.visitRescheduleToleranceWorkdays))}
          />
          <p id="ws-visit-tolerance-hint" className="text-[11px] text-slate-500 mt-1">
            0 to 10. An officer may move a visit this many working days either side of its original date, within the same work phase, without asking. Further moves are proposed to the manager.
          </p>
          {errors.visitRescheduleToleranceWorkdays && (
            <p className="text-[11px] text-rose-600 mt-1">{errors.visitRescheduleToleranceWorkdays}</p>
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
            {...register('defaultCurrency', { setValueAs: (v: string) => v.toUpperCase() })}
            placeholder="NGN"
            aria-invalid={Boolean(errors.defaultCurrency)}
            aria-describedby="ws-currency-hint"
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
            {...register('timezone')}
            placeholder="Africa/Lagos"
            autoComplete="off"
            aria-invalid={Boolean(errors.timezone)}
            aria-describedby="ws-timezone-hint"
            className={inputClass(Boolean(errors.timezone))}
          />
          <datalist id="ws-timezone-options">
            {COMMON_TIME_ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <p id="ws-timezone-hint" className="text-[11px] text-slate-500 mt-1">
            Pick from the list or type any IANA zone. New projects count their dates (visit days, deadlines) in this zone.
          </p>
          {errors.timezone && <p className="text-[11px] text-rose-600 mt-1">{errors.timezone}</p>}
        </div>
      </div>

      {errors._ && <p className="text-[11px] text-rose-600">{errors._}</p>}

      <div className="flex justify-end">
        <SubmitButton
          form={form}
          pending={saveMutation.isPending}
          pendingLabel="Saving..."
          hint="Fix the highlighted settings to save."
          className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
        >
          Save workspace settings
        </SubmitButton>
      </div>
    </form>
  );
}
