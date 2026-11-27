import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { CheckCircle2, Circle, CircleDot, Clock, FileText, FileUp, MessageSquare, Undo2, XCircle } from "lucide-react";
import {
  BEAP_REVIEW_OUTCOME_LABELS,
  CYCLE_DOCUMENT_KIND_META,
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  RegisterCycleDocumentRequestSchema,
  formatProjectCode,
  type BeapReviewOutcome,
  type CycleDocumentKind,
  type NeedsCycleDocumentDto,
  type NeedsSubmissionDto,
  type NeedsSubmissionStatus,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { formatDateShort, formatDateTimeShort } from "../../../lib/formatters";
import { getCycleDocumentLink, mimeTypeOf } from "../../../api/needsPipeline";
import type { FundingDocumentArea } from "../../../api/needsFunding";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import { useAddFundingDocumentMutation } from "../../../mutations/needs/useFundingMutations";
import { DOCUMENT_FILE_ACCEPT, formatBytes, inputCls, labelCls } from "../needsUi";

/**
 * Needs pipeline wave 4 (C2, C3): small pieces shared by the Funding, BEAP and Procurement plan tabs.
 * Status is always an icon plus a label.
 */

export const proposalHref = (proposalId: string) => `/app/needs-assessment/proposals/${proposalId}`;

/** Converted projects are drafts: their page is the setup (App redirects a draft's other pages there too). */
export const projectHref = (projectId: string, status?: string | null) =>
  status && status !== "DRAFT" ? `/app/projects/${projectId}/dashboard` : `/app/projects/${projectId}/setup`;

export function ProjectCodeLink({ projectId, code, status }: { projectId: string; code: string | null; status?: string | null }) {
  return (
    <Link to={projectHref(projectId, status)} className="font-mono text-xs font-semibold text-brand-primary hover:underline">
      {formatProjectCode(code) || "Open project"}
    </Link>
  );
}

export function ProposalLink({ proposalId, reference }: { proposalId: string; reference: string }) {
  return (
    <Link to={proposalHref(proposalId)} className="whitespace-nowrap font-semibold text-brand-primary hover:underline">
      {reference}
    </Link>
  );
}

export const dateOrDash = (iso: string | null | undefined) => (iso ? formatDateShort(iso) : "–");

/** Messages in an error's details (an array of strings or `{ message }`, or one under `missing`, `items`, `issues`). */
export function detailMessages(details: unknown): string[] {
  const read = (list: unknown[]): string[] =>
    list
      .map((x) => (typeof x === "string" ? x : x && typeof x === "object" && "message" in x ? String((x as { message: unknown }).message) : null))
      .filter((x): x is string => Boolean(x));
  if (Array.isArray(details)) return read(details);
  if (details && typeof details === "object") {
    for (const key of ["missing", "items", "issues", "problems"]) {
      const list = (details as Record<string, unknown>)[key];
      if (Array.isArray(list)) return read(list);
    }
  }
  return [];
}

export function ProblemList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <XCircle className="h-4 w-4" aria-hidden="true" /> {title}
      </p>
      <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-[11px]">
        {items.map((m, i) => (
          <li key={`${i}-${m}`}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  const cls = tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-xl border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Submissions: status, steps, history
// ---------------------------------------------------------------------------

const SUBMISSION_STATUS_META: Record<NeedsSubmissionStatus, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  DRAFT: { icon: FileText, cls: "border-slate-200 bg-slate-50 text-slate-700" },
  IN_REVIEW: { icon: Clock, cls: "border-brand-primary/25 bg-brand-primary/5 text-brand-primary" },
  RETURNED: { icon: Undo2, cls: "border-amber-200 bg-amber-50 text-amber-800" },
  APPROVED: { icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

export function SubmissionStatusTag({ status, label }: { status: NeedsSubmissionStatus; label: string }) {
  const meta = SUBMISSION_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

const STEP_META = {
  DONE: { icon: CheckCircle2, cls: "text-emerald-700", label: "Done" },
  CURRENT: { icon: CircleDot, cls: "text-brand-primary", label: "Current step" },
  PENDING: { icon: Circle, cls: "text-slate-400", label: "To come" },
} as const;

/** The chain's steps in order (state as icon and words). */
export function ApprovalSteps({ submission }: { submission: NeedsSubmissionDto }) {
  if (submission.steps.length === 0) return null;
  const steps = [...submission.steps].sort((a, b) => a.stepOrder - b.stepOrder);
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Approval steps">
      {steps.map((s) => {
        const meta = STEP_META[s.state];
        const Icon = meta.icon;
        return (
          <li key={s.id} className={`inline-flex items-center gap-1 text-xs ${s.state === "CURRENT" ? "font-semibold text-slate-900" : "text-slate-700"}`}>
            <Icon className={`h-3.5 w-3.5 ${meta.cls}`} aria-hidden="true" />
            <span>
              {s.stepOrder}. {s.label}
            </span>
            <span className="sr-only">({meta.label})</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Is the current step the chain's last (approving it runs the gate)? */
export function onLastStep(submission: NeedsSubmissionDto): boolean {
  const current = submission.steps.find((s) => s.state === "CURRENT");
  return Boolean(current && !submission.steps.some((s) => s.state === "PENDING" && s.stepOrder > current.stepOrder));
}

const DECISION_LABEL = { APPROVE: "Approved", RETURN: "Returned", REJECT: "Rejected" } as const;

export function ActionHistory({ submission }: { submission: NeedsSubmissionDto }) {
  const actions = [...submission.actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section aria-labelledby={`history-${submission.id}`} className="space-y-1">
      <h4 id={`history-${submission.id}`} className="text-xs font-bold text-slate-900">
        History
      </h4>
      {actions.length === 0 && !submission.submittedAt ? (
        <p className="text-xs text-slate-500">Not submitted yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-xs">
          {actions.map((a, i) => (
            <li key={`${a.createdAt}-${i}`} className="py-1.5">
              <p className="text-slate-800">
                <span className="font-semibold">{DECISION_LABEL[a.decision]}</span> at {a.stepLabel} by {a.actorName}
                <span className="text-slate-500"> · {formatDateTimeShort(a.createdAt)}</span>
              </p>
              {a.notes && <p className="mt-0.5 whitespace-pre-line text-slate-600">{a.notes}</p>}
            </li>
          ))}
          {submission.submittedAt && (
            <li className="py-1.5 text-slate-800">
              <span className="font-semibold">Submitted</span>
              {submission.submittedByName ? ` by ${submission.submittedByName}` : ""}
              <span className="text-slate-500"> · {formatDateTimeShort(submission.submittedAt)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** An "Open" link for a cycle document (the file opens in a new tab). */
export function OpenDocumentButton({ cycleId, documentId, label = "Open", className }: { cycleId: string; documentId: string; label?: string; className?: string }) {
  const openFile = useOpenNeedsFileMutation();
  return (
    <button
      type="button"
      className={className ?? "text-xs font-semibold text-brand-primary hover:underline disabled:opacity-50"}
      disabled={openFile.isPending}
      onClick={() => openFile.mutate(() => getCycleDocumentLink(cycleId, documentId))}
    >
      {label}
    </button>
  );
}

/** A cycle document by id, with its title and an Open link ("–" when none). */
export function DocumentRef({ cycleId, documentId, documents }: { cycleId: string; documentId: string | null; documents: NeedsCycleDocumentDto[] }) {
  if (!documentId) return <span className="text-slate-400">–</span>;
  const doc = documents.find((d) => d.id === documentId);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="text-slate-800" title={doc?.fileName}>
        {doc?.title ?? "Document"}
      </span>
      <OpenDocumentButton cycleId={cycleId} documentId={documentId} />
    </span>
  );
}

export function documentFileProblem(file: File): string | null {
  if (file.size > NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes) return `The file is larger than ${Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.`;
  if (!NEEDS_DOCUMENT_UPLOAD_POLICY.mimeTypes.includes(mimeTypeOf(file))) return "Choose a PDF, photo, Word, Excel or text file.";
  return null;
}

/** A file chooser for one document (checked against the needs document policy). */
export function DocumentFileField({
  id,
  label,
  required = false,
  file,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  required?: boolean;
  file: File | null;
  onChange: (file: File | null) => void;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div>
      <p className={labelCls} id={`${id}-label`}>
        {label} {required && <span className="text-rose-600">*</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-describedby={`${id}-label`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => ref.current?.click()}
        >
          <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {file ? "Choose another file" : "Choose file"}
        </button>
        {file && (
          <span className="text-xs text-slate-700">
            {file.name} <span className="text-slate-500">· {formatBytes(file.size)}</span>
          </span>
        )}
        {file && !required && (
          <button type="button" className="text-xs font-semibold text-slate-600 hover:underline" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={ref}
        id={id}
        type="file"
        accept={DOCUMENT_FILE_ACCEPT}
        className="hidden"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!f) return;
          const p = documentFileProblem(f);
          setProblem(p);
          onChange(p ? null : f);
        }}
      />
      {problem && <p className="mt-1 text-xs font-medium text-rose-700">{problem}</p>}
      <p className="mt-1 text-[11px] text-slate-500">
        {hint ?? `PDF, photo, Word, Excel or text, up to ${Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.`}
      </p>
    </div>
  );
}

const DocumentFormSchema = z.object({ title: RegisterCycleDocumentRequestSchema.shape.title });

/** Uploads one document of a fixed kind to a funding area (title and file). */
export function FundingDocumentDialog({
  cycleId,
  area,
  kind,
  defaultTitle,
  dialogTitle,
  intro,
  onClose,
  onUploaded,
}: {
  cycleId: string;
  area: FundingDocumentArea;
  kind: CycleDocumentKind;
  defaultTitle?: string;
  /** Default: "Upload <kind>". */
  dialogTitle?: string;
  intro?: React.ReactNode;
  onClose: () => void;
  onUploaded?: (doc: NeedsCycleDocumentDto) => void;
}) {
  const add = useAddFundingDocumentMutation(cycleId, area);
  const label = CYCLE_DOCUMENT_KIND_META[kind].label;
  const form = useZodForm(DocumentFormSchema, { defaultValues: { title: defaultTitle ?? label } });
  const [file, setFile] = useState<File | null>(null);
  const submit = form.handleSubmit((v) => {
    if (!file) return;
    add.mutate(
      { file, kind, title: v.title },
      {
        onSuccess: (doc) => {
          onUploaded?.(doc);
          onClose();
        },
      }
    );
  });
  const titleId = `funding-doc-title-${kind}`;
  return (
    <ModalShell title={dialogTitle ?? `Upload ${label.charAt(0).toLowerCase()}${label.slice(1)}`} subtitle="It is also listed on Cycle documents" onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        {intro && <p className="text-xs text-slate-700">{intro}</p>}
        <div>
          <label className={labelCls} htmlFor={titleId}>
            Title <span className="text-rose-600">*</span>
          </label>
          <input id={titleId} className={`${inputCls} ${invalidClass(form, "title")}`} {...form.register("title")} {...fieldA11y(form, "title")} />
          <FieldError form={form} name="title" />
        </div>
        <DocumentFileField id={`funding-doc-file-${kind}`} label="File" required file={file} onChange={setFile} />
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={add.isPending} pendingLabel="Uploading…" blocked={!file} hint={file ? undefined : "Choose the file."}>
            Upload
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}

/** A small figure (label above, value below). */
export function Figure({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "alert" | "good" }) {
  const cls = tone === "alert" ? "text-rose-700" : tone === "good" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${cls}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BEAP items
// ---------------------------------------------------------------------------

const REVIEW_META: Record<BeapReviewOutcome, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  ACCEPTED: { icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  COMMENTED: { icon: MessageSquare, cls: "border-amber-200 bg-amber-50 text-amber-900" },
  REMOVAL_REQUESTED: { icon: XCircle, cls: "border-rose-200 bg-rose-50 text-rose-700" },
};

/** UBEC's review of one BEAP item (icon + label). */
export function ReviewOutcomeTag({ outcome }: { outcome: BeapReviewOutcome }) {
  const meta = REVIEW_META[outcome];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {BEAP_REVIEW_OUTCOME_LABELS[outcome]}
    </span>
  );
}

/** "3 Feb 2027 – 30 Jun 2027", or what is missing. */
export function plannedText(start: string | null, end: string | null): string {
  if (!start && !end) return "–";
  return `${start ? formatDateShort(start) : "start not set"} – ${end ? formatDateShort(end) : "end not set"}`;
}
