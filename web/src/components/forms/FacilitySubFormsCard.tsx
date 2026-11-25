import React, { useMemo, useState } from "react";
import {
  FACILITY_ARCHETYPE_META,
  FacilityArchetypeEnum,
  SaveFacilitySubFormRequestSchema,
  type FacilityArchetype,
  type FacilityEffectiveSubForm,
  type FacilitySubFormDto,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useFormLibraryQuery } from "../../queries/forms/useFormQueries";
import { useCustomiseSubFormMutation, useResetSubFormMutation, useSaveSubFormMutation } from "../../mutations/forms/useFormMutations";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { FieldsEditorModal, VersionsModal } from "./FormEditorModals";

/**
 * Redesign R3 (D-R3.7): one sub-form per facility. Each archetype has a default; a facility uses its
 * own sub-form once customised (a copy of the default), and "Reset" returns it to the default. So 50
 * facilities have forms from four rows, and an edit to a default reaches every uncustomised facility.
 */

type Target =
  | { kind: "ARCHETYPE"; archetype: FacilityArchetype; subForm: FacilitySubFormDto }
  | { kind: "FACILITY"; facility: FacilityEffectiveSubForm; subForm: FacilitySubFormDto };

export function FacilitySubFormsCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("forms:manage");
  const q = useFormLibraryQuery(canManage);
  const save = useSaveSubFormMutation();
  const customise = useCustomiseSubFormMutation();
  const reset = useResetSubFormMutation();
  const [editing, setEditing] = useState<Target | null>(null);
  const [versions, setVersions] = useState<{ key: string; title: string } | null>(null);
  const [search, setSearch] = useState("");
  const [archetype, setArchetype] = useState<"" | FacilityArchetype>("");
  const [onlyCustomised, setOnlyCustomised] = useState(false);

  const ownBySubject = useMemo(() => new Map((q.data?.facilitySubForms ?? []).map((s) => [s.facilityId, s])), [q.data]);
  const defaults = q.data?.archetypeSubForms ?? [];
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data?.facilities ?? [])
      .filter((f) => !f.isRetired)
      .filter((f) => !archetype || f.archetype === archetype)
      .filter((f) => !onlyCustomised || f.source === "FACILITY")
      .filter((f) => !term || f.name.toLowerCase().includes(term) || f.code.toLowerCase().includes(term));
  }, [q.data, search, archetype, onlyCustomised]);

  if (!canManage) return null;

  const columns: TableColumnDef<FacilityEffectiveSubForm>[] = [
    {
      id: "facility",
      header: "Facility",
      cell: (f) => (
        <div>
          <p className="text-xs font-bold text-slate-900">{f.name}</p>
          <p className="text-[11px] text-slate-500 font-mono">{f.code}</p>
        </div>
      ),
    },
    { id: "archetype", header: "Archetype", width: "w-44", cell: (f) => <span className="text-xs text-slate-700">{FACILITY_ARCHETYPE_META[f.archetype].label}</span> },
    {
      id: "source",
      header: "Sub-form",
      width: "w-44",
      cell: (f) =>
        f.source === "FACILITY" ? (
          <TableBadge variant="info">Customised v{f.version}</TableBadge>
        ) : (
          <span className="text-xs text-slate-600">Archetype default{f.version ? ` v${f.version}` : ""}</span>
        ),
    },
    {
      id: "actions",
      header: "",
      width: "w-56",
      align: "right",
      cell: (f) => {
        const own = ownBySubject.get(f.facilityId);
        return f.source === "FACILITY" && own ? (
          <div className="flex justify-end gap-1.5">
            <TableActionButton onClick={() => setEditing({ kind: "FACILITY", facility: f, subForm: own })}>Edit</TableActionButton>
            <TableActionButton onClick={() => setVersions({ key: own.subjectKey, title: f.name })}>Versions</TableActionButton>
            <TableActionButton
              variant="danger"
              disabled={reset.isPending}
              onClick={() => {
                if (window.confirm(`Return ${f.name} to the ${FACILITY_ARCHETYPE_META[f.archetype].label} default? Forms already built keep their version.`)) {
                  reset.mutate({ facilityId: f.facilityId, facilityName: f.name });
                }
              }}
            >
              Reset
            </TableActionButton>
          </div>
        ) : (
          <div className="flex justify-end">
            <TableActionButton disabled={customise.isPending} onClick={() => customise.mutate({ facilityId: f.facilityId, facilityName: f.name })}>
              Customise
            </TableActionButton>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900">Archetype default sub-forms</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Every facility starts from its archetype's questions. Questions use placeholders such as {"{count} {facility}"} and can be limited to visit kinds (existing
          condition on Baseline monitoring, progress on Routine, delivery on Final).
        </p>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {FacilityArchetypeEnum.options.map((a) => {
            const d = defaults.find((s) => s.archetype === a);
            const count = (q.data?.facilities ?? []).filter((f) => f.archetype === a && f.source === "ARCHETYPE" && !f.isRetired).length;
            return (
              <div key={a} className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-900">{FACILITY_ARCHETYPE_META[a].label}</p>
                <p className="text-[11px] text-slate-500">
                  {d ? `${d.fields.length} questions · v${d.version} · ${d.usageCount ? `used by ${d.usageCount} form(s)` : "not used yet"}` : "No default"} · {count} facilities use it
                </p>
                {d && (
                  <div className="mt-2 flex gap-1.5">
                    <TableActionButton onClick={() => setEditing({ kind: "ARCHETYPE", archetype: a, subForm: d })}>Edit default</TableActionButton>
                    <TableActionButton onClick={() => setVersions({ key: d.subjectKey, title: FACILITY_ARCHETYPE_META[a].label })}>Versions</TableActionButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <StandardTable<FacilityEffectiveSubForm>
        title="Facility sub-forms"
        subtitle="Which sub-form each facility uses. Customise a facility only when its questions differ from the archetype's."
        search={{ value: search, onChange: setSearch, placeholder: "Search facilities" }}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <CustomSelect
                value={archetype}
                onChange={(v) => setArchetype(v as "" | FacilityArchetype)}
                options={[{ value: "", label: "All archetypes" }, ...FacilityArchetypeEnum.options.map((a) => ({ value: a, label: FACILITY_ARCHETYPE_META[a].label }))]}
                size="sm"
              />
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={onlyCustomised} onChange={(e) => setOnlyCustomised(e.target.checked)} /> Customised only
            </label>
          </div>
        }
        columns={columns}
        data={rows}
        keyExtractor={(f) => f.facilityId}
        loading={q.isLoading}
        minWidth="min-w-[720px]"
        emptyState={{ title: "No facilities" }}
      />

      {editing && (
        <FieldsEditorModal
          title={editing.kind === "ARCHETYPE" ? `Default sub-form: ${FACILITY_ARCHETYPE_META[editing.archetype].label}` : `Sub-form: ${editing.facility.name}`}
          subtitle={editing.kind === "ARCHETYPE" ? "Every facility of this archetype that is not customised uses these questions." : "Only this facility uses these questions."}
          context="SUBFORM"
          initialFields={editing.subForm.fields}
          previewFacility={
            editing.kind === "ARCHETYPE"
              ? { name: editing.archetype === "SUPPLY_INSTALLATION" ? "Pupils' furniture" : editing.archetype === "UTILITIES" ? "Borehole" : editing.archetype === "EXTERNAL_WORKS" ? "Fence" : "Toilet", archetype: editing.archetype }
              : { name: editing.facility.name, pluralName: editing.facility.pluralName, archetype: editing.facility.archetype }
          }
          requestIssues={(fields) => {
            const parsed = SaveFacilitySubFormRequestSchema.safeParse({ fields });
            return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
          }}
          usageCount={editing.subForm.usageCount}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(fields) =>
            save
              .mutateAsync(editing.kind === "ARCHETYPE" ? { archetype: editing.archetype, body: { fields } } : { facilityId: editing.facility.facilityId, body: { fields } })
              .then(() => setEditing(null))
          }
        />
      )}
      {versions && <VersionsModal kind="subforms" componentKey={versions.key} title={versions.title} onClose={() => setVersions(null)} />}
    </div>
  );
}
