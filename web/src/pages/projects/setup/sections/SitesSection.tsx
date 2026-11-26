import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, MapPin, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import {
  lgaByCode,
  lgasOfState,
  parseMapsLink,
  ProjectSiteInputSchema,
  SaveProjectSitesRequestSchema,
  SCHOOL_LEVEL_LABELS,
  SchoolLevelEnum,
  SITES_MAX,
  stateByCode,
  type GeocodeResult,
  type ProjectSetupDto,
  type ProjectSiteDto,
} from "@insite/shared";
import { FieldError, visibleError } from "../../../../lib/forms";
import { CustomSelect } from "../../../../components/common";
import { lgaOptions } from "../../../../components/common/AdminAreaSelect";
import { TAB_LIST_CLASS, tabItemClass } from "../../../../components/common/Tabs";
import { SitePinMap, type SitePin } from "../../../../components/sites/SitePinMap";
import { FindAddressButton, FoundAddressNote, useAddressLookupEnabled } from "../../../../components/geofence/FindAddressButton";
import { addressQuery } from "../../../../components/geofence/addressQuery";
import { SiteStatusChip, sitePercentText } from "../../../../components/sites/siteStatus";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { projectSitesKey } from "../../../../queries/sites";
import {
  inputClass,
  labelClass,
  numberOrNull,
  setField,
  StepSection,
  textOrNull,
  textProps,
  useLatestSetup,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

type LocationMode = "COORDINATES" | "ADDRESS";

/** One site card. `key`, `mode` are display-only (left out of the dirty check and the request). */
interface SiteRow {
  key: string;
  id?: string;
  schoolName: string;
  schoolLevel: string;
  lgaCode: string;
  mode: LocationMode;
  address: string;
  latitude: string;
  longitude: string;
}

interface SitesValues {
  sites: SiteRow[];
}

let rowSeq = 0;
const newKey = () => `site-${++rowSeq}`;

function rowFrom(s: ProjectSiteDto): SiteRow {
  const located = s.latitude !== null && s.longitude !== null;
  return {
    key: s.id,
    id: s.id,
    schoolName: s.schoolName,
    schoolLevel: s.schoolLevel,
    lgaCode: s.lgaCode,
    mode: located || !s.address ? "COORDINATES" : "ADDRESS",
    address: s.address ?? "",
    latitude: s.latitude === null ? "" : String(s.latitude),
    longitude: s.longitude === null ? "" : String(s.longitude),
  };
}

const sitesFrom = (setup: ProjectSetupDto): SitesValues => ({ sites: (setup.sites?.sites ?? []).map(rowFrom) });

/** Compares form state without display-only fields. */
const sitesKey = (v: SitesValues) =>
  JSON.stringify((v.sites ?? []).map(({ key: _k, mode: _m, ...rest }) => rest));

const LATITUDE_MESSAGE = "Latitude is a number from -90 to 90";
const LONGITUDE_MESSAGE = "Longitude is a number from -180 to 180";

/**
 * Form schema: the cards hold text; the output is `SaveProjectSitesRequestSchema` (the full list).
 * Built per state: the LGA must be in the project's state (the server checks it again).
 */
function sitesFormSchema(stateCode: string | null) {
  const stateLgas = new Set(lgasOfState(stateCode).map((l) => l.code));
  const stateName = stateByCode(stateCode)?.name ?? "the project's state";
  return z
    .object({
      sites: z.array(
        z.object({
          key: z.string(),
          id: z.string().optional(),
          schoolName: ProjectSiteInputSchema.shape.schoolName,
          schoolLevel: z.string().min(1, "Choose the school level").pipe(SchoolLevelEnum),
          lgaCode: z
            .string()
            .min(1, stateCode ? "Choose the LGA" : "Choose the state in Project details first")
            .refine((v) => !stateCode || stateLgas.has(v), `This LGA is not in ${stateName}`),
          mode: z.enum(["COORDINATES", "ADDRESS"]),
          address: textOrNull().pipe(z.string().max(300, "Up to 300 characters").nullable()),
          latitude: numberOrNull("Latitude").pipe(z.number().min(-90, LATITUDE_MESSAGE).max(90, LATITUDE_MESSAGE).nullable()),
          longitude: numberOrNull("Longitude").pipe(z.number().min(-180, LONGITUDE_MESSAGE).max(180, LONGITUDE_MESSAGE).nullable()),
        })
      ),
    })
    .superRefine((v, ctx) => {
      v.sites.forEach((s, i) => {
        if (s.latitude === null && s.longitude !== null) {
          ctx.addIssue({ code: "custom", path: ["sites", i, "latitude"], message: "Enter the latitude as well" });
        }
        if (s.longitude === null && s.latitude !== null) {
          ctx.addIssue({ code: "custom", path: ["sites", i, "longitude"], message: "Enter the longitude as well" });
        }
      });
    })
    .transform((v) => ({
      sites: v.sites.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        schoolName: s.schoolName,
        schoolLevel: s.schoolLevel,
        lgaCode: s.lgaCode,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
    }))
    .pipe(SaveProjectSitesRequestSchema);
}

/** A number typed in a coordinate field, or null when it is not one yet. */
function coordinate(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const SHORT_LINK_RE = /(maps\.app\.goo\.gl|goo\.gl\/maps)/i;

/** Server codes that belong to one site's field. */
const SITE_ERROR_FIELD: Record<string, "lgaCode"> = {
  SITE_LGA_NOT_IN_STATE: "lgaCode",
  LGA_NOT_IN_STATE: "lgaCode",
};

/** The card a coded server error is about, from whatever its details name (index, number, id or LGA). */
function siteIndexFromError(details: Record<string, unknown> | undefined, rows: SiteRow[]): number | null {
  if (!details) return null;
  const idx = details.siteIndex ?? details.index;
  if (typeof idx === "number" && idx >= 0 && idx < rows.length) return idx;
  const num = details.siteNumber;
  if (typeof num === "number" && num >= 1 && num <= rows.length) return num - 1;
  const ids = [details.siteId, ...(Array.isArray(details.siteIds) ? details.siteIds : [])].filter((x): x is string => typeof x === "string");
  for (const id of ids) {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) return i;
  }
  if (typeof details.schoolName === "string" && typeof details.lgaCode === "string") {
    const i = rows.findIndex((r) => r.schoolName.trim() === details.schoolName && r.lgaCode === details.lgaCode);
    if (i >= 0) return i;
  }
  if (typeof details.lgaCode === "string") {
    const i = rows.findIndex((r) => r.lgaCode === details.lgaCode);
    if (i >= 0) return i;
  }
  return null;
}

/**
 * Client demo updates C2 (wave 2): section `sites` (step 1 Project). The schools of a multi-site
 * project: school name and level, LGA (in the project's state), and a location as coordinates (typed,
 * or read from a pasted Google Maps link or "lat, lng") or an address (kept as written). D3: with the
 * workspace address lookup, "Find address" places the pin from the school name, address and LGA, and
 * pins can be dragged on the map. Each located site gets a radial boundary of the workspace default
 * radius. No sites = a single-site project that uses the Location section's boundary.
 */
export function SitesSection({ projectId, setup, readOnly }: StepProps) {
  const queryClient = useQueryClient();
  const stateCode = setup.basics.stateCode ?? setup.sites?.stateCode ?? null;
  const stateName = stateByCode(stateCode)?.name ?? null;
  const radius = setup.sites?.defaultRadiusMeters ?? setup.site.tenantDefaultRadiusMeters;
  const schema = useMemo(() => sitesFormSchema(stateCode), [stateCode]);
  const initial = useMemo(() => sitesFrom(setup), [setup]);
  const section = useSectionForm(schema, initial, sitesKey);
  const { form, dirty } = section;
  const watchedRows = (section.values as SitesValues).sites;
  const rows = useMemo(() => watchedRows ?? [], [watchedRows]);
  const [general, setGeneral] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState<Record<string, { text: string; message: string | null }>>({});
  /** D3: the last "Find address" match per card, and whether its pin was moved by hand since. */
  const [found, setFound] = useState<Record<string, { result: GeocodeResult; moved: boolean }>>({});
  const lookupEnabled = useAddressLookupEnabled();
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);
  const err = (name: string) => visibleError(form, name);
  const savedById = useMemo(() => new Map((setup.sites?.sites ?? []).map((s) => [s.id, s])), [setup.sites]);
  const lgaList = useMemo(() => lgaOptions(stateCode), [stateCode]);
  const levelOptions = SchoolLevelEnum.options.map((l) => ({ value: l as string, label: SCHOOL_LEVEL_LABELS[l] }));

  const setRows = (next: SiteRow[], touch = false) => setField(form, "sites", next, touch);
  const patchRow = (key: string, patch: Partial<SiteRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows([
      ...rows,
      { key: newKey(), schoolName: "", schoolLevel: "", lgaCode: "", mode: "COORDINATES", address: "", latitude: "", longitude: "" },
    ]);
  const removeRow = (key: string) => setRows(rows.filter((r) => r.key !== key), true);
  const moveRow = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    setRows(next);
  };

  const onPaste = (row: SiteRow, text: string) => {
    if (!text.trim()) {
      setPaste((p) => ({ ...p, [row.key]: { text, message: null } }));
      return;
    }
    const coords = parseMapsLink(text);
    if (coords) {
      patchRow(row.key, { latitude: String(coords.latitude), longitude: String(coords.longitude) });
      setPaste((p) => ({ ...p, [row.key]: { text: "", message: null } }));
      setFound(({ [row.key]: _dropped, ...rest }) => rest);
      return;
    }
    const message = SHORT_LINK_RE.test(text)
      ? "Open the link and copy the full address bar, or paste the coordinates"
      : 'No coordinates found. Paste a Google Maps link or "lat, lng", e.g. 12.0022, 8.5920';
    setPaste((p) => ({ ...p, [row.key]: { text, message } }));
  };

  /** D3: a found address sets the pin, and the address text when none was typed. */
  const pickAddress = (row: SiteRow, result: GeocodeResult) => {
    patchRow(row.key, {
      latitude: String(result.latitude),
      longitude: String(result.longitude),
      address: row.address.trim() ? row.address : result.formattedAddress.slice(0, 300),
    });
    setPaste((p) => ({ ...p, [row.key]: { text: "", message: null } }));
    setFound((f) => ({ ...f, [row.key]: { result, moved: false } }));
  };

  /** A pin dragged on the map. */
  const movePin = (key: string, latitude: number, longitude: number) => {
    patchRow(key, { latitude: String(latitude), longitude: String(longitude) });
    setFound((f) => (f[key] ? { ...f, [key]: { ...f[key], moved: true } } : f));
  };

  useRegisterSection(
    "sites",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const body = await section.submit(dirty ? undefined : sitesFrom(latest()));
      if (!body) return false;
      try {
        await save.mutateAsync({ sectionId: "sites", body, silent: opts?.silent });
        section.reset(sitesFrom(latest()));
        setGeneral(null);
        setRowErrors({});
        void queryClient.invalidateQueries({ queryKey: projectSitesKey(projectId) });
        return true;
      } catch (error) {
        const apiError = (error as { response?: { data?: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } } })
          ?.response?.data?.error;
        const code = apiError?.code;
        if (code && code !== "VALIDATION_ERROR") {
          const index = siteIndexFromError(apiError?.details, rows);
          const field = SITE_ERROR_FIELD[code];
          const message = apiError?.message || "Check this site";
          if (index !== null && field) {
            form.setError(`sites.${index}.${field}`, { type: "server", message });
            setGeneral(null);
          } else if (index !== null) {
            setRowErrors({ [rows[index].key]: message });
            setGeneral(null);
          } else {
            setGeneral(message);
          }
          return false;
        }
        setGeneral(section.showServerErrors(error));
        return false;
      }
    },
    section
  );

  const pins = useMemo<SitePin[]>(
    () =>
      rows.flatMap((r, i) => {
        const lat = coordinate(r.latitude);
        const lng = coordinate(r.longitude);
        if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
        return [{ key: r.key, latitude: lat, longitude: lng, label: `Site ${i + 1}${r.schoolName ? ` · ${r.schoolName}` : ""}` }];
      }),
    [rows]
  );
  const canAdd = !readOnly && Boolean(stateCode) && rows.length < SITES_MAX;

  return (
    <StepSection
      title="Sites (optional)"
      description={`The schools this project delivers at, all in ${stateName ?? "the project's state"}. Each located site gets a radial boundary of the workspace default radius (${radius} m); monitoring visit check-ins at a site are checked against it.`}
      actions={
        !readOnly && (
          <button
            type="button"
            onClick={addRow}
            disabled={!canAdd}
            title={!stateCode ? "Choose the state in Project details first" : rows.length >= SITES_MAX ? `Up to ${SITES_MAX} sites` : undefined}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add site
          </button>
        )
      }
    >
      {!stateCode && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Choose the state in Project details first: every site's LGA must be in the project's state.
        </p>
      )}
      {general && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {general}
        </p>
      )}
      {rows.length === 0 && (
        <p className="text-xs text-slate-500">
          No sites: this is a single-site project, and the Location section's boundary is used. Add sites when the project
          covers several schools.
        </p>
      )}

      <ol className="space-y-3">
        {rows.map((r, i) => {
          const saved = r.id ? savedById.get(r.id) : undefined;
          const inUse = Boolean(saved && saved.unitCount > 0);
          const fid = (f: string) => `site-${r.key}-${f}`;
          const name = (f: string) => `sites.${i}.${f}`;
          const pasteState = paste[r.key];
          const lat = coordinate(r.latitude);
          const lng = coordinate(r.longitude);
          const located = lat !== null && lng !== null;
          const match = found[r.key];
          // The note stays while the pin is where the lookup (or a drag) put it, not after typed coordinates.
          const showMatch = Boolean(match && (match.moved || (lat === match.result.latitude && lng === match.result.longitude)));
          const lgaName = lgaByCode(r.lgaCode)?.name ?? null;
          return (
            <li key={r.key} className="rounded-xl border border-slate-200 p-3 space-y-3" aria-label={`Site ${i + 1}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs font-bold text-slate-900">Site {i + 1}</span>
                  {saved && (
                    <>
                      <SiteStatusChip status={saved.status} />
                      <span className="text-xs text-slate-600 tabular-nums">{sitePercentText(saved.progressPct)} complete</span>
                      <span className="text-xs text-slate-500">
                        {saved.unitCount} facility unit{saved.unitCount === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                  {!located && (
                    <span className="text-[11px] text-amber-800">Not located yet: add coordinates before the project is activated</span>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveRow(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move site ${i + 1} up`}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={`Move site ${i + 1} down`}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      disabled={inUse}
                      title={inUse ? "Facility units are at this site. Move them to another site first." : undefined}
                      className="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Remove
                    </button>
                  </div>
                )}
              </div>

              {rowErrors[r.key] && (
                <p className="text-xs font-medium text-red-600" role="alert">
                  {rowErrors[r.key]}
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-5">
                  <label className={labelClass} htmlFor={fid("school")}>
                    School name
                  </label>
                  <input
                    id={fid("school")}
                    className={inputClass(Boolean(err(name("schoolName"))))}
                    maxLength={200}
                    placeholder="e.g. Kofar Mata Primary School"
                    {...textProps(form, name("schoolName"))}
                    disabled={readOnly}
                  />
                  <FieldError form={form} name={name("schoolName")} />
                </div>
                <div className="md:col-span-3">
                  <CustomSelect
                    label="School level"
                    value={r.schoolLevel}
                    onChange={(v) => {
                      setField(form, name("schoolLevel"), v, true);
                    }}
                    options={levelOptions}
                    placeholder="Choose"
                    error={err(name("schoolLevel"))}
                    disabled={readOnly}
                  />
                </div>
                <div className="md:col-span-4">
                  {stateCode ? (
                    <CustomSelect
                      label="LGA"
                      value={r.lgaCode}
                      onChange={(v) => setField(form, name("lgaCode"), v, true)}
                      options={
                        r.lgaCode && !lgaList.some((o) => o.value === r.lgaCode)
                          ? [{ value: r.lgaCode, label: lgaByCode(r.lgaCode)?.name ?? r.lgaCode }, ...lgaList]
                          : lgaList
                      }
                      placeholder="Choose the LGA"
                      searchable
                      error={err(name("lgaCode"))}
                      disabled={readOnly}
                    />
                  ) : (
                    <>
                      <span className={labelClass}>LGA</span>
                      <p className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
                        Choose the state in Project details first
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold text-slate-700">Location</span>
                  <div role="group" aria-label={`Site ${i + 1} location as`} className={TAB_LIST_CLASS}>
                    {(
                      [
                        ["COORDINATES", "Coordinates"],
                        ["ADDRESS", "Address"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={r.mode === mode}
                        onClick={() => patchRow(r.key, { mode })}
                        className={tabItemClass(r.mode === mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {!readOnly && (
                    <FindAddressButton
                      query={addressQuery([r.schoolName, r.address, lgaName])}
                      stateCode={stateCode}
                      onPick={(result) => pickAddress(r, result)}
                    />
                  )}
                </div>
                {showMatch && match && <FoundAddressNote result={match.result} moved={match.moved} />}

                {r.mode === "COORDINATES" ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                    <div className="md:col-span-6">
                      <label className={labelClass} htmlFor={fid("paste")}>
                        Paste a Google Maps link or "lat, lng"
                      </label>
                      <input
                        id={fid("paste")}
                        className={inputClass(Boolean(pasteState?.message))}
                        value={pasteState?.text ?? ""}
                        onChange={(e) => onPaste(r, e.target.value)}
                        placeholder="https://www.google.com/maps/@12.0022,8.5920,17z"
                        disabled={readOnly}
                        aria-describedby={pasteState?.message ? fid("paste-msg") : undefined}
                      />
                      {pasteState?.message && (
                        <p id={fid("paste-msg")} className="mt-1 text-[11px] font-medium text-amber-800">
                          {pasteState.message}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-3">
                      <label className={labelClass} htmlFor={fid("lat")}>
                        Latitude
                      </label>
                      <input
                        id={fid("lat")}
                        inputMode="decimal"
                        className={inputClass(Boolean(err(name("latitude"))))}
                        placeholder="12.0022"
                        {...textProps(form, name("latitude"))}
                        disabled={readOnly}
                      />
                      <FieldError form={form} name={name("latitude")} />
                    </div>
                    <div className="md:col-span-3">
                      <label className={labelClass} htmlFor={fid("lng")}>
                        Longitude
                      </label>
                      <input
                        id={fid("lng")}
                        inputMode="decimal"
                        className={inputClass(Boolean(err(name("longitude"))))}
                        placeholder="8.5920"
                        {...textProps(form, name("longitude"))}
                        disabled={readOnly}
                      />
                      <FieldError form={form} name={name("longitude")} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className={labelClass} htmlFor={fid("address")}>
                      Address
                    </label>
                    <input
                      id={fid("address")}
                      className={inputClass(Boolean(err(name("address"))))}
                      maxLength={300}
                      placeholder="Street, town and LGA as people write it"
                      {...textProps(form, name("address"))}
                      disabled={readOnly}
                    />
                    <FieldError form={form} name={name("address")} />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {located
                        ? `Shown on reports. The pin is at ${lat}, ${lng}${lookupEnabled ? " (Find address, Coordinates or drag it on the map)" : " (set under Coordinates)"}.`
                        : lookupEnabled
                          ? "Shown on reports. Use Find address to place it on the map, or add the coordinates under Coordinates, before the project is activated."
                          : "Shown on reports. An address is not turned into a map position: add the coordinates under Coordinates before the project is activated."}
                    </p>
                  </div>
                )}
                {r.mode === "COORDINATES" && r.address.trim() && (
                  <p className="text-[11px] text-slate-500">Address: {r.address}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {pins.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> Located sites and their boundaries ({radius} m)
            {!readOnly && <span className="font-normal text-slate-500">· drag a pin to correct it</span>}
          </p>
          <SitePinMap pins={pins} radiusMeters={radius} onPinMove={readOnly ? undefined : movePin} />
          {pins.length < rows.length && (
            <p className="text-[11px] text-slate-500">
              {rows.length - pins.length} of {rows.length} sites are not on the map yet.
            </p>
          )}
        </div>
      )}
      <FieldError form={form} name="sites" />
    </StepSection>
  );
}
