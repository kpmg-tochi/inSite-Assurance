import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { ArrowLeft, ExternalLink, FilePlus2, Info, Pencil, Send } from "lucide-react";
import {
  OUT_OF_CYCLE_REASON_LABELS,
  OutOfCycleReasonEnum,
  OutOfCycleRequestSchema,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  type NeedsOutOfCycleDto,
  type OutOfCycleReason,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { CustomSelect } from "../../common/CustomSelect";
import { dangerButton, primaryButton, secondaryButton } from "../../contracts/contractUi";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zChoice, zNumberText } from "../../../lib/forms";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useAuth } from "../../../lib/auth-context";
import { getProposalDocumentLink } from "../../../api/needsPipeline";
import { useOutOfCycleRequestQuery } from "../../../queries/needs/useApprovalQueries";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import {
  useOutOfCycleActionMutation,
  useSubmitOutOfCycleMutation,
  useUpdateOutOfCycleMutation,
  useWithdrawOutOfCycleMutation,
} from "../../../mutations/needs/useApprovalMutations";
import { stateName } from "../../approvedLists/approvedListUi";
import { EmptyPanel, ProposalStatusTag, cardCls, formatBytes, inputCls, labelCls, money } from "../needsUi";
import { ApprovalDecisionForm } from "../submissions/ApprovalDecisionForm";
import { ActionsHistory, ChainSteps, SubmissionStatusTag } from "../submissions/submissionUi";
import { OutOfCycleDocumentDialog } from "./OutOfCycleDocumentDialog";
import { OutOfCycleNeedsAssessment } from "./OutOfCycleNeedsAssessment";
import { OutsideCycleChip } from "../integration/OriginChip";

/**
 * Needs pipeline wave 4 (C4, D-N.14): one out-of-cycle request (`/app/needs-assessment/out-of-cycle/:id`).
 * The requester edits it while draft or returned, adds the authorising document (required) and an
 * optional needs assessment, submits it and may withdraw it; the step's approvers (`canAct`) approve
 * or return it. On final approval it becomes a draft project (origin "Outside annual cycle").
 */
export function OutOfCyclePage() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const query = useOutOfCycleRequestQuery(proposalId);

  if (query.isLoading) {
    return (
      <div role="status" className="h-48 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
        <span className="sr-only">Loading the request…</span>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="space-y-4">
        <BackLink cycleId={null} />
        <EmptyPanel title="This request could not be loaded">{(query.error as Error)?.message || "It may have been removed, or you may not have access to it."}</EmptyPanel>
      </div>
    );
  }
  return <RequestView request={query.data} />;
}

function BackLink({ cycleId }: { cycleId: string | null }) {
  return (
    <Link
      to={cycleId ? `/app/needs-assessment?cycle=${cycleId}&tab=approvals` : "/app/needs-assessment"}
      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Approvals
    </Link>
  );
}

const CLOSED_STATUSES = ["CONVERTED", "WITHDRAWN", "NOT_SELECTED", "NOT_VALIDATED", "MERGED"];

function RequestView({ request }: { request: NeedsOutOfCycleDto }) {
  const { hasPermission } = useAuth();
  const submission = request.submission;
  const submitReq = useSubmitOutOfCycleMutation(request.proposalId);
  const act = useOutOfCycleActionMutation(request.proposalId);
  const openFile = useOpenNeedsFileMutation();
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [addingDoc, setAddingDoc] = useState<"AUTHORISING_DOCUMENT" | "OTHER" | null>(null);

  const draftLike = submission.status === "DRAFT" || submission.status === "RETURNED";
  const closed = CLOSED_STATUSES.includes(request.status);
  const canSubmit = request.canEdit && draftLike && !closed;
  const hasAuthorising = Boolean(request.authorisingDocument);
  const canWithdraw = hasPermission("needs:submit") && !closed && submission.status !== "APPROVED" && (request.canEdit || submission.status === "IN_REVIEW");
  const otherDocs = request.documents.filter((d) => d.id !== request.authorisingDocument?.id);

  return (
    <div className="space-y-4">
      <BackLink cycleId={request.cycleId} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500">
            {request.reference} · {request.projectTypeName} {request.interventionYear}
            {request.stateCode ? ` · ${stateName(request.stateCode)}` : ""}
          </p>
          <h2 className="text-lg font-bold text-slate-900">{request.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <OutsideCycleChip />
            <ProposalStatusTag status={request.status} label={request.statusLabel} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canWithdraw && (
            <button type="button" className={dangerButton} onClick={() => setWithdrawing(true)}>
              Withdraw
            </button>
          )}
          {request.canEdit && !closed && (
            <button type="button" className={secondaryButton} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
            </button>
          )}
          {canSubmit && (
            <button type="button" className={primaryButton} disabled={!hasAuthorising || submitReq.isPending} onClick={() => submitReq.mutate()}>
              <Send className="h-3.5 w-3.5" aria-hidden="true" /> {submitReq.isPending ? "Submitting…" : submission.status === "RETURNED" ? "Resubmit for approval" : "Submit for approval"}
            </button>
          )}
        </div>
      </header>
      {canSubmit && !hasAuthorising && <p className="text-right text-[11px] text-slate-500">Add the authorising document before submitting.</p>}

      {request.projectId && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Approved: it is now the draft project{" "}
          <Link to={`/app/projects/${request.projectId}/setup`} className="font-semibold underline">
            {request.projectCode ?? "in setup"}
          </Link>
          .
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <section className={`${cardCls} space-y-2`} aria-labelledby="ooc-request">
            <h3 id="ooc-request" className="text-sm font-bold text-slate-900">
              Request
            </h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <Fact label="Reason" value={request.reasonLabel} />
              <Fact label="Amount requested" value={money(request.requestedAmountNgn)} />
              <Fact label="Requested by" value={`${request.createdByName}, ${formatDateTimeShort(request.createdAt)}`} />
              <Fact label="Cycle" value={`${request.interventionYear}${request.cycleStatus === "CLOSED" ? " (closed cycle)" : ""}`} />
            </dl>
            <div className="text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Why it cannot wait</p>
              <p className="whitespace-pre-line text-slate-800">{request.reasonDetails}</p>
            </div>
          </section>

          <section className={`${cardCls} space-y-2`} aria-labelledby="ooc-documents">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 id="ooc-documents" className="text-sm font-bold text-slate-900">
                Documents
              </h3>
              {request.canEdit && !closed && (
                <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline" onClick={() => setAddingDoc(hasAuthorising ? "OTHER" : "AUTHORISING_DOCUMENT")}>
                  <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Add a document
                </button>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Authorising document <span className="text-rose-600">*</span>
              </p>
              {request.authorisingDocument ? (
                <DocRow doc={request.authorisingDocument} onOpen={() => openFile.mutate(() => getProposalDocumentLink(request.proposalId, request.authorisingDocument!.id))} />
              ) : (
                <p className="text-slate-600">
                  Not added yet.{" "}
                  {request.canEdit && !closed && (
                    <button type="button" className="font-semibold text-brand-primary hover:underline" onClick={() => setAddingDoc("AUTHORISING_DOCUMENT")}>
                      Upload it
                    </button>
                  )}
                </p>
              )}
            </div>
            {otherDocs.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs">
                {otherDocs.map((d) => (
                  <li key={d.id} className="px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{PROPOSAL_DOCUMENT_KIND_LABELS[d.kind]}</p>
                    <DocRow doc={d} onOpen={() => openFile.mutate(() => getProposalDocumentLink(request.proposalId, d.id))} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <OutOfCycleNeedsAssessment request={request} />
        </div>

        <div className="space-y-4 xl:col-span-5">
          <section className={`${cardCls} space-y-3`} aria-labelledby="ooc-approval">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 id="ooc-approval" className="text-sm font-bold text-slate-900">
                Out-of-cycle approval
              </h3>
              <SubmissionStatusTag status={submission.status} label={submission.statusLabel} />
            </div>
            <ChainSteps submission={submission} />
            <h4 className="pt-1 text-xs font-bold text-slate-900">Decisions</h4>
            <ActionsHistory actions={submission.actions} />
            {submission.status === "IN_REVIEW" && !submission.canAct && submission.cannotActReason && (
              <p className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {submission.cannotActReason}
              </p>
            )}
          </section>
          {submission.status === "IN_REVIEW" && submission.canAct && (
            <ApprovalDecisionForm
              submission={submission}
              cycleId={request.cycleId}
              portfolio={false}
              pending={act.isPending}
              onDecide={(body, done) => act.mutate(body, { onSuccess: done })}
            />
          )}
        </div>
      </div>

      {editing && <EditRequestDialog request={request} onClose={() => setEditing(false)} />}
      {withdrawing && <WithdrawDialog request={request} onClose={() => setWithdrawing(false)} />}
      {addingDoc && <OutOfCycleDocumentDialog proposalId={request.proposalId} initialKind={addingDoc} onClose={() => setAddingDoc(null)} />}
    </div>
  );
}

function DocRow({ doc, onOpen }: { doc: NeedsOutOfCycleDto["documents"][number]; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="min-w-0">
        <span className="font-semibold text-slate-900">{doc.title}</span>
        <span className="block text-[11px] text-slate-500">
          {doc.fileName} · {formatBytes(doc.byteSize)} · {doc.uploadedByName}, {formatDateTimeShort(doc.uploadedAt)}
        </span>
      </span>
      <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline" onClick={onOpen}>
        Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

const EditSchema = z
  .object({
    title: OutOfCycleRequestSchema.shape.title,
    reason: zChoice("Reason"),
    reasonDetails: OutOfCycleRequestSchema.shape.reasonDetails,
    requestedAmount: zNumberText("Amount requested", { min: 1 }),
  })
  .transform((v) => ({ title: v.title, reason: v.reason as OutOfCycleReason, reasonDetails: v.reasonDetails, requestedAmountNgn: v.requestedAmount }));

function EditRequestDialog({ request, onClose }: { request: NeedsOutOfCycleDto; onClose: () => void }) {
  const update = useUpdateOutOfCycleMutation(request.proposalId);
  const form = useZodForm(EditSchema, {
    defaultValues: { title: request.title, reason: request.reason, reasonDetails: request.reasonDetails, requestedAmount: String(request.requestedAmountNgn) },
  });
  const reason = form.watch("reason");
  const submit = form.handleSubmit((v) => update.mutate(v, { onSuccess: () => onClose() }));
  return (
    <ModalShell title="Edit the request" subtitle={request.reference} onClose={onClose} maxWidth="max-w-2xl">
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <div>
          <label className={labelCls} htmlFor="ooc-edit-title">
            Title <span className="text-rose-600">*</span>
          </label>
          <input id="ooc-edit-title" className={`${inputCls} ${invalidClass(form, "title")}`} {...form.register("title")} {...fieldA11y(form, "title")} />
          <FieldError form={form} name="title" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="ooc-edit-reason">
              Reason <span className="text-rose-600">*</span>
            </label>
            <CustomSelect
              id="ooc-edit-reason"
              value={reason}
              onChange={(v) => form.setValue("reason", v, { shouldValidate: true, shouldDirty: true })}
              options={OutOfCycleReasonEnum.options.map((r) => ({ value: r, label: OUT_OF_CYCLE_REASON_LABELS[r] }))}
              size="sm"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ooc-edit-amount">
              Amount requested (₦) <span className="text-rose-600">*</span>
            </label>
            <input id="ooc-edit-amount" inputMode="decimal" className={`${inputCls} ${invalidClass(form, "requestedAmount")}`} {...form.register("requestedAmount")} {...fieldA11y(form, "requestedAmount")} />
            <FieldError form={form} name="requestedAmount" />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="ooc-edit-details">
            Why it cannot wait for the annual cycle <span className="text-rose-600">*</span>
          </label>
          <textarea id="ooc-edit-details" rows={4} className={`${inputCls} ${invalidClass(form, "reasonDetails")}`} {...form.register("reasonDetails")} {...fieldA11y(form, "reasonDetails")} />
          <FieldError form={form} name="reasonDetails" />
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={update.isPending} pendingLabel="Saving…">
            Save
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}

const WithdrawSchema = z.object({ reason: z.string().trim().min(5, "Give the reason").max(1000) });

function WithdrawDialog({ request, onClose }: { request: NeedsOutOfCycleDto; onClose: () => void }) {
  const withdraw = useWithdrawOutOfCycleMutation(request.proposalId);
  const form = useZodForm(WithdrawSchema, { defaultValues: { reason: "" } });
  const submit = form.handleSubmit((v) => withdraw.mutate(v.reason, { onSuccess: () => onClose() }));
  return (
    <ModalShell title="Withdraw the request" subtitle={request.reference} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <p className="text-xs text-slate-700">A withdrawn request stops here and cannot be submitted again. Its documents stay on record.</p>
        <div>
          <label className={labelCls} htmlFor="ooc-withdraw-reason">
            Reason <span className="text-rose-600">*</span>
          </label>
          <textarea id="ooc-withdraw-reason" rows={3} className={`${inputCls} ${invalidClass(form, "reason")}`} {...form.register("reason")} {...fieldA11y(form, "reason")} />
          <FieldError form={form} name="reason" />
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton
            form={form}
            pending={withdraw.isPending}
            pendingLabel="Withdrawing…"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Withdraw
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
