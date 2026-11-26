import { useMemo, useState } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { Gavel, Plus } from "lucide-react";
import { RaiseDefaultCaseRequestSchema, type ContractorDefaultCaseDto, type RaiseDefaultCaseRequest } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common";
import Loader from "../Loader";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort } from "../../lib/formatters";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, visibleError, zChoice } from "../../lib/forms";
import { useDefaultCasesQuery, useMilestonesQuery, useMobilisationComplianceQuery } from "../../queries/contracts/useContractQueries";
import { useRaiseDefaultCaseMutation } from "../../mutations/contracts/useContractMutations";
import { DEFAULT_CASE_STATUS_META, primaryButton, secondaryButton, sectionClass, smallInput, StatusChip } from "./contractUi";

/** Phase 13: a project's contractor default cases, with "Raise a default case". */
export function DefaultCasesPanel({ projectId, onOpenCase }: { projectId: string; onOpenCase: (caseId: string) => void }) {
  const { hasPermission } = useAuth();
  const [openOnly, setOpenOnly] = useState(false);
  const [raising, setRaising] = useState(false);
  const q = useDefaultCasesQuery(projectId, openOnly ? { openOnly: true } : {});
  const cases = q.data ?? [];

  return (
    <section className={sectionClass} id="default-cases" aria-label="Default cases">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <Gavel className="w-4 h-4 text-brand-primary" /> Default cases
        </h2>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only
          </label>
          {hasPermission("contracts:raise_default") && (
            <button type="button" className={secondaryButton} onClick={() => setRaising(true)}>
              <Plus className="w-3.5 h-3.5" /> Raise a case
            </button>
          )}
        </div>
      </div>
      {q.isLoading ? (
        <Loader />
      ) : q.isError ? (
        <p className="text-xs text-slate-500">Default cases could not be loaded.</p>
      ) : cases.length === 0 ? (
        <p className="text-xs text-slate-500">{openOnly ? "No open cases." : "No default cases on this project."}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {cases.map((c) => (
            <CaseRow key={c.id} c={c} onOpen={() => onOpenCase(c.id)} />
          ))}
        </ul>
      )}
      {raising && <RaiseDefaultCaseDialog projectId={projectId} onClose={() => setRaising(false)} onRaised={onOpenCase} />}
    </section>
  );
}

function CaseRow({ c, onOpen }: { c: ContractorDefaultCaseDto; onOpen: () => void }) {
  const s = DEFAULT_CASE_STATUS_META[c.status];
  const current = c.approval.steps.find((st) => st.state === "CURRENT");
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full text-left px-2 py-3 rounded-lg hover:bg-slate-50">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-900">
            {c.contractorName} <span className="font-normal text-slate-500">({c.tradeCode})</span>
          </span>
          <StatusChip label={s.label} cls={s.cls} />
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-1">
          {c.milestoneLabel ? `${c.milestoneLabel} · ` : ""}
          opened {formatDateShort(c.openedAt)}
          {c.isOpen && current ? ` · waiting on ${current.label}` : ""}
          {c.newDueDate ? ` · new date ${c.newDueDate}` : ""}
          {c.isOpen && c.approval.canAct ? " · your action" : ""}
        </p>
      </button>
    </li>
  );
}

const RaiseCaseFormSchema = z
  .object({
    projectContractorId: zChoice("contractor"),
    milestoneId: z.string(),
    summary: RaiseDefaultCaseRequestSchema.shape.summary,
  })
  .transform((v): RaiseDefaultCaseRequest => ({ ...v, milestoneId: v.milestoneId || null }));

export function RaiseDefaultCaseDialog({
  projectId,
  onClose,
  onRaised,
  defaultContractorId,
  defaultMilestoneId,
}: {
  projectId: string;
  onClose: () => void;
  onRaised?: (caseId: string) => void;
  defaultContractorId?: string;
  defaultMilestoneId?: string | null;
}) {
  const compliance = useMobilisationComplianceQuery(projectId);
  const milestones = useMilestonesQuery(projectId);
  const raise = useRaiseDefaultCaseMutation(projectId);
  const form = useZodForm(RaiseCaseFormSchema, {
    defaultValues: { projectContractorId: defaultContractorId ?? "", milestoneId: defaultMilestoneId ?? "", summary: "" },
  });
  const contractorId = form.watch("projectContractorId");

  const contractors = (compliance.data ?? []).filter((r) => r.contractStatus === "ACTIVE");
  const milestoneOptions = useMemo(
    () => [
      { value: "", label: "Not about one milestone" },
      ...(milestones.data?.milestones ?? [])
        .filter((m) => m.status !== "DONE" && m.status !== "WAIVED")
        .filter((m) => !contractorId || m.projectContractorId === null || m.projectContractorId === contractorId)
        .map((m) => ({ value: m.id, label: m.label, description: m.dueDate ? `Due ${formatDateShort(m.dueDate)}` : "No date yet" })),
    ],
    [milestones.data, contractorId]
  );

  const submit = form.handleSubmit((body) =>
    raise.mutate(body, {
      onSuccess: (c) => {
        onClose();
        onRaised?.(c.id);
      },
    })
  );

  return (
    <ModalShell title="Raise a default case" subtitle="Goes through the project's default case chain" onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} noValidate className="p-5 space-y-4">
        <Controller
          control={form.control}
          name="projectContractorId"
          render={({ field }) => (
            <CustomSelect
              label="Contractor"
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                field.onBlur();
              }}
              error={visibleError(form, "projectContractorId")}
              options={contractors.map((r) => ({
                value: r.projectContractorId,
                label: `${r.organizationName} (${r.tradeCode})`,
                disabled: Boolean(r.openDefaultCaseId),
                badge: r.openDefaultCaseId ? "Case open" : undefined,
              }))}
              placeholder={compliance.isLoading ? "Loading contractors…" : "Choose the contractor"}
            />
          )}
        />
        <Controller
          control={form.control}
          name="milestoneId"
          render={({ field }) => (
            <CustomSelect label="Milestone (optional)" value={field.value} onChange={field.onChange} options={milestoneOptions} searchable={milestoneOptions.length > 8} />
          )}
        />
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="case-summary">
            What is the default?
          </label>
          <textarea id="case-summary" rows={4} maxLength={2000} className={`${smallInput} ${invalidClass(form, "summary")}`} {...form.register("summary")} {...fieldA11y(form, "summary")} />
          <FieldError form={form} name="summary" />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={`${secondaryButton} self-start`} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton form={form} pending={raise.isPending} pendingLabel="Opening…" className={primaryButton}>
            Open the case
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
