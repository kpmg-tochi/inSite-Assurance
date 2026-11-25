import React, { useMemo, useState } from "react";
import { z } from "zod";
import { Controller } from "react-hook-form";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { SaveRegionRequestSchema, type RegionDto } from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { useRegionsQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { useSaveRegionMutation } from "../../mutations/deliveryModels/useDeliveryModelMutations";
import { CustomSelect } from "../common";
import Loader from "../Loader";

const inputCls = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs";

/** The region form, mapped to SaveRegionRequestSchema (which still decides). */
const RegionFormSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the region name (at least 2 characters)").max(120, "Name is too long (at most 120 characters)"),
    code: z
      .string()
      .trim()
      .min(1, "Enter a code, e.g. NW or NW-KANO")
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/, "Use up to 16 letters, digits or dashes, starting with a letter or digit"),
    parentRegionId: z.string(),
  })
  .transform((v) => ({ name: v.name, code: v.code.toUpperCase(), parentRegionId: v.parentRegionId || null }))
  .pipe(SaveRegionRequestSchema);

/** Phase 11: tenant regions and their areas (two levels). */
export function RegionsCard() {
  const { data: regions = [], isLoading } = useRegionsQuery(true);
  const save = useSaveRegionMutation();
  const [editing, setEditingState] = useState<{ id: string | null } | null>(null);
  const form = useZodForm(RegionFormSchema, { defaultValues: { name: "", code: "", parentRegionId: "" } });
  const setEditing = (next: { id: string | null; name: string; code: string; parentRegionId: string } | null) => {
    setEditingState(next ? { id: next.id } : null);
    if (next) form.reset({ name: next.name, code: next.code, parentRegionId: next.parentRegionId });
  };

  const tree = useMemo(() => {
    const top = regions.filter((r) => !r.parentRegionId).sort((a, b) => a.name.localeCompare(b.name));
    return top.map((r) => ({ region: r, areas: regions.filter((a) => a.parentRegionId === r.id).sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [regions]);

  const parentOptions = [
    { value: "", label: "None (top-level region)" },
    ...regions.filter((r) => !r.parentRegionId && r.id !== editing?.id).map((r) => ({ value: r.id, label: r.name })),
  ];

  const submit = form.handleSubmit((payload) => {
    if (!editing) return;
    save.mutate({ regionId: editing.id, payload }, { onSuccess: () => setEditing(null) });
  });

  const toggleArchive = (r: RegionDto) =>
    save.mutate({ regionId: r.id, payload: { name: r.name, code: r.code, parentRegionId: r.parentRegionId, isArchived: !r.isArchived } });

  const row = (r: RegionDto, isArea: boolean) => (
    <li key={r.id} className={`flex items-center justify-between gap-2 py-1.5 text-xs ${isArea ? "pl-6" : ""}`}>
      <span className={r.isArchived ? "text-slate-400 line-through" : "text-slate-800"}>
        <span className={isArea ? "" : "font-semibold"}>{r.name}</span>{" "}
        <span className="text-slate-400">({r.code})</span>
        {r.projectCount > 0 && <span className="ml-2 text-[11px] text-slate-500">{r.projectCount} project(s)</span>}
      </span>
      <span className="flex gap-1">
        <button
          type="button"
          aria-label={`Edit ${r.name}`}
          onClick={() => setEditing({ id: r.id, name: r.name, code: r.code, parentRegionId: r.parentRegionId ?? "" })}
          className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-50"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label={r.isArchived ? `Restore ${r.name}` : `Archive ${r.name}`}
          onClick={() => toggleArchive(r)}
          className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-50"
        >
          {r.isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
        </button>
      </span>
    </li>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Regions</h3>
          <p className="text-xs text-slate-500 mt-0.5">Regions and the areas inside them. Projects can be placed in either, and filtered by region.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ id: null, name: "", code: "", parentRegionId: "" })}
          className="flex items-center gap-1 rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {editing && (
        <form onSubmit={submit} noValidate className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="text-xs font-medium text-slate-700">
            Name
            <input maxLength={120} className={`${inputCls} ${invalidClass(form, "name")}`} {...form.register("name")} {...fieldA11y(form, "name")} />
            <FieldError form={form} name="name" />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Code
            <input
              maxLength={16}
              className={`${inputCls} uppercase ${invalidClass(form, "code")}`}
              placeholder="e.g. NW or NW-KANO"
              {...form.register("code", { setValueAs: (v: string) => v.toUpperCase() })}
              {...fieldA11y(form, "code")}
            />
            <FieldError form={form} name="code" />
          </label>
          <div className="text-xs font-medium text-slate-700">
            Inside
            <Controller
              control={form.control}
              name="parentRegionId"
              render={({ field }) => <CustomSelect value={field.value} onChange={field.onChange} options={parentOptions} size="sm" />}
            />
          </div>
          <div className="flex items-end gap-2">
            <SubmitButton
              form={form}
              pending={save.isPending}
              pendingLabel="Saving..."
              showHint={false}
              className="rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </SubmitButton>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center p-4">
          <Loader size="sm" inline />
        </div>
      ) : tree.length === 0 ? (
        <p className="text-xs text-slate-500">No regions yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tree.map(({ region, areas }) => (
            <React.Fragment key={region.id}>
              {row(region, false)}
              {areas.map((a) => row(a, true))}
            </React.Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
