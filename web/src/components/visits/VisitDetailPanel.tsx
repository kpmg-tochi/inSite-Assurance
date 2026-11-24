import React, { useState } from "react";
import { CheckCircle2, MapPin, X } from "lucide-react";
import {
  VISIT_OVERALL_FINDING_LABELS,
  VISIT_SUBMISSION_STATUS_LABELS,
  type VisitDetailDto,
  type VisitFormSnapshot,
  type VisitSubmissionDto,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import Loader from "../Loader";
import { CaptureAudio, CapturePhoto } from "../evidence/CaptureMedia";
import { FormSnapshotView } from "../forms/FormSnapshotView";
import { useVisitDetailQuery } from "../../queries/visits/useVisitQueries";
import {
  useAddVisitCommentMutation,
  useDecideProposalMutation,
  usePublishVisitsMutation,
  useRaiseVisitFindingMutation,
  useRebuildVisitFormMutation,
  useReviewVisitSubmissionMutation,
} from "../../mutations/visits/useVisitMutations";
import { CancelVisitDialog, EditVisitDialog } from "./VisitDialogs";
import { ConfirmationText, officersText, primaryButton, secondaryButton, visitKindLabel, VisitStatusChip } from "./visitUi";

/**
 * Redesign R4: one visit (project Visits page drawer): plan, date history, submissions with answers
 * and photos by section and unit, review on the report approval chain, comments and the frozen form.
 */

const FINDING_TONE: Record<string, string> = {
  SATISFACTORY: "bg-emerald-50 text-emerald-700",
  MINOR_ISSUES: "bg-amber-50 text-amber-800",
  MAJOR_ISSUES: "bg-red-50 text-red-700",
};

function answerText(value: VisitSubmissionDto["answers"][number]["value"], options: Array<{ key: string; label: string }>): string {
  const label = (k: string) => options.find((o) => o.key === k)?.label ?? k;
  if (value === null) return "";
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (value === "YES") return "Yes";
  if (value === "NO") return "No";
  if (value === "NA") return "N/A";
  return typeof value === "string" ? label(value) : String(value);
}

export function VisitDetailPanel({ projectId, visitId, onClose }: { projectId: string; visitId: string; onClose: () => void }) {
  const q = useVisitDetailQuery(projectId, visitId);
  const { hasPermission } = useAuth();
  const canPlan = hasPermission("visits:plan");
  const publish = usePublishVisitsMutation(projectId);
  const rebuild = useRebuildVisitFormMutation(projectId);
  const decide = useDecideProposalMutation(projectId);
  const [dialog, setDialog] = useState<"edit" | "cancel" | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [showForm, setShowForm] = useState(false);
  if (q.isLoading) return <Loader />;
  if (!q.data) return null;
  const d: VisitDetailDto = q.data;
  const v = d.visit;
  const pending = d.dateChanges.find((c) => c.status === "PENDING");
  const notStarted = (v.status === "PROPOSED" || v.status === "PLANNED") && !v.checkInAt;

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            {visitKindLabel(v.visitKind)} · {v.plannedDate} <VisitStatusChip status={v.status} /> <ConfirmationText visit={v} />
          </h2>
          <p className="text-[11px] text-slate-500">
            {officersText(v)}
            {v.sprint ? ` · ${v.sprint.name}` : ""}
            {v.originalPlannedDate !== v.plannedDate ? ` · originally ${v.originalPlannedDate}` : ""}
            {v.submissionDeadline ? ` · submit by ${v.submissionDeadline}` : ""}
            {v.origin === "UNSCHEDULED" ? " · unscheduled" : ""}
            {v.rescheduleCount ? ` · moved by the officer ${v.rescheduleCount} time(s)` : ""}
          </p>
          {v.checkInAt && (
            <p className="text-[11px] text-slate-600 inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Checked in {new Date(v.checkInAt).toLocaleString()}
              {v.checkInGeofenceStatus ? ` · ${v.checkInGeofenceStatus.toLowerCase().replace("_", " ")}` : " · no location"}
              {v.checkInGeofenceStatus === "OUTSIDE" && <span className="font-semibold text-red-700"> (outside the site boundary)</span>}
            </p>
          )}
          {v.cancelledReason && <p className="text-[11px] text-slate-600">Cancelled: {v.cancelledReason}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {canPlan && notStarted && (
        <div className="flex flex-wrap gap-2">
          {v.status === "PROPOSED" && (
            <button type="button" className={primaryButton} disabled={publish.isPending || v.assignees.length === 0} onClick={() => publish.mutate([v.id])}>
              Publish
            </button>
          )}
          <button type="button" className={secondaryButton} onClick={() => setDialog("edit")}>
            Move or reassign
          </button>
          {v.status === "PLANNED" && (
            <button type="button" className={secondaryButton} disabled={rebuild.isPending} onClick={() => rebuild.mutate(v.id)}>
              Rebuild form
            </button>
          )}
          <button type="button" className={secondaryButton} onClick={() => setDialog("cancel")}>
            Cancel visit
          </button>
        </div>
      )}
      {canPlan && !notStarted && ["IN_PROGRESS", "RETURNED", "MISSED"].includes(v.status) && (
        <button type="button" className={secondaryButton} onClick={() => setDialog("cancel")}>
          Cancel visit
        </button>
      )}

      {pending && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs space-y-2">
          <p className="text-sky-900">
            <span className="font-semibold">{pending.byName}</span> proposes {pending.toDate} (now {pending.fromDate}): {pending.comment}
          </p>
          {canPlan && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryButton}
                disabled={decide.isPending}
                onClick={() => decide.mutate({ visitId: v.id, changeId: pending.id, body: { decision: "ACCEPT" } })}
              >
                Accept {pending.toDate}
              </button>
              <input
                className="flex-1 min-w-[10rem] rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Why the date stays"
                aria-label="Reject note"
              />
              <button
                type="button"
                className={secondaryButton}
                disabled={decide.isPending || rejectNote.trim().length < 3}
                onClick={() => decide.mutate({ visitId: v.id, changeId: pending.id, body: { decision: "REJECT", note: rejectNote.trim() } })}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {d.dateChanges.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Date history</h3>
          <ul className="text-[11px] text-slate-600 space-y-0.5">
            {d.dateChanges.map((c) => (
              <li key={c.id}>
                {new Date(c.createdAt).toLocaleDateString()} · {c.kind === "MANAGER_MOVE" ? "Manager moved" : c.kind === "OFFICER_MOVE" ? "Officer moved" : "Officer proposed"} {c.fromDate} → {c.toDate}
                {` (${c.byName}${c.comment ? `: ${c.comment}` : ""})`} · {c.status.toLowerCase()}
                {c.decisionNote ? ` · ${c.decisionNote}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.submissions.map((s) => (
        <SubmissionCard key={s.id} projectId={projectId} visitId={v.id} submission={s} snapshot={d.snapshot} />
      ))}

      <Comments projectId={projectId} visitId={v.id} comments={d.comments} />

      {d.snapshot && (
        <div className="space-y-2">
          <button type="button" className="text-xs font-semibold text-brand-primary hover:underline" onClick={() => setShowForm((x) => !x)}>
            {showForm ? "Hide the frozen form" : "Show the frozen form"}
          </button>
          {showForm && <FormSnapshotView snapshot={d.snapshot} />}
        </div>
      )}

      {dialog === "edit" && <EditVisitDialog projectId={projectId} visit={v} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && <CancelVisitDialog projectId={projectId} visit={v} onClose={() => setDialog(null)} />}
    </section>
  );
}

function SubmissionCard({ projectId, visitId, submission: s, snapshot }: { projectId: string; visitId: string; submission: VisitSubmissionDto; snapshot: VisitFormSnapshot | null }) {
  const review = useReviewVisitSubmissionMutation(projectId);
  const raise = useRaiseVisitFindingMutation(projectId);
  const { hasPermission } = useAuth();
  const canRaise = hasPermission("inspections:manage_findings") && s.status !== "RETURNED";
  const [returnNotes, setReturnNotes] = useState("");
  const answers = new Map(s.answers.map((a) => [a.path, a]));
  const gaps = new Set(s.photoGaps.map((g) => g.path));
  const blocks = snapshot?.blocks ?? [];
  const known = new Set(blocks.flatMap((b) => b.fields.map((f) => f.path)));
  const orphans = s.answers.filter((a) => !known.has(a.path));

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-900">
          Submission {s.revisionNumber} · {VISIT_SUBMISSION_STATUS_LABELS[s.status]}
        </p>
        <p className="text-[11px] text-slate-500">
          {s.reporterName} ({s.reporterRoleName}) · {new Date(s.confirmedAt).toLocaleString()}
          {s.isLate ? " · late" : ""}
          {s.geofenceStatus ? ` · location ${s.geofenceStatus.toLowerCase().replace("_", " ")}` : ""}
        </p>
      </div>
      <div className={`rounded-xl px-3 py-2 text-xs ${FINDING_TONE[s.overallFinding]}`}>
        <span className="font-semibold">{VISIT_OVERALL_FINDING_LABELS[s.overallFinding]}.</span> {s.summaryText}
      </div>
      {s.returnedNotes && s.status === "RETURNED" && <p className="text-xs text-red-700">Returned: {s.returnedNotes}</p>}
      {s.photoGaps.length > 0 && <p className="text-[11px] font-semibold text-amber-700">{s.photoGaps.length} photo(s) missing or flagged.</p>}

      {blocks.map((b) => {
        const fields = b.fields.filter((f) => answers.has(f.path) || f.required);
        if (fields.length === 0) return null;
        return (
          <div key={b.key} className="space-y-1.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{b.title}</h4>
            {fields.map((f) => {
              const a = answers.get(f.path);
              const unit = f.unitId ? b.units.find((u) => u.id === f.unitId)?.label : null;
              const isFinding = s.findingIds.length > 0 && false;
              void isFinding;
              return (
                <div key={f.path} className={`rounded-lg border px-3 py-2 ${gaps.has(f.path) ? "border-amber-200 bg-amber-50/40" : "border-slate-100"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-slate-800">
                      {f.label}
                      {unit ? <span className="text-slate-500"> · {unit}</span> : null}
                    </p>
                    <p className="text-xs font-bold text-slate-900">{a ? answerText(a.value, f.options) : "—"}</p>
                  </div>
                  {a?.comment && <p className="mt-1 text-[11px] text-slate-600">{a.comment}</p>}
                  {a && a.captures.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.captures.map((c) =>
                        c.objectKey ? (
                          c.mediaType === "VOICE_NOTE" ? (
                            <CaptureAudio key={c.id} projectId={projectId} objectKey={c.objectKey} />
                          ) : (
                            <div key={c.id} className="text-center">
                              <CapturePhoto projectId={projectId} objectKey={c.objectKey} alt={f.label} className="w-20 h-20" />
                              {c.unitId && <p className="text-[10px] text-slate-500">{b.units.find((u) => u.id === c.unitId)?.label ?? ""}</p>}
                              {c.isWithinGeofence === false && <p className="text-[10px] font-semibold text-red-700">outside site</p>}
                            </div>
                          )
                        ) : null
                      )}
                    </div>
                  )}
                  {a && canRaise && !f.recheck && f.type !== "PHOTO" && f.type !== "VOICE_NOTE" && (
                    <button
                      type="button"
                      disabled={raise.isPending}
                      onClick={() =>
                        raise.mutate({
                          visitId,
                          body: { submissionId: s.id, path: f.path, description: a.comment || `${f.label}: ${answerText(a.value, f.options)}`, severity: "MAJOR" },
                        })
                      }
                      className="mt-1 text-[11px] font-semibold text-brand-primary hover:underline"
                    >
                      Raise a finding
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {orphans.length > 0 && (
        <p className="text-[11px] text-slate-500">{orphans.length} answer(s) to an earlier version of the form (re-checks since closed).</p>
      )}
      {s.siteLog.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Site log attached</h4>
          <div className="flex flex-wrap gap-2">
            {s.siteLog.map((e) =>
              e.capture?.objectKey ? (
                e.kind === "VOICE" ? (
                  <CaptureAudio key={e.id} projectId={projectId} objectKey={e.capture.objectKey} />
                ) : (
                  <CapturePhoto key={e.id} projectId={projectId} objectKey={e.capture.objectKey} alt="Site log" className="w-16 h-16" />
                )
              ) : (
                <p key={e.id} className="text-[11px] text-slate-700 rounded-lg bg-slate-50 px-2 py-1">
                  {e.text}
                </p>
              )
            )}
          </div>
        </div>
      )}

      {s.approval && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <h4 className="text-xs font-bold text-slate-900">Approval</h4>
          <ol className="text-[11px] text-slate-600 space-y-0.5">
            {s.approval.steps.map((st) => (
              <li key={st.id}>
                {st.stepOrder}. {st.label} · {st.state.toLowerCase()}
              </li>
            ))}
          </ol>
          {s.approval.canAct ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate({ visitId, submissionId: s.id, body: { decision: "APPROVE" } })}
                className={`${primaryButton} inline-flex items-center gap-1`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </button>
              <input
                className="flex-1 min-w-[12rem] rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="What the officer must change"
                aria-label="Return notes"
              />
              <button
                type="button"
                disabled={review.isPending || returnNotes.trim().length < 5}
                onClick={() => review.mutate({ visitId, submissionId: s.id, body: { decision: "RETURN", notes: returnNotes.trim() } })}
                className={secondaryButton}
              >
                Return
              </button>
            </div>
          ) : (
            s.approval.cannotActReason && s.status === "PENDING_APPROVAL" && <p className="text-[11px] text-slate-500">{s.approval.cannotActReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Comments({ projectId, visitId, comments }: { projectId: string; visitId: string; comments: VisitDetailDto["comments"] }) {
  const add = useAddVisitCommentMutation(projectId);
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Comments</h3>
      {comments.length === 0 && <p className="text-[11px] text-slate-400">No comments yet.</p>}
      <ul className="space-y-1">
        {comments.map((c) => (
          <li key={c.id} className="text-[11px] text-slate-700">
            <span className="font-semibold">{c.authorName}</span> · {new Date(c.createdAt).toLocaleString()}: {c.text}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ visitId, text: text.trim() }, { onSuccess: () => setText("") });
        }}
      >
        <input className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" aria-label="Comment" />
        <button type="submit" className={secondaryButton} disabled={add.isPending || text.trim().length === 0}>
          Add
        </button>
      </form>
    </div>
  );
}
