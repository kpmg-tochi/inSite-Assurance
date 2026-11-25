import React, { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { z } from "zod";
import {
  ContractDefaultApprovalChainSchema,
  defaultContractDefaultChain,
  ProjectProcessStepSchema,
  validateApprovalChain,
  type ApprovalStepConfig,
  type ProjectProcessConfig,
} from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "../../../../components/common";
import { ProcessEditor } from "../../../../components/process/ProcessEditor";
import { ApprovalChainEditor } from "../../../../components/process/ApprovalChainEditor";
import { useSaveContractDefaultChainMutation } from "../../../../mutations/contracts/useContractMutations";
import { useRoleOptions } from "../../../../components/process/useRoleOptions";
import {
  chainFromDto,
  draftFromTemplate,
  validateProcessDraft,
  type ProcessDraft,
} from "../../../../components/process/processState";
import { useWorkflowTemplatesQuery } from "../../../../queries/process/useProcessQueries";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import {
  setField,
  StepSection,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

/**
 * Form schema: the step body (`ProjectProcessStepSchema`: switches and the report chain, checked by
 * the server's chain validator) plus the contractor default chain (`ContractDefaultApprovalChainSchema`),
 * which is saved through its own endpoint.
 */
const ProcessFormSchema = z.object({
  workflowTemplateId: ProjectProcessStepSchema.shape.workflowTemplateId,
  config: ProjectProcessStepSchema.shape.config,
  reportChain: ProjectProcessStepSchema.shape.reportChain,
  defaultChain: ContractDefaultApprovalChainSchema,
});

interface ProcessValues {
  workflowTemplateId: string | null;
  config: ProjectProcessConfig;
  reportChain: ApprovalStepConfig[];
  defaultChain: ApprovalStepConfig[];
}

const processKey = (v: ProcessValues) => JSON.stringify([v.workflowTemplateId, v.config, v.reportChain]);
const chainKey = (v: ProcessValues) => JSON.stringify(v.defaultChain);

/**
 * Section `process` ("Advanced"; redesign R6a, D-R6.9; Phase 7): template, process switches and the report approval chain. Phase 13
 * adds the contractor default chain, saved through its own chains endpoint (it is not in the step body).
 */
export function ProcessSection({ projectId, setup, mode, readOnly }: StepProps) {
  const process = setup.process;
  // Phase 13: the contract default chain. A project without one shows the default (saved only if edited).
  const initial = useMemo<ProcessValues>(
    () => ({
      workflowTemplateId: process.workflowTemplateId,
      config: { ...process.config },
      reportChain: chainFromDto(process.reportChain),
      defaultChain: process.contractDefaultChain?.steps.length
        ? chainFromDto(process.contractDefaultChain)
        : defaultContractDefaultChain({ hasOwner: Boolean(setup.parties.owningOrganization) }),
    }),
    [process, setup.parties.owningOrganization]
  );
  const section = useSectionForm(ProcessFormSchema, initial, (v) => JSON.stringify([processKey(v), chainKey(v)]));
  const { form, dirty } = section;
  const values = section.values as ProcessValues;
  const draft: ProcessDraft = { config: values.config, reportChain: values.reportChain };
  const setDraft = (next: ProcessDraft) => {
    form.setValue("config", next.config, { shouldDirty: true });
    setField(form, "reportChain", next.reportChain);
  };
  const defaultChain = values.defaultChain;
  const setDefaultChain = (next: ApprovalStepConfig[]) => setField(form, "defaultChain", next);
  const [general, setGeneral] = useState<string | null>(null);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const templatesQuery = useWorkflowTemplatesQuery(!readOnly);
  const roles = useRoleOptions(
    process.contractDefaultChain ? [process.reportChain, process.contractDefaultChain] : [process.reportChain]
  );
  const defaultChainIssues = [
    ...validateApprovalChain("CONTRACT_DEFAULT", defaultChain),
    ...defaultChain.flatMap((s, i) => (s.label.trim().length < 2 ? [{ code: "LABEL", message: "Name every step.", stepIndex: i }] : [])),
  ];
  const defaultChainDirty = chainKey(values) !== chainKey(initial);
  const saveDefaultChain = useSaveContractDefaultChainMutation(projectId);
  const issues = validateProcessDraft(draft);
  // D-R6.9: optional; filled from the type's workflow template, so an untouched draft has nothing to save.
  const processDirty = processKey(values) !== processKey(initial);

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
    form.setValue("workflowTemplateId", id || null, { shouldDirty: true });
    setTemplateNote(null);
    const template = templatesQuery.data?.find((t) => t.id === id);
    if (!template) {
      void form.trigger();
      return;
    }
    setDraft(draftFromTemplate(template.config));
  };

  useRegisterSection(
    "process",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const out = await section.submit();
      if (!out) {
        setGeneral("Fix the approval chain issues shown below before saving.");
        return false;
      }
      try {
        if (processDirty || opts?.force) {
          await save.mutateAsync({
            sectionId: "process",
            body: { workflowTemplateId: out.workflowTemplateId, config: out.config, reportChain: out.reportChain },
            silent: opts?.silent,
          });
        }
        // One toast at most: the chain saves silently after the step.
        if (defaultChainDirty) await saveDefaultChain.mutateAsync({ steps: defaultChain, silent: processDirty || opts?.force ? true : opts?.silent });
        section.reset(values);
        setGeneral(null);
        return true;
      } catch (err) {
        setGeneral(section.showServerErrors(err, () => null));
        return false;
      }
    },
    section
  );

  return (
    <>
      <StepSection
        title="Workflow and process"
        description="Pick a workflow template to pre-fill, then adjust the switches and approval chains for this project."
      >
        {general && <p className="text-xs font-medium text-red-600">{general}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <CustomSelect
              label="Workflow template"
              value={values.workflowTemplateId ?? ""}
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
          chainNote={
            mode === "settings" ? (
              <div className="flex items-start gap-2 rounded-xl border border-brand-primary/25 bg-brand-primary/5 p-3 text-[11px] text-brand-navy">
                <Info className="w-4 h-4 shrink-0 text-brand-primary" />
                <span>
                  Chain and setting changes apply to new items only. Visit reports already in approval finish on the
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
