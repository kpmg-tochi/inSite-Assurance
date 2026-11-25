import { useMemo, useState } from "react";
import { z } from "zod";
import { Controller } from "react-hook-form";
import { Download, Plus } from "lucide-react";
import {
  CreateFacilityRequestSchema,
  FACILITY_ARCHETYPE_META,
  FACILITY_CODE_REGEX,
  FacilityArchetypeEnum,
  type FacilityArchetype,
  type FacilityDto,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
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
 * the needs assessment template; a code is locked once a unit uses it.
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

/** The request body the editor's values become (create and update send the same fields). */
const facilityBody = (s: Omit<EditorState, "id" | "codeLocked">) => ({
  code: s.code.trim().toUpperCase(),
  name: s.name.trim(),
  pluralName: s.pluralName.trim() || null,
  category: s.category.trim() || null,
  archetype: s.archetype,
});

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
              title="The blank needs assessment template (Excel) with this workspace's facilities, units of measure, zones / states and delivery models"
              className="inline-flex items-center gap-1 rounded-xl bg-white/90 px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" /> {workbook.isPending ? "Preparing…" : "Download template"}
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
            const body = facilityBody(s);
            save.mutate(s.id ? { id: s.id, update: body } : { create: body }, { onSuccess: () => setEditing(null) });
          }}
        />
      )}
    </>
  );
}

/** The editor's inputs; the request built from them is checked against CreateFacilityRequestSchema. */
const FacilityFormSchema = z
  .object({
    id: z.string().nullable(),
    codeLocked: z.boolean(),
    code: z
      .string()
      .trim()
      .refine((v) => FACILITY_CODE_REGEX.test(v.toUpperCase()), "Code: 2 to 40 capital letters, digits or underscores, starting with a letter, e.g. ASSEMBLY_HALL."),
    name: z.string().trim().min(2, "Enter a name (at least 2 characters).").max(120, "Name is too long (at most 120 characters)."),
    pluralName: z.string().trim().max(120, "Plural is too long (at most 120 characters)."),
    category: z.string().trim().max(80, "Category is too long (at most 80 characters)."),
    archetype: FacilityArchetypeEnum,
  })
  .superRefine((v, ctx) => {
    const contract = CreateFacilityRequestSchema.safeParse(facilityBody(v));
    if (!contract.success) {
      for (const issue of contract.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });

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
  const form = useZodForm(FacilityFormSchema, { defaultValues: initial });
  const { register } = form;
  const submit = form.handleSubmit((s) => onSave(s));

  return (
    <ModalShell title={initial.id ? `Edit ${initial.name}` : "Add a facility"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} noValidate className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-code">
              Code
            </label>
            <input
              id="fac-code"
              className={`${smallInput} font-mono uppercase read-only:bg-slate-50 read-only:text-slate-500 ${invalidClass(form, "code")}`}
              maxLength={40}
              readOnly={initial.codeLocked}
              aria-disabled={initial.codeLocked || undefined}
              placeholder="ASSEMBLY_HALL"
              {...register("code", { setValueAs: (v: string) => v.toUpperCase() })}
              {...fieldA11y(form, "code")}
            />
            <FieldError form={form} name="code" />
            {initial.codeLocked && <p className="mt-1 text-[11px] text-slate-500">Facility units use this code, so it cannot change.</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-name">
              Name
            </label>
            <input
              id="fac-name"
              className={`${smallInput} ${invalidClass(form, "name")}`}
              maxLength={120}
              {...register("name")}
              {...fieldA11y(form, "name")}
            />
            <FieldError form={form} name="name" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-plural">
            Plural (optional)
          </label>
          <input
            id="fac-plural"
            className={`${smallInput} ${invalidClass(form, "pluralName")}`}
            maxLength={120}
            placeholder="Only when the plain plural is wrong, e.g. Staff quarters"
            {...register("pluralName")}
            {...fieldA11y(form, "pluralName")}
          />
          <FieldError form={form} name="pluralName" />
          <p className="mt-1 text-[11px] text-slate-500">Used by form questions such as "Are all {"{count} {facility}"} roofed?".</p>
        </div>
        <Controller
          control={form.control}
          name="archetype"
          render={({ field }) => (
            <CustomSelect
              label="Archetype"
              value={field.value}
              onChange={(v) => field.onChange(v as FacilityArchetype)}
              options={ARCHETYPE_OPTIONS}
              size="sm"
            />
          )}
        />
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="fac-category">
            Category (optional)
          </label>
          <input
            id="fac-category"
            className={`${smallInput} ${invalidClass(form, "category")}`}
            maxLength={80}
            placeholder="Buildings, Furniture, Equipment…"
            {...register("category")}
            {...fieldA11y(form, "category")}
          />
          <FieldError form={form} name="category" />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton form={form} pending={pending} pendingLabel="Saving…" className={primaryButton}>
            Save facility
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
