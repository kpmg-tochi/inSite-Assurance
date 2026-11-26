import React from "react";
import type { ProjectTypeConfigInput } from "@insite/shared";
import { CustomSelect } from "../common";
import { useDocumentTypesQuery } from "../../queries/contracts/useContractQueries";
import { useTenantRolesQuery } from "../../queries/rbac/useRbacQueries";

/**
 * Phase 13 settings of a project type, editable since Phase 16: the documents a project needs
 * before it can go live and before mobilisation, and how contractor default cases are handled.
 */

export interface DocumentRules {
  documentRequirements: NonNullable<ProjectTypeConfigInput["documentRequirements"]>;
  defaultCases: NonNullable<ProjectTypeConfigInput["defaultCases"]>;
}

const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const label = "text-xs font-medium text-slate-700 mb-1 block";

function DocumentTypePicker({ value, onChange, types }: { value: string[]; onChange: (next: string[]) => void; types: Array<{ code: string; name: string }> }) {
  const unknown = value.filter((c) => !types.some((t) => t.code === c));
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((t) => {
        const on = value.includes(t.code);
        return (
          <button
            key={t.code}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((c) => c !== t.code) : [...value, t.code])}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${on ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
          >
            {t.name}
          </button>
        );
      })}
      {unknown.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(value.filter((x) => x !== c))}
          title="This document type is not in the workspace (or archived). Click to remove."
          className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
        >
          {c} (not found) ×
        </button>
      ))}
    </div>
  );
}

export function DocumentRulesEditor({ value, onChange }: { value: DocumentRules; onChange: (next: DocumentRules) => void }) {
  const { data: docTypes = [] } = useDocumentTypesQuery(false);
  const { data: roles = [] } = useTenantRolesQuery();
  const types = docTypes.map((t) => ({ code: t.code, name: t.name }));
  const req = value.documentRequirements;
  const cases = value.defaultCases;
  const setReq = (patch: Partial<DocumentRules["documentRequirements"]>) => onChange({ ...value, documentRequirements: { ...req, ...patch } });
  const setCases = (patch: Partial<DocumentRules["defaultCases"]>) => onChange({ ...value, defaultCases: { ...cases, ...patch } });
  const legal = cases.legalRoleCode ?? "";
  const legalKnown = !legal || roles.some((r) => r.code === legal);

  return (
    <section className={sectionCls}>
      <div>
        <h3 className="text-sm font-bold text-slate-900">Required documents and contractor default</h3>
        <p className="text-[11px] text-slate-500">Document types themselves are managed in the Document types card of this settings tab.</p>
      </div>
      <div>
        <span className={label}>Needed before the project can be set live</span>
        <DocumentTypePicker value={req.beforeActivation ?? []} onChange={(beforeActivation) => setReq({ beforeActivation })} types={types} />
      </div>
      <div>
        <span className={label}>Needed before mobilisation (per contractor; counted by the mobilisation documentation KPI)</span>
        <DocumentTypePicker value={req.beforeMobilisation ?? []} onChange={(beforeMobilisation) => setReq({ beforeMobilisation })} types={types} />
      </div>
      <div className="border-t border-slate-100 pt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <span className={label}>Legal role (reviews default cases)</span>
          <CustomSelect
            value={legal}
            onChange={(v) => setCases({ legalRoleCode: v || null })}
            searchable
            options={[
              { value: "", label: "None" },
              ...(!legalKnown ? [{ value: legal, label: `${legal} (not found)` }] : []),
              ...roles.map((r) => ({ value: r.code, label: r.name })),
            ]}
          />
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700 md:mt-5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={cases.autoOpenOnOverdueMobilisation ?? true}
            onChange={(e) => setCases({ autoOpenOnOverdueMobilisation: e.target.checked })}
          />
          <span>
            <span className="font-medium">Open a default case when mobilisation is overdue</span>
            <span className="block text-[11px] text-slate-500">Once per overdue “Mobilised to site” milestone.</span>
          </span>
        </label>
      </div>
    </section>
  );
}
