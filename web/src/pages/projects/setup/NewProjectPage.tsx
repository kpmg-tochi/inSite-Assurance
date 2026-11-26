import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileSpreadsheet } from "lucide-react";
import { IS_DEMO_MODE } from "../../../config/demoMode";
import { useGuardedNavigate } from "../../../lib/navigationGuard";
import { SubmitButton, useZodForm, type AnyForm } from "../../../lib/forms";
import { useCreateProjectDraftMutation } from "../../../mutations/projects/useProjectSetupMutations";
import { projectLotsKey } from "../../../queries/projectLots";
import { NeedsAssessmentStart } from "../../../components/needsAssessment/NeedsAssessmentStart";
import {
  BasicsForm,
  CREATE_RULES,
  EMPTY_BASICS,
  showBasicsServerErrors,
  useBasicsSchema,
  type BasicsValues,
} from "./sections/BasicsSection";

/** Demo-only sample values; never in non-demo bundles (Vite folds IS_DEMO_MODE). */
const SAMPLE_BASICS: BasicsValues = {
  ...EMPTY_BASICS,
  name: "Sample Rural Health Centre Upgrade",
  stateCode: "KD",
  lgaCode: "KD-KADUNA-NORTH",
  description: "Sample project for demonstrations.",
  totalBudgetNgn: "450000000",
};

/**
 * /app/projects/new: the start of step 1 "Project". Client demo updates D1 (wave 2): it opens with
 * two choices, "Upload needs assessment" (primary: the template fills the project, its sites,
 * facility units, BoQ and work phases; confirm creates the draft) and "Start without one" (the
 * project details form below).
 *
 * The form: saving the project details creates the draft; the wizard then opens at
 * /app/projects/:projectId/setup/project (redesign R6a, D-R6.8) for the school, organisations and
 * location, and the remaining steps. The button stays disabled until the details pass
 * `CreateProjectDraftRequestSchema` (and a delivery model is chosen when the tenant has project
 * types). Client demo updates C3: the person picks the intervention year and a lot; the server
 * assigns the code (e.g. 2026-LOT-5-BATCH-7, shown as LOT 5 BATCH 7).
 */
export function NewProjectPage() {
  const navigate = useGuardedNavigate();
  const [mode, setMode] = useState<"choose" | "manual">("choose");

  if (mode === "manual") return <ManualStart onBack={() => setMode("choose")} />;

  return (
    <div className="space-y-5 pb-10">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <Link to="/app/projects" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> Projects
        </Link>
        <h2 className="mt-1 text-lg font-bold text-slate-900">New project</h2>
        <p className="text-xs text-slate-500">
          Start from the needs assessment, or enter the details yourself. The project is saved as a draft and stays private until you set
          it active.
        </p>
      </div>
      <NeedsAssessmentStart
        onStartWithout={() => setMode("manual")}
        onCreated={(projectId) => navigate(`/app/projects/${projectId}/setup/project`)}
      />
    </div>
  );
}

/** "Start without one": the project details form (unchanged before D1). */
function ManualStart({ onBack }: { onBack: () => void }) {
  const navigate = useGuardedNavigate();
  const queryClient = useQueryClient();
  const schema = useBasicsSchema(false, CREATE_RULES);
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
      // The lot's project count and next batch (or a new lot) changed.
      void queryClient.invalidateQueries({ queryKey: projectLotsKey });
      navigate(`/app/projects/${setup.projectId}/setup/project#section-parties`);
    } catch (err) {
      setGeneral(showBasicsServerErrors(form as unknown as AnyForm, err));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5 pb-10">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <Link to="/app/projects" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> Projects
          </Link>
          <h2 className="mt-1 text-lg font-bold text-slate-900">New project</h2>
          <p className="text-xs text-slate-500">
            Start with the delivery model and the project details. The project is saved as a draft and stays private until you set it active.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" /> Upload a needs assessment instead
          </button>
          {IS_DEMO_MODE && (
            <button
              type="button"
              onClick={() => {
                const keep = form.getValues();
                form.reset({ ...SAMPLE_BASICS, projectTypeId: keep.projectTypeId, interventionYear: keep.interventionYear });
                void form.trigger();
              }}
              className="rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Fill with sample data
            </button>
          )}
        </div>
      </div>
      <BasicsForm form={form} general={general} disabled={create.isPending} rules={CREATE_RULES} />
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
