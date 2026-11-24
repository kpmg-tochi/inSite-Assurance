import React, { useState } from "react";
import { ClipboardPen, ListChecks, Plus, Trash2 } from "lucide-react";
import {
  HANDOVER_DECISION_LABELS,
  HANDOVER_LIMITS,
  HANDOVER_STAKEHOLDER_LABELS,
  HandoverDecisionEnum,
  RecordHandoverResponseRequestSchema,
  type HandoverDecision,
  type HandoverStakeholderType,
  type ProjectBeneficiaryDto,
  type HandoverSubmissionDto,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
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
          Record whether the beneficiary accepted the works, accepted them with snags, or rejected them.
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
          Responses can be recorded only while the project is in handover. Start the handover from the stage bar on the project Overview.
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
            <SubmissionCard key={s.id} project={project} submission={s} canReview={canReview} canConvert={hasPermission("retention:manage_defects")} />
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

interface SnagRow {
  key: number;
  title: string;
  location: string;
  description: string;
}

let snagSeq = 0;
const emptySnag = (): SnagRow => ({ key: ++snagSeq, title: "", location: "", description: "" });

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
  const [stakeholderType, setStakeholderType] = useState<HandoverStakeholderType>(stakeholderTypeFor(primaryBeneficiary));
  const [decision, setDecision] = useState<HandoverDecision>("ACCEPTED");
  const [submitterName, setSubmitterName] = useState(primaryBeneficiary?.contactName || primaryBeneficiary?.name || "");
  const [submitterRole, setSubmitterRole] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [snags, setSnags] = useState<SnagRow[]>([]);
  const [attest, setAttest] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const withSnags = decision !== "ACCEPTED";
  const setSnag = (key: number, patch: Partial<SnagRow>) => setSnags((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const chooseDecision = (d: HandoverDecision) => {
    setDecision(d);
    if (d === "ACCEPTED_WITH_SNAGS" && snags.length === 0) setSnags([emptySnag()]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = RecordHandoverResponseRequestSchema.safeParse({
      stakeholderType,
      decision,
      submitterName,
      submitterRole,
      feedbackText,
      snags: withSnags
        ? snags
            .filter((s) => s.title.trim() || s.location.trim() || s.description.trim())
            .map((s) => ({
              title: s.title,
              location: s.location.trim() || undefined,
              description: s.description.trim() || undefined,
            }))
        : [],
      attest,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      await mutation.mutateAsync(parsed.data);
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

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
            <input value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} className={inputClass} maxLength={120} />
            <FieldMessage message={errors.submitterName} />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Their role</span>
            <input value={submitterRole} onChange={(e) => setSubmitterRole(e.target.value)} className={inputClass} maxLength={120} placeholder="e.g. Head teacher" />
            <FieldMessage message={errors.submitterRole} />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Stakeholder</span>
            <CustomSelect
              value={stakeholderType}
              onChange={(v) => setStakeholderType(v as HandoverStakeholderType)}
              options={Object.entries(HANDOVER_STAKEHOLDER_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">{decision === "REJECTED" ? "Why the works were not accepted" : "Comments (optional)"}</span>
          <textarea
            rows={4}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            className={inputClass}
            maxLength={HANDOVER_LIMITS.feedbackMaxLength}
          />
          <FieldMessage message={errors.feedbackText} />
        </label>

        {withSnags && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-700">
                Snags{decision === "REJECTED" ? " (optional)" : ""}
              </p>
              {snags.length < HANDOVER_LIMITS.maxSnags && (
                <button
                  type="button"
                  onClick={() => setSnags((list) => [...list, emptySnag()])}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add snag
                </button>
              )}
            </div>
            {snags.length === 0 && <p className="text-slate-500">No snags listed.</p>}
            {snags.map((s, i) => (
              <div key={s.key} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">Snag {i + 1}</span>
                  <input value={s.title} onChange={(e) => setSnag(s.key, { title: e.target.value })} className={inputClass} maxLength={160} placeholder="Short title" />
                  <FieldMessage message={errors[`snags.${i}.title`]} />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">Location (optional)</span>
                  <input value={s.location} onChange={(e) => setSnag(s.key, { location: e.target.value })} className={inputClass} maxLength={200} />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-slate-700">Description (optional)</span>
                  <textarea rows={2} value={s.description} onChange={(e) => setSnag(s.key, { description: e.target.value })} className={inputClass} maxLength={2000} />
                </label>
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSnags((list) => list.filter((x) => x.key !== s.key))}
                    className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
            ))}
            <FieldMessage message={errors.snags} />
          </div>
        )}

        <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5" />
          <span className="font-semibold text-slate-800">I confirm this matches the signed copy.</span>
        </label>
        <FieldMessage message={errors.attest} />

        <ModalActions onCancel={onClose} submitLabel="Record response" pendingLabel="Recording…" isPending={mutation.isPending} disabled={!attest} />
      </form>
    </ModalShell>
  );
}

function FieldMessage({ message }: { message?: string }) {
  return message ? <span className="block text-[11px] font-medium text-red-600">{message}</span> : null;
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
  const [notes, setNotes] = useState("");
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
          <p className="text-xs font-semibold text-slate-700">Snags ({s.snags.length})</p>
          <ul className="space-y-2">
            {s.snags.map((snag) => (
              <li key={snag.index} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900">
                    {snag.title}
                    {snag.location && <span className="font-normal text-slate-500"> · {snag.location}</span>}
                  </p>
                  {snag.defectTicketId && <TableBadge variant="info">Defect ticket raised</TableBadge>}
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
          <>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Review notes (optional)"
              className={`${inputClass} max-w-sm`}
              maxLength={2000}
            />
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate({ submissionId: s.id, notes })}
              className="rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              Mark reviewed
            </button>
          </>
        )}
        {canConvert && openSnags > 0 && (
          <button
            type="button"
            onClick={() => setConvertOpen(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ListChecks className="h-4 w-4" /> Create defect tickets from {openSnags} snag(s)
          </button>
        )}
      </footer>
      {convertOpen && <ConvertSnagsModal project={project} submission={s} onClose={() => setConvertOpen(false)} />}
    </article>
  );
}

function ConvertSnagsModal({ project, submission, onClose }: { project: ProjectSummaryDto; submission: HandoverSubmissionDto; onClose: () => void }) {
  const mutation = useConvertSnagsMutation(project.id);
  const contractor = project.contractors[0];
  const [severity, setSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [dueDate, setDueDate] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({
        submissionId: submission.id,
        body: { severity, dueDate: dueDate || null },
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title="Create defect tickets" subtitle={`${submission.snags.filter((s) => !s.defectTicketId).length} snag(s) without a ticket`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        <p className="text-slate-600">
          {contractor ? <>Tickets are raised against {contractor.organizationName}.</> : "The project has no contractor to raise tickets against."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Severity</span>
            <CustomSelect
              value={severity}
              onChange={(v) => setSeverity(v as typeof severity)}
              options={["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Due date (optional)</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </label>
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Create tickets"
          pendingLabel="Creating…"
          isPending={mutation.isPending}
          disabled={!contractor}
        />
      </form>
    </ModalShell>
  );
}
