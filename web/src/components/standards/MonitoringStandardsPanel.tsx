import React, { useMemo } from "react";
import {
  FACILITY_ARCHETYPE_META,
  FORM_FIELD_TYPE_LABELS,
  VISIT_KIND_META,
  type FacilitySubFormDto,
  type FormField,
  type FormLibraryDto,
  type FormSectionDto,
} from "@insite/shared";
import { EmptyPanel, cardCls } from "../needs/needsUi";

/**
 * Needs pipeline wave 2 (C1): the Monitoring tab of the Standards page, a read-only view of the form
 * library: each monitoring form template with its sections and facility slot, then the facility
 * sub-forms (archetype defaults and per-facility versions). Edited under Forms & facilities.
 */

const FACILITY_RULE_TEXT: Record<string, string> = {
  NONE: "No facility questions",
  ALL: "Every facility in scope",
  SPRINT: "Facilities of the current work phase",
  PICKED: "Facilities the officer picks",
};

export function MonitoringStandardsPanel({ library }: { library: FormLibraryDto }) {
  const sectionsByCode = useMemo(() => new Map(library.sections.filter((s) => !s.isArchived).map((s) => [s.code, s])), [library.sections]);
  const templates = library.templates.filter((t) => !t.isArchived && t.isLatest);
  const archetypeForms = library.archetypeSubForms.filter((f) => !f.isArchived && f.isLatest);
  const facilityForms = library.facilitySubForms.filter((f) => !f.isArchived && f.isLatest);

  if (templates.length === 0 && archetypeForms.length === 0) {
    return <EmptyPanel title="No monitoring forms yet">The monitoring form templates appear here once the form library is set up under Forms & facilities.</EmptyPanel>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">What monitoring officers answer on site. Read-only here; the forms are edited under Forms & facilities.</p>

      <section aria-labelledby="monitoring-templates" className="space-y-2">
        <h3 id="monitoring-templates" className="text-sm font-bold text-slate-900">
          Monitoring form templates
        </h3>
        {templates.map((t) => (
          <details key={t.id} className={`${cardCls} group`}>
            <summary className="cursor-pointer list-none text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
              <span className="font-bold text-slate-900">{t.name}</span>
              <span className="text-slate-500">
                {" "}
                · {VISIT_KIND_META[t.visitKind]?.noun ?? t.visitKind} · version {t.version} · {t.blocks.length} block{t.blocks.length === 1 ? "" : "s"}
              </span>
              <span className="ml-2 text-[11px] font-semibold text-brand-primary group-open:hidden">Show</span>
              <span className="ml-2 hidden text-[11px] font-semibold text-brand-primary group-open:inline">Hide</span>
            </summary>
            <ol className="mt-3 space-y-3">
              {t.blocks.map((b, i) =>
                b.type === "SECTION" ? (
                  <li key={`${b.sectionCode}-${i}`}>
                    <SectionBlock section={sectionsByCode.get(b.sectionCode) ?? null} code={b.sectionCode} />
                  </li>
                ) : (
                  <li key={`facilities-${i}`} className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs">
                    <p className="font-semibold text-slate-900">Facility questions</p>
                    <p className="text-slate-600">{FACILITY_RULE_TEXT[VISIT_KIND_META[t.visitKind]?.facilityRule ?? ""] ?? "Facility sub-forms"}, each with its sub-form below.</p>
                  </li>
                )
              )}
            </ol>
          </details>
        ))}
      </section>

      <section aria-labelledby="monitoring-subforms" className="space-y-2">
        <h3 id="monitoring-subforms" className="text-sm font-bold text-slate-900">
          Facility sub-forms
        </h3>
        {archetypeForms.map((f) => (
          <SubFormCard key={f.id} form={f} title={f.archetype ? `${FACILITY_ARCHETYPE_META[f.archetype].label} (default)` : f.subjectKey} />
        ))}
        {facilityForms.map((f) => (
          <SubFormCard key={f.id} form={f} title={`${f.facilityName ?? f.facilityCode ?? "Facility"} (own sub-form)`} />
        ))}
      </section>

      {library.facilities.length > 0 && (
        <section className={cardCls} aria-labelledby="monitoring-facilities">
          <h3 id="monitoring-facilities" className="text-sm font-bold text-slate-900">
            Which sub-form each facility uses
          </h3>
          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {library.facilities
              .filter((f) => !f.isRetired)
              .map((f) => (
                <li key={f.facilityId} className="flex justify-between gap-2">
                  <span className="text-slate-800">{f.name}</span>
                  <span className="text-slate-500">{f.source === "FACILITY" ? "Own" : FACILITY_ARCHETYPE_META[f.archetype].label}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionBlock({ section, code }: { section: FormSectionDto | null; code: string }) {
  if (!section) return <p className="text-xs text-slate-500">Section {code} (archived)</p>;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-900">{section.title}</p>
      {section.description && <p className="text-[11px] text-slate-500">{section.description}</p>}
      <FieldList fields={section.fields} />
    </div>
  );
}

function SubFormCard({ form, title }: { form: FacilitySubFormDto; title: string }) {
  return (
    <details className={`${cardCls} group`}>
      <summary className="cursor-pointer list-none text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
        <span className="font-bold text-slate-900">{title}</span>
        <span className="text-slate-500">
          {" "}
          · version {form.version} · {form.fields.length} question{form.fields.length === 1 ? "" : "s"}
        </span>
        <span className="ml-2 text-[11px] font-semibold text-brand-primary group-open:hidden">Show</span>
        <span className="ml-2 hidden text-[11px] font-semibold text-brand-primary group-open:inline">Hide</span>
      </summary>
      <FieldList fields={form.fields} />
    </details>
  );
}

function FieldList({ fields }: { fields: FormField[] }) {
  if (fields.length === 0) return <p className="mt-1 text-[11px] text-slate-500">No questions.</p>;
  return (
    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-slate-700">
      {fields.map((f) => (
        <li key={f.key}>
          <span className="text-slate-900">{f.label}</span>
          <span className="text-[11px] text-slate-500">
            {" "}
            · {FORM_FIELD_TYPE_LABELS[f.type]}
            {f.required && f.type !== "PHOTO" ? " · required" : ""}
            {f.scope === "PER_UNIT" ? " · per unit" : ""}
            {f.options.length > 0 ? ` · ${f.options.map((o) => o.label).join(" / ")}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
