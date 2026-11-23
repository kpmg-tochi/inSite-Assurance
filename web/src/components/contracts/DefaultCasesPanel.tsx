import React, { useMemo, useState } from "react";
import { Gavel, Plus } from "lucide-react";
import type { ContractorDefaultCaseDto } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common";
import Loader from "../Loader";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort } from "../../lib/formatters";
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
  const [contractorId, setContractorId] = useState(defaultContractorId ?? "");
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId ?? "");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  const contractors = (compliance.data ?? []).filter((r) => r.contractStatus === "ACTIVE");
  const milestoneOptions = useMemo(
    () => [
      { value: "", label: "Not about one milestone" },
      ...(milestones.data?.milestones ?? [])
        .filter((m) => m.status !== "DONE" && m.status !== "WAIVED")
        .filter((m) => !contractorId || m.projectContractorId === null || m.projectContractorId === contractorId)
        .map((m) => ({ value: m.id, label: m.label, description: m.dueDate ? `Due ${m.dueDate}` : "No date yet" })),
    ],
    [milestones.data, contractorId]
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractorId) return setError("Choose the contractor.");
    if (summary.trim().length < 10) return setError("Describe the default in at least 10 characters.");
    setError(null);
    raise.mutate(
      { projectContractorId: contractorId, summary: summary.trim(), milestoneId: milestoneId || null },
      {
        onSuccess: (c) => {
          onClose();
          onRaised?.(c.id);
        },
      }
    );
  };

  return (
    <ModalShell title="Raise a default case" subtitle="Goes through the project's default case chain" onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} className="p-5 space-y-4">
        <CustomSelect
          label="Contractor"
          value={contractorId}
          onChange={(v) => setContractorId(v)}
          options={contractors.map((r) => ({
            value: r.projectContractorId,
            label: `${r.organizationName} (${r.tradeCode})`,
            disabled: Boolean(r.openDefaultCaseId),
            badge: r.openDefaultCaseId ? "Case open" : undefined,
          }))}
          placeholder={compliance.isLoading ? "Loading contractors…" : "Choose the contractor"}
        />
        <CustomSelect label="Milestone (optional)" value={milestoneId} onChange={(v) => setMilestoneId(v)} options={milestoneOptions} searchable={milestoneOptions.length > 8} />
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="case-summary">
            What is the default?
          </label>
          <textarea id="case-summary" rows={4} maxLength={2000} className={smallInput} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={raise.isPending}>
            {raise.isPending ? "Opening…" : "Open the case"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
