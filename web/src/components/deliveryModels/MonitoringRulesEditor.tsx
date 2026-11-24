import React, { useMemo } from "react";
import { type ProjectTypeConfigInput, VISIT_KIND_META, VisitKindEnum } from "@insite/shared";
import { CustomSelect } from "../common";
import { useTenantRolesQuery } from "../../queries/rbac/useRbacQueries";
import { useFormLibraryQuery } from "../../queries/forms/useFormQueries";

/**
 * Monitoring settings of a project type: the visit form template per visit kind (redesign R3) and
 * who counts as a supervisor with the workload warning limits (Phase 14). Like the type's other
 * rules, projects keep the version they were created with.
 */

export interface MonitoringRules {
  supervision: NonNullable<ProjectTypeConfigInput["supervision"]>;
  /** Redesign R3. */
  visitForms: { templateCodeByVisitKind: Partial<Record<string, string>> };
}

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const label = "text-xs font-medium text-slate-700 mb-1 block";

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
  const { data: library } = useFormLibraryQuery();
  const formTemplates = (library?.templates ?? []).filter((t) => !t.isArchived);
  const formByKind = value.visitForms.templateCodeByVisitKind;
  const allRoles = useMemo(() => roles.map((r) => ({ code: r.code, name: r.name })), [roles]);
  const set = (patch: Partial<MonitoringRules>) => onChange({ ...value, ...patch });
  const supervision = value.supervision;

  return (
    <section className={sectionCls}>
      <div>
        <h3 className="text-sm font-bold text-slate-900">Monitoring: visit forms and supervision</h3>
        <p className="text-[11px] text-slate-500">The visit plan and deadlines are in the next section.</p>
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <h4 className="text-xs font-bold text-slate-900">Visit forms</h4>
        <p className="text-[11px] text-slate-500">
          The visit form template for each visit kind (Forms &amp; facilities page). "Default" uses the template whose code is the visit kind. A project keeps the
          choice it was created with; the latest version of the template is used when a visit's form is built.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {VisitKindEnum.options.map((kind) => {
            const options = formTemplates.filter((t) => t.visitKind === kind);
            const current = formByKind[kind] ?? "";
            const known = !current || options.some((t) => t.code === current);
            return (
              <div key={kind}>
                <span className={label}>{VISIT_KIND_META[kind].label}</span>
                <CustomSelect
                  value={current}
                  onChange={(v) => {
                    const next = { ...formByKind };
                    if (v) next[kind] = v;
                    else delete next[kind];
                    set({ visitForms: { templateCodeByVisitKind: next } });
                  }}
                  options={[
                    { value: "", label: "Default" },
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
