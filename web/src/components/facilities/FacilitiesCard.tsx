import React, { useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import {
  FACILITY_ARCHETYPE_META,
  FACILITY_CODE_REGEX,
  FacilityArchetypeEnum,
  type FacilityArchetype,
  type FacilityDto,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useFacilitiesQuery } from "../../queries/facilities/useFacilityQueries";
import { useSaveFacilityMutation } from "../../mutations/facilities/useFacilityMutations";
import { useDownloadTenantScopeWorkbookMutation } from "../../mutations/scope/useScopeMutations";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { ModalShell } from "../common/ModalShell";
import { primaryButton, secondaryButton, smallInput } from "../contracts/contractUi";

/**
 * Redesign R2a: the tenant facility catalogue. Scope lines are tagged with these facilities through
 * facility units. A retired facility stays on the projects that use it and leaves the pickers and
 * the workbook; a code is locked once a unit uses it.
 */

const ARCHETYPE_OPTIONS = FacilityArchetypeEnum.options.map((a) => ({
  value: a,
  label: FACILITY_ARCHETYPE_META[a].label,
  description: FACILITY_ARCHETYPE_META[a].description,
}));

interface EditorState {
  id: string | null;
  code: string;
  name: string;
  pluralName: string;
  category: string;
  archetype: FacilityArchetype;
  /** Units use it: the code is locked. */
  codeLocked: boolean;
}

const blank = (): EditorState => ({ id: null, code: "", name: "", pluralName: "", category: "", archetype: "BUILDING_WORKS", codeLocked: false });

const fromDto = (f: FacilityDto): EditorState => ({
  id: f.id,
  code: f.code,
  name: f.name,
  pluralName: f.pluralName ?? "",
  category: f.category ?? "",
  archetype: f.archetype,
  codeLocked: f.unitCount > 0,
});

export function FacilitiesCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("facilities:manage");
  const [showRetired, setShowRetired] = useState(false);
  const [archetype, setArchetype] = useState<"" | FacilityArchetype>("");
  const q = useFacilitiesQuery(true, canManage);
  const save = useSaveFacilityMutation();
  const workbook = useDownloadTenantScopeWorkbookMutation();
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((f) => showRetired || !f.isRetired)
      .filter((f) => !archetype || f.archetype === archetype)
      .filter(
        (f) =>
          !term ||
          f.name.toLowerCase().includes(term) ||
          f.code.toLowerCase().includes(term) ||
          (f.category ?? "").toLowerCase().includes(term),
      );
  }, [q.data, showRetired, archetype, search]);

  if (!canManage) return null;

  const columns: TableColumnDef<FacilityDto>[] = [
    {
      id: "name",
      header: "Facility",
      cell: (f) => (
        <div>
          <p className="text-xs font-bold text-slate-900">{f.name}</p>
          <p className="text-[11px] text-slate-500 font-mono">{f.code}</p>
        </div>
      ),
    },
    {
      id: "archetype",
      header: "Archetype",
      width: "w-44",
      cell: (f) => <span className="text-xs text-slate-700">{FACILITY_ARCHETYPE_META[f.archetype].label}</span>,
    },
    { id: "category", header: "Category", width: "w-36", cell: (f) => <span className="text-xs text-slate-600">{f.category ?? "–"}</span> },
    {
      id: "plural",
      header: "Plural",
      width: "w-36",
      cell: (f) => <span className="text-xs text-slate-600">{f.pluralName ?? <span className="text-slate-400">derived</span>}</span>,
    },
    {
      id: "subForm",
      header: "Sub-form",
      width: "w-40",
      cell: (f) =>
        !f.subForm ? (
          <span className="text-xs text-slate-400">–</span>
        ) : f.subForm.source === "FACILITY" ? (
          <TableBadge variant="info">Customised v{f.subForm.version}</TableBadge>
        ) : (
          <span className="text-xs text-slate-600">Archetype default v{f.subForm.version}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      width: "w-28",
      cell: (f) => (f.isRetired ? <TableBadge variant="warning">Retired</TableBadge> : <TableBadge variant="success">Active</TableBadge>),
    },
    { id: "units", header: "Units", width: "w-20", align: "center", cell: (f) => <span className="text-xs tabular-nums">{f.unitCount}</span> },
    {
      id: "actions",
      header: "",
      width: "w-44",
      align: "right",
      cell: (f) => (
        <div className="flex justify-end gap-1.5">
          <TableActionButton onClick={() => setEditing(fromDto(f))}>Edit</TableActionButton>
          <TableActionButton
            variant={f.isRetired ? "default" : "danger"}
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                id: f.id,
                update: { isRetired: !f.isRetired },
                successMessage: f.isRetired ? `"${f.name}" restored.` : `"${f.name}" retired. Projects that use it keep it.`,
              })
            }
          >
            {f.isRetired ? "Restore" : "Retire"}
          </TableActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <StandardTable<FacilityDto>
        title="Facilities"
        subtitle="The catalogue that scope lines are tagged with. The archetype decides the default visit questions and whether units carry a planned quantity."
        search={{ value: search, onChange: setSearch, placeholder: "Search facilities" }}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <CustomSelect
                value={archetype}
                onChange={(v) => setArchetype(v as "" | FacilityArchetype)}
                options={[{ value: "", label: "All archetypes" }, ...ARCHETYPE_OPTIONS]}
                size="sm"
              />
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired
            </label>
          </div>
        }
        headerActions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => workbook.mutate()}
              disabled={workbook.isPending}
              title="A blank needs-assessment workbook with this workspace's facilities, units of measure, regions and delivery models"
              className="inline-flex items-center gap-1 rounded-xl bg-white/90 px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" /> {workbook.isPending ? "Preparing…" : "Download workbook"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(blank())}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
            >
              <Plus className="w-3.5 h-3.5" /> Add facility
            </button>
          </div>
        }
        columns={columns}
        data={rows}
        keyExtractor={(f) => f.id}
        loading={q.isLoading}
        minWidth="min-w-[760px]"
        emptyState={{ title: "No facilities" }}
      />
      {editing && (
        <FacilityEditor
          initial={editing}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(s) => {
            const body = {
              code: s.code.trim().toUpperCase(),
              name: s.name.trim(),
              pluralName: s.pluralName.trim() || null,
              category: s.category.trim() || null,
              archetype: s.archetype,
            };
            save.mutate(s.id ? { id: s.id, update: body } : { create: body }, { onSuccess: () => setEditing(null) });
          }}
        />
      )}
    </>
  );
}

function FacilityEditor({
  initial,
  pending,
  onClose,
  onSave,
}: {
  initial: EditorState;
  pending: boolean;
  onClose: () => void;
  onSave: (s: EditorState) => void;
}) {
  const [s, setS] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EditorState>) => setS((x) => ({ ...x, ...patch }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!FACILITY_CODE_REGEX.test(s.code.trim().toUpperCase())) return setError("Code: 2 to 40 capital letters, digits or underscores, e.g. ASSEMBLY_HALL.");
    if (s.name.trim().length < 2) return setError("Enter a name.");
    setError(null);
    onSave(s);
  };

  return (
    <ModalShell title={s.id ? `Edit ${initial.name}` : "Add a facility"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-code">
              Code
            </label>
            <input
              id="fac-code"
              className={`${smallInput} font-mono uppercase`}
              value={s.code}
              maxLength={40}
              disabled={s.codeLocked}
              placeholder="ASSEMBLY_HALL"
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
            />
            {s.codeLocked && <p className="mt-1 text-[11px] text-slate-500">Facility units use this code, so it cannot change.</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-name">
              Name
            </label>
            <input id="fac-name" className={smallInput} value={s.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-plural">
            Plural (optional)
          </label>
          <input
            id="fac-plural"
            className={smallInput}
            value={s.pluralName}
            maxLength={120}
            placeholder="Only when the plain plural is wrong, e.g. Staff quarters"
            onChange={(e) => set({ pluralName: e.target.value })}
          />
          <p className="mt-1 text-[11px] text-slate-500">Used by form questions such as "Are all {"{count} {facility}"} roofed?".</p>
        </div>
        <CustomSelect
          label="Archetype"
          value={s.archetype}
          onChange={(v) => set({ archetype: v as FacilityArchetype })}
          options={ARCHETYPE_OPTIONS}
          size="sm"
        />
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-category">
            Category (optional)
          </label>
          <input
            id="fac-category"
            className={smallInput}
            value={s.category}
            maxLength={80}
            placeholder="Buildings, Furniture, Equipment…"
            onChange={(e) => set({ category: e.target.value })}
          />
        </div>
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={pending}>
            {pending ? "Saving…" : "Save facility"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
