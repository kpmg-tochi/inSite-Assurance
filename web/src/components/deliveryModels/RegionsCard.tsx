import React, { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import type { RegionDto } from "@insite/shared";
import { useRegionsQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { useSaveRegionMutation } from "../../mutations/deliveryModels/useDeliveryModelMutations";
import { CustomSelect } from "../common";
import Loader from "../Loader";

const inputCls = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs";

/** Phase 11: tenant regions and their areas (two levels). */
export function RegionsCard() {
  const { data: regions = [], isLoading } = useRegionsQuery(true);
  const save = useSaveRegionMutation();
  const [editing, setEditing] = useState<{ id: string | null; name: string; code: string; parentRegionId: string } | null>(null);

  const tree = useMemo(() => {
    const top = regions.filter((r) => !r.parentRegionId).sort((a, b) => a.name.localeCompare(b.name));
    return top.map((r) => ({ region: r, areas: regions.filter((a) => a.parentRegionId === r.id).sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [regions]);

  const parentOptions = [
    { value: "", label: "None (top-level region)" },
    ...regions.filter((r) => !r.parentRegionId && r.id !== editing?.id).map((r) => ({ value: r.id, label: r.name })),
  ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    save.mutate(
      {
        regionId: editing.id,
        payload: { name: editing.name, code: editing.code, parentRegionId: editing.parentRegionId || null },
      },
      { onSuccess: () => setEditing(null) }
    );
  };

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
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="text-xs font-medium text-slate-700">
            Name
            <input required minLength={2} maxLength={120} className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Code
            <input required maxLength={16} className={inputCls} value={editing.code} placeholder="e.g. NW or NW-KANO" onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
          </label>
          <div className="text-xs font-medium text-slate-700">
            Inside
            <CustomSelect value={editing.parentRegionId} onChange={(v) => setEditing({ ...editing, parentRegionId: v })} options={parentOptions} size="sm" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={save.isPending} className="rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {save.isPending ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center p-4">
          <Loader size="sm" />
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
