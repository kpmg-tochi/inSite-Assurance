import React, { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  INSPECTION_VISIT_TYPE_LABELS,
  InspectionVisitTypeEnum,
  REPORTING_STREAM_KIND_LABELS,
  type InspectionVisitType,
  type ProjectTypeConfigInput,
  type ReportingStreamKind,
} from "@insite/shared";
import { CustomSelect } from "../common";
import { useTenantRolesQuery } from "../../queries/rbac/useRbacQueries";
import { useChecklistTemplatesQuery } from "../../queries/inspections/useInspectionQueries";
import { CadenceFields } from "./CadenceFields";

/**
 * Phase 14 settings of a project type, editable since Phase 16: the reporting streams created on
 * each new project (roles by code), the checklist template per visit type, and who counts as a
 * supervisor with the workload warning limits. Like the type's other rules, projects keep the
 * version they were created with.
 */

type StreamInput = NonNullable<ProjectTypeConfigInput["reportingStreams"]>[number];
export interface MonitoringRules {
  reportingStreams: StreamInput[];
  inspections: NonNullable<ProjectTypeConfigInput["inspections"]>;
  supervision: NonNullable<ProjectTypeConfigInput["supervision"]>;
}

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const label = "text-xs font-medium text-slate-700 mb-1 block";

function slug(text: string, taken: string[]): string {
  let base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!/^[a-z]/.test(base)) base = `stream-${base}`.replace(/-+$/, "");
  if (base.length < 2) base = "stream";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}-${n}`;
  return key;
}

/** Role chips by code: codes that no longer exist in the tenant are kept and marked. */
export function RoleCodePicker({
  value,
  onChange,
  roles,
  emptyHint,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  roles: Array<{ code: string; name: string }>;
  emptyHint?: string;
}) {
  const unknown = value.filter((c) => !roles.some((r) => r.code === c));
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((r) => {
        const on = value.includes(r.code);
        return (
          <button
            key={r.code}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((c) => c !== r.code) : [...value, r.code])}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${on ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
          >
            {r.name}
          </button>
        );
      })}
      {unknown.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(value.filter((x) => x !== c))}
          title="This role code is not in the workspace. Click to remove."
          className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
        >
          {c} (unknown) ×
        </button>
      ))}
      {roles.length === 0 && unknown.length === 0 && <span className="text-[11px] text-slate-500">{emptyHint ?? "No roles available."}</span>}
    </div>
  );
}

export function MonitoringRulesEditor({ value, onChange }: { value: MonitoringRules; onChange: (next: MonitoringRules) => void }) {
  const { data: roles = [] } = useTenantRolesQuery();
  const { data: templates = [] } = useChecklistTemplatesQuery(false);
  const fieldRoles = useMemo(() => roles.filter((r) => r.surface !== "WEB").map((r) => ({ code: r.code, name: r.name })), [roles]);
  const allRoles = useMemo(() => roles.map((r) => ({ code: r.code, name: r.name })), [roles]);
  const streams = value.reportingStreams;
  const set = (patch: Partial<MonitoringRules>) => onChange({ ...value, ...patch });
  const setStream = (i: number, patch: Partial<StreamInput>) => set({ reportingStreams: streams.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const templateByType = value.inspections.templateCodeByVisitType ?? {};
  const supervision = value.supervision;

  return (
    <section className={sectionCls}>
      <div>
        <h3 className="text-sm font-bold text-slate-900">Monitoring: streams, inspections and supervision</h3>
        <p className="text-[11px] text-slate-500">
          Streams are created on each new project of this type (they can be changed per project in the Reporting step). With no stream,
          projects report on the Reporting defaults below.
        </p>
      </div>

      <div className="space-y-3">
        {streams.map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className={label}>
                Name
                <input
                  className={inputCls}
                  value={s.label}
                  placeholder="e.g. Resident supervision"
                  onChange={(e) => setStream(i, { label: e.target.value })}
                  // The key is filled from the name once; after that it stays as saved.
                  onBlur={() => !s.key && s.label.trim() && setStream(i, { key: slug(s.label, streams.filter((_, j) => j !== i).map((x) => x.key)) })}
                />
              </label>
              <div>
                <span className={label}>Kind</span>
                <CustomSelect
                  value={s.kind}
                  onChange={(v) =>
                    setStream(i, {
                      kind: v as ReportingStreamKind,
                      visitType: v === "INSPECTION" ? s.visitType ?? "ROUTINE" : null,
                      submissionDeadlineDays: v === "INSPECTION" ? s.submissionDeadlineDays ?? 7 : null,
                    })
                  }
                  options={Object.entries(REPORTING_STREAM_KIND_LABELS).map(([k, l]) => ({ value: k, label: l }))}
                />
              </div>
              {s.kind === "INSPECTION" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className={label}>Visit type</span>
                    <CustomSelect
                      value={s.visitType ?? "ROUTINE"}
                      onChange={(v) => setStream(i, { visitType: v as InspectionVisitType })}
                      options={InspectionVisitTypeEnum.options.map((v) => ({ value: v, label: INSPECTION_VISIT_TYPE_LABELS[v] }))}
                    />
                  </div>
                  <label className={label}>
                    Upload within (days)
                    <input
                      type="number"
                      min={0}
                      max={90}
                      className={inputCls}
                      value={s.submissionDeadlineDays ?? ""}
                      onChange={(e) => setStream(i, { submissionDeadlineDays: e.target.value ? Number(e.target.value) : null })}
                    />
                  </label>
                </div>
              )}
            </div>
            <CadenceFields
              value={{ ...s, quarterMonth: s.quarterAnchorMonth ?? null }}
              onChange={({ quarterMonth, ...patch }) => setStream(i, { ...patch, ...(quarterMonth !== undefined ? { quarterAnchorMonth: quarterMonth } : {}) })}
              maxCustomDays={366}
              maxGraceMinutes={7 * 24 * 60}
            />
            <fieldset>
              <legend className={label}>Owed by (roles)</legend>
              <RoleCodePicker value={s.roleCodes} onChange={(roleCodes) => setStream(i, { roleCodes })} roles={fieldRoles} emptyHint="No mobile roles in this workspace." />
            </fieldset>
            <div className="flex justify-between items-center gap-3 text-[11px] text-slate-500">
              <label className="flex items-center gap-2">
                Key
                <input
                  className="w-48 rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-900"
                  value={s.key}
                  placeholder="e.g. resident-supervision"
                  onChange={(e) => setStream(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                />
              </label>
              <button type="button" onClick={() => set({ reportingStreams: streams.filter((_, j) => j !== i) })} className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          disabled={streams.length >= 10}
          onClick={() =>
            set({
              reportingStreams: [
                ...streams,
                { key: "", label: "", kind: "ITEM_REPORTS", roleCodes: [], reportingCadence: "WEEKLY" },
              ],
            })
          }
          className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add stream
        </button>
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <h4 className="text-xs font-bold text-slate-900">Checklist template per visit type</h4>
        <p className="text-[11px] text-slate-500">The latest version of the chosen template is used. Templates are managed in Settings → Inspections &amp; supervisors.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {InspectionVisitTypeEnum.options.map((vt) => {
            const options = templates.filter((t) => t.visitTypes.includes(vt));
            const current = templateByType[vt] ?? "";
            const known = !current || options.some((t) => t.code === current);
            return (
              <div key={vt}>
                <span className={label}>{INSPECTION_VISIT_TYPE_LABELS[vt]}</span>
                <CustomSelect
                  value={current}
                  onChange={(v) => {
                    const next = { ...templateByType };
                    if (v) next[vt] = v;
                    else delete next[vt];
                    set({ inspections: { ...value.inspections, templateCodeByVisitType: next } });
                  }}
                  options={[
                    { value: "", label: "None" },
                    ...(!known ? [{ value: current, label: `${current} (not found)` }] : []),
                    ...options.map((t) => ({ value: t.code, label: `${t.name} (${t.code})` })),
                  ]}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <h4 className="text-xs font-bold text-slate-900">Supervision</h4>
        <p className="text-[11px] text-slate-500">
          Users in these roles count as supervisors (workload view, "supervisor assigned" KPI). Above the limits the system warns; it never blocks.
        </p>
        <RoleCodePicker
          value={supervision.supervisorRoleCodes ?? []}
          onChange={(supervisorRoleCodes) => set({ supervision: { ...supervision, supervisorRoleCodes } })}
          roles={allRoles}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className={label}>
            Most sites per supervisor (blank: no limit)
            <input
              type="number"
              min={1}
              max={500}
              className={inputCls}
              value={supervision.maxSitesPerSupervisor ?? ""}
              onChange={(e) => set({ supervision: { ...supervision, maxSitesPerSupervisor: e.target.value ? Math.trunc(Number(e.target.value)) : null } })}
            />
          </label>
          <label className={label}>
            Furthest distance between a supervisor's sites, km (blank: no limit)
            <input
              type="number"
              min={0.1}
              max={5000}
              step={0.1}
              className={inputCls}
              value={supervision.maxSpreadKm ?? ""}
              onChange={(e) => set({ supervision: { ...supervision, maxSpreadKm: e.target.value ? Number(e.target.value) : null } })}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
