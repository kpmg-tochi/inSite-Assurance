import React, { useMemo, useState } from "react";
import { Info } from "lucide-react";
import {
  defaultContractDefaultChain,
  validateApprovalChain,
  type ApprovalStepConfig,
  type ProjectProcessStep,
} from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "../../../../components/common";
import { ProcessEditor } from "../../../../components/process/ProcessEditor";
import { ApprovalChainEditor } from "../../../../components/process/ApprovalChainEditor";
import { useSaveContractDefaultChainMutation } from "../../../../mutations/contracts/useContractMutations";
import { useConfirmDialog } from "../../../../components/process/ConfirmDialog";
import { useRoleOptions } from "../../../../components/process/useRoleOptions";
import {
  chainFromDto,
  draftFromTemplate,
  sameDraft,
  validateProcessDraft,
  type ProcessDraft,
} from "../../../../components/process/processState";
import { apiErrorCode } from "../../../../api/process/processApi";
import { useWorkflowTemplatesQuery } from "../../../../queries/process/useProcessQueries";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import {
  extractErrors,
  NO_ERRORS,
  StepSection,
  useRegisterStep,
  type FormErrors,
  type StepProps,
} from "../setupContext";

/**
 * "Workflow and process" (Phase 7): template, process switches and both approval chains. Phase 13
 * adds the contractor default chain, saved through its own chains endpoint (it is not in the step body).
 */
export function ProcessStep({ projectId, setup, mode, readOnly }: StepProps) {
  const process = setup.process;
  const initial = useMemo<ProcessDraft>(
    () => ({
      config: { ...process.config },
      reportChain: chainFromDto(process.reportChain),
      disbursementChain: chainFromDto(process.disbursementChain),
    }),
    [process]
  );
  const [draft, setDraft] = useState<ProcessDraft>(initial);
  const [templateId, setTemplateId] = useState<string | null>(process.workflowTemplateId);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const templatesQuery = useWorkflowTemplatesQuery(!readOnly);
  const roles = useRoleOptions(
    process.contractDefaultChain ? [process.reportChain, process.disbursementChain, process.contractDefaultChain] : [process.reportChain, process.disbursementChain]
  );
  // Phase 13: the contract default chain. A project without one shows the default (saved only if edited).
  const initialDefaultChain = useMemo<ApprovalStepConfig[]>(
    () =>
      process.contractDefaultChain?.steps.length
        ? chainFromDto(process.contractDefaultChain)
        : defaultContractDefaultChain({ hasOwner: Boolean(setup.parties.owningOrganization) }),
    [process.contractDefaultChain, setup.parties.owningOrganization]
  );
  const [defaultChain, setDefaultChain] = useState<ApprovalStepConfig[]>(initialDefaultChain);
  const defaultChainIssues = [
    ...validateApprovalChain("CONTRACT_DEFAULT", defaultChain),
    ...defaultChain.flatMap((s, i) => (s.label.trim().length < 2 ? [{ code: "LABEL", message: "Name every step.", stepIndex: i }] : [])),
  ];
  const defaultChainDirty = JSON.stringify(defaultChain) !== JSON.stringify(initialDefaultChain);
  const saveDefaultChain = useSaveContractDefaultChainMutation(projectId);
  const { ask, dialog } = useConfirmDialog();
  const issues = validateProcessDraft(draft);
  const savedOnce = setup.steps.find((s) => s.stepId === "process")?.saved ?? false;
  const processDirty =
    !sameDraft(draft, initial) || templateId !== process.workflowTemplateId || (!savedOnce && setup.status === "DRAFT");
  const dirty = processDirty || defaultChainDirty;

  const templateOptions = useMemo<CustomSelectOption<string>[]>(
    () => [
      { value: "", label: "No template (edit below)" },
      ...(templatesQuery.data ?? []).map((t) => ({
        value: t.id,
        label: t.name,
        description: t.description ?? undefined,
        badge: t.isDefault ? "Default" : undefined,
      })),
    ],
    [templatesQuery.data]
  );

  const pickTemplate = (id: string) => {
    setTemplateId(id || null);
    setTemplateNote(null);
    const template = templatesQuery.data?.find((t) => t.id === id);
    if (!template) return;
    const next = draftFromTemplate(template.config);
    if (process.disbursementMechanismLocked && next.config.disbursementMechanism !== draft.config.disbursementMechanism) {
      setTemplateNote(
        "This template uses a different disbursement mechanism, which is locked on this project. Saving will be refused unless you pick another template."
      );
    }
    setDraft(next);
  };

  const send = async (silent: boolean | undefined, confirm: boolean) => {
    const body: ProjectProcessStep = {
      workflowTemplateId: templateId,
      config: draft.config,
      reportChain: draft.reportChain,
      disbursementChain: draft.disbursementChain,
      ...(confirm ? { confirmDeactivateContractorCodes: true } : {}),
    };
    await save.mutateAsync({ stepId: "process", body, silent });
  };

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    if (issues.count > 0 || defaultChainIssues.length > 0) {
      setErrors({ fields: {}, general: "Fix the approval chain issues shown below before saving." });
      return false;
    }
    if (!processDirty) return saveDefaultChainOnly(opts?.silent);
    let confirm = false;
    const turningOff =
      setup.status === "ACTIVE" && process.config.allowContractorFieldReporting && !draft.config.allowContractorFieldReporting;
    if (turningOff && process.activeContractorJoinCodeCount > 0) {
      confirm = await ask({
        title: "Turn contractor field reporting off?",
        message: `${process.activeContractorJoinCodeCount} active contractor join code(s) will be deactivated. Contractors already signed in keep their session but cannot submit reports. Every brief will be written for an independent verifier.`,
        confirmLabel: "Deactivate codes and save",
        danger: true,
      });
      if (!confirm) return false;
    }
    try {
      await send(opts?.silent, confirm);
      if (defaultChainDirty) await saveDefaultChain.mutateAsync({ steps: defaultChain, silent: true });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      const { code, details } = apiErrorCode(err);
      if (code === "CONFIRMATION_REQUIRED" && !confirm) {
        const count = Number(details?.activeContractorJoinCodeCount ?? 0);
        const ok = await ask({
          title: "Turn contractor field reporting off?",
          message: `${count} active contractor join code(s) will be deactivated.`,
          confirmLabel: "Deactivate codes and save",
          danger: true,
        });
        if (!ok) return false;
        try {
          await send(opts?.silent, true);
          if (defaultChainDirty) await saveDefaultChain.mutateAsync({ steps: defaultChain, silent: true });
          setErrors(NO_ERRORS);
          return true;
        } catch (retryErr) {
          setErrors(extractErrors(retryErr));
          return false;
        }
      }
      setErrors(extractErrors(err));
      return false;
    }
  });

  async function saveDefaultChainOnly(silent?: boolean) {
    try {
      await saveDefaultChain.mutateAsync({ steps: defaultChain, silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  }

  return (
    <>
      {dialog}
      <StepSection
        title="Workflow and process"
        description="Pick a workflow template to pre-fill, then adjust the switches and approval chains for this project."
      >
        {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <CustomSelect
              label="Workflow template"
              value={templateId ?? ""}
              onChange={pickTemplate}
              options={templateOptions}
              disabled={readOnly || templatesQuery.isLoading}
              placeholder={templatesQuery.isLoading ? "Loading templates…" : "Choose a template"}
              hint="Choosing a template copies its settings into this project. Later template edits do not change the project."
            />
          </div>
          {process.workflowTemplateName && (
            <p className="text-[11px] text-slate-500">
              Last applied: <span className="font-semibold text-slate-700">{process.workflowTemplateName}</span>
            </p>
          )}
        </div>
        {templatesQuery.isError && (
          <p className="text-[11px] text-amber-700">Templates could not be loaded. You can still set the process by hand.</p>
        )}
        {templateNote && <p className="text-[11px] font-medium text-amber-700">{templateNote}</p>}

        <ProcessEditor
          draft={draft}
          onChange={setDraft}
          issues={issues}
          roles={roles}
          disabled={readOnly}
          mechanismLocked={process.disbursementMechanismLocked}
          chainNote={
            mode === "settings" ? (
              <div className="flex items-start gap-2 rounded-xl border border-brand-primary/25 bg-brand-primary/5 p-3 text-[11px] text-brand-navy">
                <Info className="w-4 h-4 shrink-0 text-brand-primary" />
                <span>
                  Chain and setting changes apply to new items only. Reports and valuations already in approval finish on the
                  chain they started with.
                </span>
              </div>
            ) : null
          }
        />

        <div className="space-y-3 pt-2">
          <div>
            <h3 className="text-xs font-bold text-slate-900">Contractor default case chain</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              A default case (for example an overdue mobilisation) goes through these steps. The last step decides the outcome: cure
              period, extension, termination or closure. It is fixed; add review steps before it.
              {!process.contractDefaultChain?.steps.length ? " Not saved for this project yet: the default is shown." : ""}
            </p>
          </div>
          <ApprovalChainEditor
            chainType="CONTRACT_DEFAULT"
            steps={defaultChain}
            onChange={setDefaultChain}
            disabled={readOnly}
            roles={roles}
            issues={defaultChainIssues}
          />
        </div>
      </StepSection>
    </>
  );
}
