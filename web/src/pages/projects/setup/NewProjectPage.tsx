import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { IS_DEMO_MODE } from "../../../config/demoMode";
import { useGuardedNavigate } from "../../../lib/navigationGuard";
import { SubmitButton, useZodForm } from "../../../lib/forms";
import { useCreateProjectDraftMutation } from "../../../mutations/projects/useProjectSetupMutations";
import { BasicsForm, EMPTY_BASICS, useBasicsSchema, type BasicsValues } from "./sections/BasicsSection";
import { applyServerErrors } from "./setupContext";

/** Demo-only sample values; never in non-demo bundles (Vite folds IS_DEMO_MODE). */
const SAMPLE_BASICS: BasicsValues = {
  name: "Sample Rural Health Centre Upgrade",
  codePrefix: "SMP-101",
  stateLocation: "Kaduna State",
  lgaLocation: "Kaduna North",
  description: "Sample project for demonstrations.",
  totalBudgetNgn: "450000000",
  projectTypeId: "",
  regionId: "",
};

/**
 * /app/projects/new: the start of step 1 "Project". Saving the project details creates the draft;
 * the wizard then opens at /app/projects/:projectId/setup/project (redesign R6a, D-R6.8) for the
 * school, organisations and location, and the remaining steps. The button stays disabled until the
 * details pass `CreateProjectDraftRequestSchema` (and a delivery model is chosen when the tenant has
 * project types).
 */
export function NewProjectPage() {
  const navigate = useGuardedNavigate();
  const schema = useBasicsSchema(false);
  const form = useZodForm(schema, { defaultValues: EMPTY_BASICS });
  const [general, setGeneral] = useState<string | null>(null);
  const create = useCreateProjectDraftMutation();
  // The delivery model becomes required once the tenant's types load: re-check.
  useEffect(() => {
    void form.trigger();
  }, [schema, form]);

  const submit = form.handleSubmit(async (body) => {
    try {
      const setup = await create.mutateAsync(body);
      navigate(`/app/projects/${setup.projectId}/setup/project#section-parties`);
    } catch (err) {
      setGeneral(applyServerErrors(form, err));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5 pb-10">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <Link to="/app/projects" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> Projects
          </Link>
          <h1 className="mt-1 text-lg font-bold text-slate-900">New project</h1>
          <p className="text-xs text-slate-500">
            Start with the delivery model and the project details. The project is saved as a draft and stays private until you set it active.
          </p>
        </div>
        {IS_DEMO_MODE && (
          <button
            type="button"
            onClick={() => {
              form.reset({ ...SAMPLE_BASICS, projectTypeId: form.getValues("projectTypeId") });
              void form.trigger();
            }}
            className="rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Fill with sample data
          </button>
        )}
      </div>
      <BasicsForm form={form} general={general} disabled={create.isPending} />
      <div className="flex justify-end">
        <SubmitButton
          form={form}
          pending={create.isPending}
          pendingLabel={
            <>
              Saving… <ArrowRight className="w-3.5 h-3.5" />
            </>
          }
          hint="Complete the required project details to continue."
          className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-5 py-2.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand-primary"
        >
          Save and continue <ArrowRight className="w-3.5 h-3.5" />
        </SubmitButton>
      </div>
    </form>
  );
}
