import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { IS_DEMO_MODE } from "../../../config/demoMode";
import { useCreateProjectDraftMutation } from "../../../mutations/projects/useProjectSetupMutations";
import { BasicsForm, EMPTY_BASICS, validateBasics, type BasicsValues } from "./steps/BasicsStep";
import { extractErrors, NO_ERRORS, type FormErrors } from "./setupContext";

/** Demo-only sample values; never in non-demo bundles (Vite folds IS_DEMO_MODE). */
const SAMPLE_BASICS: BasicsValues = {
  name: "Sample Rural Health Centre Upgrade",
  codePrefix: "SMP-101",
  stateLocation: "Kaduna State",
  lgaLocation: "Kaduna North",
  description: "Sample project for demonstrations.",
  totalBudget: "450000000",
  projectTypeId: "",
  regionId: "",
};

/**
 * /app/projects/new: step 1 of the wizard. Saving creates the draft; the remaining steps live at
 * /app/projects/:projectId/setup/:stepId.
 */
export function NewProjectPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<BasicsValues>(EMPTY_BASICS);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const create = useCreateProjectDraftMutation();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { body, fields } = validateBasics(values);
    if (!body) {
      setErrors({ fields, general: "Some fields need attention." });
      return;
    }
    try {
      const setup = await create.mutateAsync(body);
      navigate(`/app/projects/${setup.projectId}/setup/parties`);
    } catch (err) {
      setErrors(extractErrors(err));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 pb-10">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <Link to="/app/projects" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> Projects
          </Link>
          <h1 className="mt-1 text-lg font-bold text-slate-900">New project</h1>
          <p className="text-xs text-slate-500">
            Start with the basics. The project is saved as a draft after this step and stays private until you set it active.
          </p>
        </div>
        {IS_DEMO_MODE && (
          <button
            type="button"
            onClick={() => setValues(SAMPLE_BASICS)}
            className="rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Fill with sample data
          </button>
        )}
      </div>
      <BasicsForm values={values} onChange={setValues} errors={errors} disabled={create.isPending} />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={create.isPending}
          className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-5 py-2.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {create.isPending ? "Saving…" : "Save and continue"} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  );
}
