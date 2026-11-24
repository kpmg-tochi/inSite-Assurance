import React, { useState } from "react";
import { useAuth } from "../../../../lib/auth-context";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { ScopeAndSprintsPanel } from "../../../../components/scope/ScopeAndSprintsPanel";
import { extractErrors, StepSection, useRegisterStep, type StepProps } from "../setupContext";

/**
 * "Scope & sprints" (redesign R2b): sprints, facility units and BoQ lines. Data is saved through the
 * scope endpoints as you edit; "Save and continue" marks the step reviewed.
 */
export function ScopeStep({ projectId, setup, readOnly }: StepProps) {
  const { hasPermission } = useAuth();
  const canEdit = !readOnly && hasPermission("boq:upload_edit");
  const save = useSaveSetupStepMutation(projectId);
  const [error, setError] = useState<string | null>(null);
  const status = setup.steps.find((s) => s.stepId === "scope");
  const dirty = Boolean(status && !status.saved && setup.status === "DRAFT" && canEdit);

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    try {
      await save.mutateAsync({ stepId: "scope", body: {}, silent: opts?.silent });
      setError(null);
      return true;
    } catch (err) {
      setError(extractErrors(err).general);
      return false;
    }
  });

  return (
    <StepSection
      title="Scope & sprints"
      description="Plan the sprints, add a facility unit for each facility on site, and list its BoQ lines. Amounts are quantity × rate."
    >
      {status && status.issues.length > 0 && setup.status === "DRAFT" && (
        <ul className="mb-3 space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {status.issues
            .filter((i) => i.code !== "STEP_NOT_SAVED")
            .map((i, n) => (
              <li key={`${i.code}-${n}`}>• {i.message}</li>
            ))}
        </ul>
      )}
      <ScopeAndSprintsPanel projectId={projectId} readOnly={!canEdit} />
      {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
    </StepSection>
  );
}
