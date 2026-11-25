import React, { useState } from "react";
import { ClipboardPen, ListChecks, Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray } from "react-hook-form";
import { z } from "zod";
import {
  DefectSeverityEnum,
  HANDOVER_DECISION_LABELS,
  HANDOVER_LIMITS,
  HANDOVER_STAKEHOLDER_LABELS,
  HandoverDecisionEnum,
  HandoverStakeholderTypeEnum,
  RecordHandoverResponseRequestSchema,
  ReviewHandoverSubmissionRequestSchema,
  type DefectSeverity,
  type RecordHandoverResponseInput,
  type HandoverDecision,
  type HandoverStakeholderType,
  type ProjectBeneficiaryDto,
  type HandoverSubmissionDto,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import Loader from "../../components/Loader";
import { TableBadge } from "../../components/table/StandardTable";
import { CustomSelect } from "../../components/common";
import { ModalActions, ModalShell, inputClass } from "../../components/common/ModalShell";
import { RichTextView } from "../../components/closeout/RichTextView";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useHandoverSubmissionsQuery, useProjectPhaseQuery } from "../../queries/closeout/useCloseoutQueries";
import {
  useConvertSnagsMutation,
  useRecordHandoverResponseMutation,
  useReviewHandoverSubmissionMutation,
} from "../../mutations/closeout/useCloseoutMutations";

const DECISION_BADGE: Record<HandoverDecision, "success" | "warning" | "danger"> = {
  ACCEPTED: "success",
  ACCEPTED_WITH_SNAGS: "warning",
  REJECTED: "danger",
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Completion & handover → Handover (Phase 10; redesign R1d, R6b): the beneficiary has no login and
 * there is no public link. An officer records the beneficiary's response from the signed paper copy
 * (accept, accept with snags, reject); reviewers mark responses reviewed and turn snags into defect
 * tickets. The tab is shown only when the handover module is on.
 */
export function HandoverTab({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const processQuery = useProjectProcess(project.id);
  const enabled = processQuery.data?.config.enableHandoverModule ?? false;
  const canRecord = hasPermission("handover:record_response");
  const canReview = hasPermission("handover:review_feedback");
  const phaseQuery = useProjectPhaseQuery(project.id, enabled);
  // The list is open to recorders and reviewers; only reviewers mark a response reviewed.
  const canSeeResponses = canReview || canRecord;
  const submissionsQuery = useHandoverSubmissionsQuery(project.id, enabled && canSeeResponses);
  const [recordOpen, setRecordOpen] = useState(false);

  if (processQuery.isLoading) return <Loader />;
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
        Stakeholder handover is not used on this project.
      </div>
    );
  }
  const inHandover = phaseQuery.data?.phase === "HANDOVER_IN_PROGRESS";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          Record whether the beneficiary accepted the works, accepted them with punch list items, or rejected them.
        </p>
        {canRecord && (
          <button
            type="button"
            disabled={!inHandover}
            title={inHandover ? undefined : "Responses can be recorded once the project is in handover."}
            onClick={() => setRecordOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            <ClipboardPen className="h-4 w-4" /> Record handover response
          </button>
        )}
      </div>

      {canRecord && !inHandover && phaseQuery.data && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Responses can be recorded only while the project is in handover. Start the handover from the project Overview.
        </div>
      )}

      {canSeeResponses && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Responses</h2>
          {submissionsQuery.isLoading && <Loader />}
          {submissionsQuery.data?.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">No responses yet.</div>
          )}
          {submissionsQuery.data?.map((s) => (
            <SubmissionCard key={s.id} project={project} submission={s} canReview={canReview} canConvert={hasPermission("defects:manage")} />
          ))}
        </section>
      )}

      {recordOpen && (
        <RecordResponseModal
          projectId={project.id}
          primaryBeneficiary={project.primaryBeneficiary ?? null}
          onClose={() => setRecordOpen(false)}
        />
      )}
    </div>
  );
}

/** Phase 11: the stakeholder type a beneficiary most likely is. */
function stakeholderTypeFor(b: ProjectBeneficiaryDto | null): HandoverStakeholderType {
  if (!b) return "COMMUNITY_REPRESENTATIVE";
  if (b.beneficiaryType === "COMMUNITY") return "COMMUNITY_REPRESENTATIVE";
  if (b.beneficiaryType === "SCHOOL" || b.beneficiaryType === "INSTITUTION") return "CLIENT_STAFF";
  return "OTHER";
}

const emptySnag = () => ({ title: "", location: "", description: "" });

/** A snag row the officer has typed anything into (blank rows are left out of the request). */
const snagHasContent = (s: { title: string; location: string; description: string }) =>
  Boolean(s.title.trim() || s.location.trim() || s.description.trim());

/**
 * The form holds plain inputs; the request is RecordHandoverResponseRequestSchema. Every rule of the
 * shared schema is applied by parsing the request it would send and copying each issue back onto the
 * input it came from (snag issues back onto the row the officer typed, blank rows skipped).
 */
const RecordResponseFieldsSchema = z.object({
  stakeholderType: HandoverStakeholderTypeEnum,
  decision: HandoverDecisionEnum,
  submitterName: z.string(),
  submitterRole: z.string(),
  feedbackText: z.string(),
  snags: z.array(z.object({ title: z.string(), location: z.string(), description: z.string() })),
  attest: z.boolean(),
});
type RecordResponseFormValues = z.infer<typeof RecordResponseFieldsSchema>;

const RecordResponseFormSchema = RecordResponseFieldsSchema
  .superRefine((v, ctx) => {
    const rowIndexes = v.snags.flatMap((s, i) => (snagHasContent(s) ? [i] : []));
    const parsed = RecordHandoverResponseRequestSchema.safeParse(toHandoverRequest(v));
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      const path = [...issue.path];
      if (path[0] === "snags" && typeof path[1] === "number") path[1] = rowIndexes[path[1]] ?? path[1];
      ctx.addIssue({ code: "custom", path, message: issue.message });
    }
  })
  .transform((v) => RecordHandoverResponseRequestSchema.parse(toHandoverRequest(v)));


function toHandoverRequest(v: RecordResponseFormValues): RecordHandoverResponseInput {
  return {
    stakeholderType: v.stakeholderType,
    decision: v.decision,
    submitterName: v.submitterName,
    submitterRole: v.submitterRole,
    feedbackText: v.feedbackText,
    snags:
      v.decision === "ACCEPTED"
        ? []
        : v.snags.filter(snagHasContent).map((s) => ({
            title: s.title,
            location: s.location.trim() || undefined,
            description: s.description.trim() || undefined,
          })),
    attest: v.attest as true,
  };
}

/** Redesign R1d: an officer records the beneficiary's response from the signed paper copy and attests it. */
function RecordResponseModal({
  projectId,
  primaryBeneficiary,
  onClose,
}: {
  projectId: string;
  /** Pre-fills the person who signed (still editable). */
  primaryBeneficiary: ProjectBeneficiaryDto | null;
  onClose: () => void;
}) {
  const mutation = useRecordHandoverResponseMutation(projectId);
  const form = useZodForm(RecordResponseFormSchema, {
    defaultValues: {
      stakeholderType: stakeholderTypeFor(primaryBeneficiary),
      decision: "ACCEPTED",
      submitterName: primaryBeneficiary?.contactName || primaryBeneficiary?.name || "",
      submitterRole: "",
      feedbackText: "",
      snags: [],
      attest: false,
    },
  });
  const snags = useFieldArray({ control: form.control, name: "snags" });
  const decision = form.watch("decision");

  const withSnags = decision !== "ACCEPTED";
  const chooseDecision = (d: HandoverDecision) => {
    form.setValue("decision", d, { shouldValidate: true, shouldDirty: true });
    if (d === "ACCEPTED_WITH_SNAGS" && snags.fields.length === 0) snags.append(emptySnag(), { shouldFocus: false });
    // The decision changes what the comments and snags need.
    void form.trigger(["feedbackText", "snags"]);
  };

  const submit = form.handleSubmit(async (body) => {
    try {
      await mutation.mutateAsync(body);
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  });

  const snagsRootError = (form.formState.errors.snags as { message?: string; root?: { message?: string } } | undefined);
  const snagsMessage = snagsRootError?.message ?? snagsRootError?.root?.message;

  return (
    <ModalShell title="Record handover response" subtitle="Copy the beneficiary's response from the signed paper copy" onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={submit} className="space-y-4 p-5 text-xs" noValidate>
        <fieldset className="space-y-2">
          <legend className="font-semibold text-slate-700 mb-1">Decision</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {HandoverDecisionEnum.options.map((d) => (
              <label
                key={d}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer ${
                  decision === d ? "border-brand-primary bg-brand-primary/5" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input type="radio" name="handover-decision" checked={decision === d} onChange={() => chooseDecision(d)} />
                <span className="font-semibold text-slate-800">{HANDOVER_DECISION_LABELS[d]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Name of the person who signed</span>
            <input
              className={`${inputClass} ${invalidClass(form, "submitterName")}`}
              maxLength={120}
              {...form.register("submitterName")}
              {...fieldA11y(form, "submitterName")}
            />
            <FieldError form={form} name="submitterName" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Their role</span>
            <input
              className={`${inputClass} ${invalidClass(form, "submitterRole")}`}
              maxLength={120}
              placeholder="e.g. Head teacher"
              {...form.register("submitterRole")}
              {...fieldA11y(form, "submitterRole")}
            />
            <FieldError form={form} name="submitterRole" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Stakeholder</span>
            <Controller
              control={form.control}
              name="stakeholderType"
              render={({ field }) => (
                <CustomSelect
                  value={field.value}
                  onChange={(v) => field.onChange(v as HandoverStakeholderType)}
                  options={Object.entries(HANDOVER_STAKEHOLDER_LABELS).map(([value, label]) => ({ value, label }))}
                />
              )}
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">{decision === "REJECTED" ? "Why the works were not accepted" : "Comments (optional)"}</span>
          <textarea
            rows={4}
            className={`${inputClass} ${invalidClass(form, "feedbackText")}`}
            maxLength={HANDOVER_LIMITS.feedbackMaxLength}
            {...form.register("feedbackText")}
            {...fieldA11y(form, "feedbackText")}
          />
          <FieldError form={form} name="feedbackText" />
        </label>

        {withSnags && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-700">
                Punch list items{decision === "REJECTED" ? " (optional)" : ""}
              </p>
              {snags.fields.length < HANDOVER_LIMITS.maxSnags && (
                <button
                  type="button"
                  onClick={() => snags.append(emptySnag())}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add punch list item
                </button>
              )}
            </div>
            {snags.fields.length === 0 && <p className="text-slate-500">No punch list items listed.</p>}
            {snags.fields.map((s, i) => (
              <div key={s.id} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">Punch list item {i + 1}</span>
                  <input
                    className={`${inputClass} ${invalidClass(form, `snags.${i}.title`)}`}
                    maxLength={160}
                    placeholder="Short title"
                    {...form.register(`snags.${i}.title` as const)}
                    {...fieldA11y(form, `snags.${i}.title`)}
                  />
                  <FieldError form={form} name={`snags.${i}.title`} />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">Location (optional)</span>
                  <input className={inputClass} maxLength={200} {...form.register(`snags.${i}.location` as const)} />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-slate-700">Description (optional)</span>
                  <textarea rows={2} className={inputClass} maxLength={2000} {...form.register(`snags.${i}.description` as const)} />
                </label>
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => snags.remove(i)}
                    className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
            ))}
            {snagsMessage && (form.formState.isSubmitted || form.formState.dirtyFields.snags) && (
              <p className="text-[11px] font-medium text-rose-700">{snagsMessage}</p>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <input type="checkbox" className="mt-0.5" {...form.register("attest")} {...fieldA11y(form, "attest")} />
          <span className="font-semibold text-slate-800">I confirm this matches the signed copy.</span>
        </label>
        <FieldError form={form} name="attest" />

        <ModalActions
          onCancel={onClose}
          submitLabel="Record response"
          pendingLabel="Recording…"
          isPending={mutation.isPending}
          disabled={!canSubmit(form, { pending: mutation.isPending })}
        />
      </form>
    </ModalShell>
  );
}

function SubmissionCard({
  project,
  submission: s,
  canReview,
  canConvert,
}: {
  project: ProjectSummaryDto;
  submission: HandoverSubmissionDto;
  canReview: boolean;
  canConvert: boolean;
}) {
  const review = useReviewHandoverSubmissionMutation(project.id);
  const reviewForm = useZodForm(ReviewHandoverSubmissionRequestSchema, { defaultValues: { notes: "" } });
  const [convertOpen, setConvertOpen] = useState(false);
  const openSnags = s.snags.filter((x) => !x.defectTicketId).length;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">
            {s.submitterName} <span className="font-normal text-slate-500">· {s.submitterRole}</span>
          </p>
          <p className="text-[11px] text-slate-500">
            {HANDOVER_STAKEHOLDER_LABELS[s.stakeholderType]} · {fmtDate(s.submittedAt)}
            {s.recordedByName ? ` · recorded by ${s.recordedByName}` : ""}
          </p>
        </div>
        <TableBadge variant={DECISION_BADGE[s.decision]}>{HANDOVER_DECISION_LABELS[s.decision]}</TableBadge>
      </header>

      <RichTextView text={s.feedbackText} />

      {s.snags.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Punch list items ({s.snags.length})</p>
          <ul className="space-y-2">
            {s.snags.map((snag) => (
              <li key={snag.index} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900">
                    {snag.title}
                    {snag.location && <span className="font-normal text-slate-500"> · {snag.location}</span>}
                  </p>
                  {snag.defectTicketId && <TableBadge variant="info">Defect raised</TableBadge>}
                </div>
                {snag.description && <p className="mt-1 text-xs text-slate-600">{snag.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        {s.reviewedAt ? (
          <p className="text-[11px] text-slate-500">
            Reviewed by {s.reviewedByName ?? "—"} on {fmtDate(s.reviewedAt)}
            {s.reviewNotes ? `: ${s.reviewNotes}` : ""}
          </p>
        ) : !canReview ? (
          <p className="text-[11px] text-slate-500">Waiting for review.</p>
        ) : (
          <form
            noValidate
            className="contents"
            onSubmit={reviewForm.handleSubmit((v) => review.mutate({ submissionId: s.id, notes: v.notes ?? "" }))}
          >
            <span className="w-full max-w-sm">
              <input
                placeholder="Review notes (optional)"
                aria-label="Review notes (optional)"
                className={`${inputClass} ${invalidClass(reviewForm, "notes")}`}
                maxLength={2000}
                {...reviewForm.register("notes")}
                {...fieldA11y(reviewForm, "notes")}
              />
              <FieldError form={reviewForm} name="notes" />
            </span>
            <button
              type="submit"
              disabled={!canSubmit(reviewForm, { pending: review.isPending })}
              className="rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Mark reviewed
            </button>
          </form>
        )}
        {canConvert && openSnags > 0 && (
          <button
            type="button"
            onClick={() => setConvertOpen(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ListChecks className="h-4 w-4" /> Create defects from {openSnags} punch list item(s)
          </button>
        )}
      </footer>
      {convertOpen && <ConvertSnagsModal project={project} submission={s} onClose={() => setConvertOpen(false)} />}
    </article>
  );
}

/** ConvertSnagsRequestSchema with the date input's empty value allowed. */
const ConvertSnagsFormSchema = z.object({
  severity: DefectSeverityEnum,
  dueDate: z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a valid date or leave it empty"),
});

function ConvertSnagsModal({ project, submission, onClose }: { project: ProjectSummaryDto; submission: HandoverSubmissionDto; onClose: () => void }) {
  const mutation = useConvertSnagsMutation(project.id);
  const contractor = project.contractors[0];
  const form = useZodForm(ConvertSnagsFormSchema, { defaultValues: { severity: "MEDIUM", dueDate: "" } });

  const submit = form.handleSubmit(async ({ severity, dueDate }) => {
    try {
      await mutation.mutateAsync({
        submissionId: submission.id,
        body: { severity, dueDate: dueDate || null },
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  });

  return (
    <ModalShell title="Create defects" subtitle={`${submission.snags.filter((s) => !s.defectTicketId).length} punch list item(s) without a defect`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3 p-5 text-xs">
        <p className="text-slate-600">
          {contractor ? <>Defects are raised against {contractor.organizationName}.</> : "The project has no contractor to raise defects against."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Severity</span>
            <Controller
              control={form.control}
              name="severity"
              render={({ field }) => (
                <CustomSelect
                  value={field.value}
                  onChange={(v) => field.onChange(v as DefectSeverity)}
                  options={["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
                />
              )}
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Due date (optional)</span>
            <input type="date" className={`${inputClass} ${invalidClass(form, "dueDate")}`} {...form.register("dueDate")} {...fieldA11y(form, "dueDate")} />
            <FieldError form={form} name="dueDate" />
          </label>
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Create defects"
          pendingLabel="Creating…"
          isPending={mutation.isPending}
          disabled={!contractor || !canSubmit(form, { pending: mutation.isPending })}
        />
      </form>
    </ModalShell>
  );
}
