import React, { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { VISIT_KIND_META, VisitKindEnum, type VisitKind } from "@insite/shared";
import { useProjectsQuery } from "../../queries/projects/useProjectsQueries";
import { useProjectScopeQuery } from "../../queries/scope/useScopeQueries";
import { usePreviewVisitFormMutation } from "../../mutations/forms/useFormMutations";
import { CustomSelect } from "../common";
import { primaryButton, sectionClass, smallInput } from "../contracts/contractUi";
import { FormSnapshotView } from "./FormSnapshotView";

/**
 * Redesign R3 (D-R3.23): build a project's visit form for a kind and date with the real assembly, to
 * check templates and sub-forms against real scope. Nothing is stored.
 */

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function VisitFormPreviewCard() {
  const projects = useProjectsQuery();
  const [projectId, setProjectId] = useState("");
  const [visitKind, setVisitKind] = useState<VisitKind>("ROUTINE");
  const [visitDate, setVisitDate] = useState(localToday());
  const [picked, setPicked] = useState<string[]>([]);
  const scope = useProjectScopeQuery(projectId || null, Boolean(projectId) && visitKind === "AD_HOC");
  const preview = usePreviewVisitFormMutation();

  const facilities = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const u of scope.data?.units ?? []) {
      const cur = map.get(u.facility.id) ?? { id: u.facility.id, name: u.facility.name, count: 0 };
      map.set(u.facility.id, { ...cur, count: cur.count + 1 });
    }
    return [...map.values()];
  }, [scope.data]);

  const projectOptions = (projects.data ?? []).map((p) => ({ value: p.id, label: `${p.codePrefix} · ${p.name}` }));

  return (
    <div className={sectionClass}>
      <div>
        <h3 className="text-sm font-bold text-slate-900">Preview a visit form</h3>
        <p className="text-xs text-slate-500">Builds the form a visit would get today from the live library and the project's scope. Nothing is saved.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_160px_auto] gap-3 items-end">
        <CustomSelect label="Project" size="sm" value={projectId} placeholder="Pick a project" searchable options={projectOptions} onChange={(v) => { setProjectId(v); setPicked([]); preview.reset(); }} />
        <CustomSelect
          label="Visit kind"
          size="sm"
          value={visitKind}
          onChange={(v) => setVisitKind(v as VisitKind)}
          options={VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))}
        />
        <label className="text-[11px] font-semibold text-slate-700">
          Visit date
          <input type="date" className={smallInput} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
        </label>
        <button
          type="button"
          className={primaryButton}
          disabled={!projectId || !visitDate || preview.isPending || (visitKind === "AD_HOC" && picked.length === 0)}
          onClick={() => preview.mutate({ projectId, body: { visitKind, visitDate, pickedFacilityIds: visitKind === "AD_HOC" ? picked : [] } })}
        >
          <Eye className="w-3.5 h-3.5" /> {preview.isPending ? "Building…" : "Build form"}
        </button>
      </div>
      {visitKind === "AD_HOC" && projectId && (
        <div>
          <p className="text-[11px] font-semibold text-slate-700 mb-1">Facilities the officer picked</p>
          {facilities.length === 0 && <p className="text-[11px] text-slate-500">{scope.isLoading ? "Loading…" : "This project has no facility units."}</p>}
          <div className="flex flex-wrap gap-3">
            {facilities.map((f) => (
              <label key={f.id} className="inline-flex items-center gap-1 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={picked.includes(f.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id)))}
                />
                {f.name} ({f.count})
              </label>
            ))}
          </div>
        </div>
      )}
      {preview.data && <FormSnapshotView snapshot={preview.data.snapshot} />}
    </div>
  );
}
