import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, FilePlus2, X } from "lucide-react";
import {
  CYCLE_DOCUMENT_KIND_META,
  StageDecisionRequestSchema,
  returnTarget,
  type NeedsBatchProblem,
  type NeedsCycleDto,
  type NeedsDecisionResultDto,
  type NeedsSeparationErrorCode,
  type NeedsStage,
  type StageOutcome,
} from "@insite/shared";
import Drawer from "../../Drawer";
import { CustomSelect } from "../../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { formatDateTimeShort } from "../../../lib/formatters";
import { getCycleDocumentLink } from "../../../api/needsPipeline";
import { useNeedsCycleQuery } from "../../../queries/needs/useNeedsQueries";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import { useStageDecisionMutation } from "../../../mutations/needs/useDecisionMutations";
import { NeedsDocumentDialog } from "../NeedsDocumentDialog";
import { formatBytes, inputCls, labelCls, stageLabel } from "../needsUi";
import { BatchProblemsList, batchProblemsOf, outcomeLabel, separationCodeOf, SEPARATION_ACTION_FOR_CODE } from "./decisionUi";
import { AskOverrideDialog } from "./SeparationOverride";

/**
 * Needs pipeline wave 3 (C1, D-N.4): a stage decision on one or more proposed projects
 * (`POST /cycles/:cycleId/decisions`). Each proposal gets an outcome and, for anything but moving on,
 * a reason (its own or the batch reason). Evidence = cycle documents (tick existing ones or upload
 * one; a new upload is ticked for you). All or nothing: a refusal lists each refused proposal and
 * separation of duties problems offer "Ask for an override". The result names the reports generated.
 */

type DrawerProposal = { id: string; reference: string; title: string };

export function DecisionDrawer({
  cycle,
  stage,
  proposals,
  outcomes,
  initialOutcome,
  onClose,
  onDone,
}: {
  cycle: NeedsCycleDto;
  stage: NeedsStage;
  proposals: DrawerProposal[];
  /** The outcomes the user may give every proposal here (`decisionOutcomesFor`). */
  outcomes: StageOutcome[];
  initialOutcome: StageOutcome;
  onClose: () => void;
  onDone?: (result: NeedsDecisionResultDto) => void;
}) {
  const titleId = useId();
  const [result, setResult] = useState<NeedsDecisionResultDto | null>(null);
  const [asking, setAsking] = useState<{ proposal: DrawerProposal; code: NeedsSeparationErrorCode } | null>(null);
  const [uploading, setUploading] = useState(false);
  const nested = Boolean(asking) || uploading;

  return (
    <Drawer onClick={(e) => e.target === e.currentTarget && !nested && onClose()} onClose={() => !nested && onClose()} labelledBy={titleId}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-sm font-bold text-slate-900">
              {result ? "Decision recorded" : `${stageLabel(cycle, stage)}: record the decision`}
            </h3>
            <p className="text-[11px] text-slate-500">
              {proposals.length === 1 ? `${proposals[0].reference} · ${proposals[0].title}` : `${proposals.length} proposed projects`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {result ? (
          <DecisionResult cycle={cycle} result={result} onClose={onClose} />
        ) : (
          <DecisionForm
            cycle={cycle}
            stage={stage}
            proposals={proposals}
            outcomes={outcomes}
            initialOutcome={initialOutcome}
            onCancel={onClose}
            onUpload={() => setUploading(true)}
            uploading={uploading}
            onAskOverride={(problem, code) => {
              const proposal = proposals.find((p) => p.id === problem.proposalId) ?? { id: problem.proposalId, reference: problem.reference, title: "" };
              setAsking({ proposal, code });
            }}
            onDone={(r) => {
              setResult(r);
              onDone?.(r);
            }}
          />
        )}
      </div>
      {uploading && (
        <NeedsDocumentDialog target="cycle" cycleId={cycle.id} proposals={proposals} onClose={() => setUploading(false)} />
      )}
      {asking && (
        <AskOverrideDialog
          cycleId={cycle.id}
          proposal={asking.proposal}
          code={asking.code}
          action={SEPARATION_ACTION_FOR_CODE[asking.code]}
          onClose={() => setAsking(null)}
        />
      )}
    </Drawer>
  );
}

function DecisionForm({
  cycle,
  stage,
  proposals,
  outcomes,
  initialOutcome,
  onCancel,
  onUpload,
  uploading,
  onAskOverride,
  onDone,
}: {
  cycle: NeedsCycleDto;
  stage: NeedsStage;
  proposals: DrawerProposal[];
  outcomes: StageOutcome[];
  initialOutcome: StageOutcome;
  onCancel: () => void;
  onUpload: () => void;
  uploading: boolean;
  onAskOverride: (problem: NeedsBatchProblem, code: NeedsSeparationErrorCode) => void;
  onDone: (result: NeedsDecisionResultDto) => void;
}) {
  const decide = useStageDecisionMutation(cycle.id);
  // The cycle's documents, fresh (an upload from here adds one).
  const cycleQuery = useNeedsCycleQuery(cycle.id);
  const documents = useMemo(() => cycleQuery.data?.documents ?? cycle.documents, [cycleQuery.data, cycle.documents]);
  const supersededIds = useMemo(() => new Set(documents.map((d) => d.supersedesId).filter(Boolean)), [documents]);
  const current = useMemo(() => documents.filter((d) => !supersededIds.has(d.id)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)), [documents, supersededIds]);

  const form = useZodForm(StageDecisionRequestSchema, {
    defaultValues: {
      stage,
      reason: "",
      evidenceDocumentIds: [],
      items: proposals.map((p) => ({ proposalId: p.id, outcome: initialOutcome, reason: "" })),
    },
  });
  const items = form.watch("items");
  const evidence = form.watch("evidenceDocumentIds") ?? [];
  const batchReason = form.watch("reason");

  // A document uploaded from here is ticked once it appears.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (uploading) known.current = new Set(documents.map((d) => d.id));
  }, [uploading, documents]);
  useEffect(() => {
    if (uploading || !known.current) return;
    const added = documents.filter((d) => !known.current!.has(d.id)).map((d) => d.id);
    known.current = null;
    if (added.length) form.setValue("evidenceDocumentIds", [...new Set([...(form.getValues("evidenceDocumentIds") ?? []), ...added])], { shouldValidate: true });
  }, [uploading, documents, form]);

  const outcomeOptions = outcomes.map((o) => ({ value: o, label: outcomeLabel(stage, o) }));
  const target = returnTarget(cycle.config, stage);
  const anyReturn = (items ?? []).some((i) => i.outcome === "RETURN");
  const problems = batchProblemsOf(decide.error);
  const separation = separationCodeOf(decide.error);

  const setAll = (outcome: StageOutcome) =>
    form.setValue(
      "items",
      (form.getValues("items") ?? []).map((i) => ({ ...i, outcome })),
      { shouldValidate: true, shouldDirty: true }
    );

  const toggleEvidence = (id: string, on: boolean) => {
    const now = form.getValues("evidenceDocumentIds") ?? [];
    form.setValue("evidenceDocumentIds", on ? [...now, id] : now.filter((x) => x !== id), { shouldValidate: true, shouldDirty: true });
  };

  const submit = form.handleSubmit((values) => {
    const body = {
      ...values,
      reason: values.reason || null,
      items: values.items.map((i) => ({ ...i, reason: i.reason || null })),
    };
    decide.mutate(body, { onSuccess: onDone });
  });

  return (
    <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={submit}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {proposals.length > 1 && outcomes.length > 1 && (
          <div>
            <p className={labelCls} id="decision-all">
              Outcome for every proposed project
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="decision-all">
              {outcomes.map((o) => (
                <button
                  key={o}
                  type="button"
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  onClick={() => setAll(o)}
                >
                  {outcomeLabel(stage, o)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Then change any single one below.</p>
          </div>
        )}

        <fieldset>
          <legend className={labelCls}>Each proposed project</legend>
          <ul className="space-y-2">
            {proposals.map((p, i) => {
              const outcome = items?.[i]?.outcome ?? initialOutcome;
              const needsReason = outcome !== "ADVANCE" && !batchReason?.trim();
              const problem = problems.find((x) => x.proposalId === p.id);
              return (
                <li key={p.id} className={`rounded-xl border p-3 ${problem ? "border-rose-300 bg-rose-50/40" : "border-slate-200"}`}>
                  <p className="text-xs">
                    <span className="font-semibold text-slate-900">{p.reference}</span> <span className="text-slate-600">· {p.title}</span>
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {outcomes.length > 1 ? (
                      <CustomSelect
                        ariaLabel={`Outcome for ${p.reference}`}
                        value={outcome}
                        onChange={(v) => form.setValue(`items.${i}.outcome`, v as StageOutcome, { shouldValidate: true, shouldDirty: true })}
                        options={outcomeOptions}
                        size="sm"
                      />
                    ) : (
                      <p className="text-xs font-semibold text-slate-800">{outcomeLabel(stage, outcome)}</p>
                    )}
                    <div>
                      <label className="sr-only" htmlFor={`decision-reason-${i}`}>
                        Reason for {p.reference}
                      </label>
                      <input
                        id={`decision-reason-${i}`}
                        className={`${inputCls} ${invalidClass(form, `items.${i}.reason`)}`}
                        placeholder={needsReason ? "Reason (required)" : "Reason (optional)"}
                        {...form.register(`items.${i}.reason`, { deps: ["reason"] })}
                        {...fieldA11y(form, `items.${i}.reason`)}
                      />
                      <FieldError form={form} name={`items.${i}.reason`} />
                    </div>
                    {problem && <p className="text-[11px] font-medium text-rose-800">{problem.message}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {anyReturn && target && (
            <p className="mt-2 text-[11px] text-slate-600">
              A returned proposed project goes back for correction at {stageLabel(cycle, target.correctionStage)}, then returns to {stageLabel(cycle, target.resubmitTo)} when it is
              resubmitted.
            </p>
          )}
        </fieldset>

        <div>
          <label className={labelCls} htmlFor="decision-batch-reason">
            Reason for the whole decision <span className="font-normal text-slate-500">(optional; used where an item has none)</span>
          </label>
          <textarea
            id="decision-batch-reason"
            rows={2}
            className={`${inputCls} ${invalidClass(form, "reason")}`}
            placeholder="e.g. Validated at the M&E review meeting of 28 July"
            {...form.register("reason", { deps: (items ?? []).map((_, i) => `items.${i}.reason`) as `items.${number}.reason`[] })}
            {...fieldA11y(form, "reason")}
          />
          <FieldError form={form} name="reason" />
        </div>

        <fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <legend className={labelCls}>Evidence (cycle documents)</legend>
            <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline" onClick={onUpload}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Upload a document
            </button>
          </div>
          {current.length === 0 ? (
            <p className="text-xs text-slate-500">The cycle has no documents yet. Upload the minutes or memo the decision rests on, if there is one.</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {current.map((d) => (
                <label key={d.id} className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={evidence.includes(d.id)} onChange={(e) => toggleEvidence(d.id, e.target.checked)} />
                  <span>
                    <span className="font-semibold text-slate-900">{d.title}</span> · {CYCLE_DOCUMENT_KIND_META[d.kind].label}
                    <span className="block text-[11px] text-slate-500">
                      {d.fileName} · {formatBytes(d.byteSize)} · {formatDateTimeShort(d.uploadedAt)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <FieldError form={form} name="evidenceDocumentIds" />
        </fieldset>

        <BatchProblemsList problems={problems} onAskOverride={onAskOverride} />
        {separation && problems.length === 0 && proposals.length === 1 && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p>{decide.error instanceof Error ? decide.error.message : "Separation of duties stops you from this step."}</p>
            <button
              type="button"
              className="mt-1 font-semibold text-brand-primary hover:underline"
              onClick={() => onAskOverride({ proposalId: proposals[0].id, reference: proposals[0].reference, code: separation, message: "" }, separation)}
            >
              Ask for an override
            </button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-start justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
          Cancel
        </button>
        <SubmitButton form={form} pending={decide.isPending} pendingLabel="Recording…" hint="Give a reason for every proposed project that does not move on.">
          Record the decision
        </SubmitButton>
      </div>
    </form>
  );
}

function DecisionResult({ cycle, result, onClose }: { cycle: NeedsCycleDto; result: NeedsDecisionResultDto; onClose: () => void }) {
  const openFile = useOpenNeedsFileMutation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved for {result.items.length} proposed project{result.items.length === 1 ? "" : "s"}.
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs">
          {result.items.map((i) => (
            <li key={i.proposalId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
              <Link className="font-semibold text-brand-primary hover:underline" to={`/app/needs-assessment/proposals/${i.proposalId}`}>
                {i.reference}
              </Link>
              <span className="text-slate-700">{i.statusLabel}</span>
            </li>
          ))}
        </ul>
        {result.generatedDocuments.length > 0 && (
          <section aria-labelledby="decision-generated">
            <h4 id="decision-generated" className="text-xs font-bold text-slate-900">
              Reports generated
            </h4>
            <ul className="mt-1 space-y-1 text-xs">
              {result.generatedDocuments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="font-semibold text-slate-900">{CYCLE_DOCUMENT_KIND_META[d.kind].label}</span>
                    <span className="text-slate-500"> · {d.fileName}</span>
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline disabled:opacity-50"
                    disabled={openFile.isPending}
                    onClick={() => openFile.mutate(() => getCycleDocumentLink(cycle.id, d.id))}
                  >
                    Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <Link className="mt-2 inline-block text-xs font-semibold text-brand-primary hover:underline" to={`/app/needs-assessment?cycle=${cycle.id}&tab=documents`}>
              See them in Cycle documents
            </Link>
          </section>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-slate-100 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover">
          Done
        </button>
      </div>
    </div>
  );
}
