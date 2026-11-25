import { useMemo } from "react";
import { z } from "zod";
import { Controller } from "react-hook-form";
import { Eye } from "lucide-react";
import { PreviewVisitFormRequestSchema, VISIT_KIND_META, VisitKindEnum, type VisitKind } from "@insite/shared";
import { useProjectsQuery } from "../../queries/projects/useProjectsQueries";
import { useProjectScopeQuery } from "../../queries/scope/useScopeQueries";
import { usePreviewVisitFormMutation } from "../../mutations/forms/useFormMutations";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm, zChoice, zDateText } from "../../lib/forms";
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

/** The preview inputs: a project, then the request body (PreviewVisitFormRequestSchema decides). */
const PreviewFormSchema = z
  .object({
    projectId: zChoice("project"),
    visitKind: VisitKindEnum,
    visitDate: zDateText("visit date"),
    picked: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if (v.visitKind === "AD_HOC" && v.picked.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["picked"], message: "Pick at least one facility for an ad hoc visit." });
    }
    const contract = PreviewVisitFormRequestSchema.safeParse(previewBody(v));
    if (!contract.success) {
      for (const issue of contract.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });

const previewBody = (v: { visitKind: VisitKind; visitDate: string; picked: string[] }) => ({
  visitKind: v.visitKind,
  visitDate: v.visitDate,
  pickedFacilityIds: v.visitKind === "AD_HOC" ? v.picked : [],
});

export function VisitFormPreviewCard() {
  const projects = useProjectsQuery();
  const form = useZodForm(PreviewFormSchema, {
    defaultValues: { projectId: "", visitKind: "ROUTINE", visitDate: localToday(), picked: [] },
  });
  const { projectId, visitKind, picked } = form.watch();
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
  const build = form.handleSubmit((v) => preview.mutate({ projectId: v.projectId, body: previewBody(v) }));

  return (
    <div className={sectionClass}>
      <div>
        <h3 className="text-sm font-bold text-slate-900">Preview a visit form</h3>
        <p className="text-xs text-slate-500">Builds the form a visit would get today from the live library and the project's scope. Nothing is saved.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_160px_auto] gap-3 items-end">
        <Controller
          control={form.control}
          name="projectId"
          render={({ field }) => (
            <CustomSelect
              label="Project"
              size="sm"
              value={field.value}
              placeholder="Pick a project"
              searchable
              options={projectOptions}
              onChange={(v) => {
                field.onChange(v);
                form.setValue("picked", [], { shouldValidate: true });
                preview.reset();
              }}
            />
          )}
        />
        <Controller
          control={form.control}
          name="visitKind"
          render={({ field }) => (
            <CustomSelect
              label="Visit kind"
              size="sm"
              value={field.value}
              onChange={(v) => field.onChange(v as VisitKind)}
              options={VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))}
            />
          )}
        />
        <label className="text-[11px] font-semibold text-slate-700">
          Visit date
          <input type="date" className={`${smallInput} ${invalidClass(form, "visitDate")}`} {...form.register("visitDate")} {...fieldA11y(form, "visitDate")} />
        </label>
        <button type="button" className={primaryButton} disabled={!canSubmit(form, { pending: preview.isPending })} onClick={() => void build()}>
          <Eye className="w-3.5 h-3.5" /> {preview.isPending ? "Building…" : "Build form"}
        </button>
      </div>
      <FieldError form={form} name="visitDate" />
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
                  onChange={(e) =>
                    form.setValue("picked", e.target.checked ? [...picked, f.id] : picked.filter((x) => x !== f.id), {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    })
                  }
                />
                {f.name} ({f.count})
              </label>
            ))}
          </div>
          <FieldError form={form} name="picked" />
        </div>
      )}
      {preview.data && <FormSnapshotView snapshot={preview.data.snapshot} />}
    </div>
  );
}
