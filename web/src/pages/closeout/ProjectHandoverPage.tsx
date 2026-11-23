import React, { useState } from "react";
import { Check, ClipboardCopy, Link2, ListChecks, RotateCcw, ShieldOff } from "lucide-react";
import {
  HANDOVER_DECISION_LABELS,
  HANDOVER_LIMITS,
  HANDOVER_STAKEHOLDER_LABELS,
  type HandoverDecision,
  type HandoverLinkDto,
  type HandoverLinkIssuedDto,
  type HandoverStakeholderType,
  type ProjectBeneficiaryDto,
  type HandoverSubmissionDto,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import Loader from "../../components/Loader";
import { StandardTable, TableActionMenu, TableBadge, type TableColumnDef } from "../../components/table/StandardTable";
import { CustomSelect } from "../../components/common";
import { useConfirmDialog } from "../../components/process/ConfirmDialog";
import { ModalActions, ModalShell, inputClass } from "../../components/common/ModalShell";
import { RichTextView } from "../../components/closeout/RichTextView";
import { HandoverFileView } from "../../components/closeout/HandoverFileView";
import { CompletionSection } from "../../components/closure/CompletionSection";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useHandoverLinksQuery, useHandoverSubmissionsQuery, useProjectPhaseQuery } from "../../queries/closeout/useCloseoutQueries";
import {
  useConvertSnagsMutation,
  useCreateHandoverLinkMutation,
  useReissueHandoverLinkMutation,
  useReviewHandoverSubmissionMutation,
  useRevokeHandoverLinkMutation,
} from "../../mutations/closeout/useCloseoutMutations";

const STATUS_BADGE: Record<HandoverLinkDto["status"], { variant: "success" | "warning" | "danger" | "neutral" | "info"; label: string }> = {
  ACTIVE: { variant: "success", label: "Active" },
  EXPIRED: { variant: "neutral", label: "Expired" },
  REVOKED: { variant: "danger", label: "Revoked" },
  LOCKED: { variant: "warning", label: "Locked (wrong codes)" },
  USED_UP: { variant: "info", label: "Responded" },
};

const DECISION_BADGE: Record<HandoverDecision, "success" | "warning" | "danger"> = {
  ACCEPTED: "success",
  ACCEPTED_WITH_SNAGS: "warning",
  REJECTED: "danger",
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Project "Handover" tab (Phase 10 Step 8): stakeholder links (create, revoke, re-issue) and their
 * submissions (decision, feedback, snags, attachments), review and "create defect tickets from
 * snags".
 */
export function ProjectHandoverPage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const processQuery = useProjectProcess(project.id);
  const enabled = processQuery.data?.config.enableHandoverModule ?? false;
  const canManage = hasPermission("handover:manage_links");
  const canReview = hasPermission("handover:review_feedback");
  const phaseQuery = useProjectPhaseQuery(project.id, enabled);
  const linksQuery = useHandoverLinksQuery(project.id, enabled && (canManage || canReview));
  const submissionsQuery = useHandoverSubmissionsQuery(project.id, enabled && canReview);
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<HandoverLinkIssuedDto | null>(null);

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
        <div>
          <h1 className="text-lg font-bold text-slate-900">Handover</h1>
          <p className="text-xs text-slate-500">
            {project.codePrefix} · send stakeholders a secure link to accept the works, accept with snags, or reject them.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            disabled={!inHandover}
            title={inHandover ? undefined : "Links can be sent once the project is in handover."}
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            <Link2 className="h-4 w-4" /> New handover link
          </button>
        )}
      </div>

      {/* Phase 15: the Certificate of Completion comes before the handover ceremony. */}
      <CompletionSection projectId={project.id} />

      {!inHandover && phaseQuery.data && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Links work only while the project is in handover. Use the phase actions on the project header.
        </div>
      )}

      {issued && <IssuedLinkNotice issued={issued} onDismiss={() => setIssued(null)} />}

      {(canManage || canReview) && (
        <LinksTable project={project} links={linksQuery.data ?? []} loading={linksQuery.isLoading} canManage={canManage && inHandover} onIssued={setIssued} />
      )}

      {canReview && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Responses</h2>
          {submissionsQuery.isLoading && <Loader />}
          {submissionsQuery.data?.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">No responses yet.</div>
          )}
          {submissionsQuery.data?.map((s) => (
            <SubmissionCard key={s.id} project={project} submission={s} canConvert={hasPermission("retention:manage_defects")} />
          ))}
        </section>
      )}

      {createOpen && (
        <CreateLinkModal
          projectId={project.id}
          primaryBeneficiary={project.primaryBeneficiary ?? null}
          onClose={() => setCreateOpen(false)}
          onIssued={(i) => {
            setIssued(i);
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}

function IssuedLinkNotice({ issued, onDismiss }: { issued: HandoverLinkIssuedDto; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 space-y-2">
      <p className="font-semibold">
        Link for {issued.link.recipientName}
        {issued.delivery === "SENT" || issued.delivery === "QUEUED" ? ` emailed to ${issued.link.recipientContact}.` : "."} This is the only time it is shown.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all rounded-lg bg-white px-2 py-1 text-[11px] text-slate-700 border border-emerald-200">{issued.url}</code>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 font-semibold">
          {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={onDismiss} className="ml-auto font-semibold underline">
          Done
        </button>
      </div>
    </div>
  );
}

function LinksTable({
  project,
  links,
  loading,
  canManage,
  onIssued,
}: {
  project: ProjectSummaryDto;
  links: HandoverLinkDto[];
  loading: boolean;
  canManage: boolean;
  onIssued: (i: HandoverLinkIssuedDto) => void;
}) {
  const revoke = useRevokeHandoverLinkMutation(project.id);
  const reissue = useReissueHandoverLinkMutation(project.id);
  const { ask: confirm, dialog } = useConfirmDialog();

  const columns: TableColumnDef<HandoverLinkDto>[] = [
    {
      id: "recipient",
      header: "Recipient",
      cell: (l) => (
        <div>
          <p className="font-semibold text-slate-900">{l.recipientName}</p>
          <p className="text-[11px] text-slate-500">
            {HANDOVER_STAKEHOLDER_LABELS[l.stakeholderType]} · {l.recipientContact}
          </p>
        </div>
      ),
    },
    { id: "label", header: "Label", cell: (l) => <span className="text-slate-700">{l.label}</span> },
    {
      id: "status",
      header: "Status",
      cell: (l) => <TableBadge variant={STATUS_BADGE[l.status].variant}>{STATUS_BADGE[l.status].label}</TableBadge>,
    },
    {
      id: "responses",
      header: "Responses",
      align: "center",
      cell: (l) => `${l.submissionCount} / ${l.maxSubmissions}`,
    },
    { id: "expires", header: "Expires", cell: (l) => fmtDate(l.expiresAt) },
    { id: "opened", header: "Last opened", cell: (l) => fmtDate(l.lastAccessedAt) },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (l) =>
        canManage ? (
          <TableActionMenu
            actions={[
              {
                label: "Re-issue (new link)",
                icon: <RotateCcw className="h-3.5 w-3.5" />,
                onClick: async () => {
                  const ok = await confirm({
                    title: "Re-issue this link?",
                    message: `The current link stops working and ${l.recipientName} gets a new one by email.`,
                    confirmLabel: "Re-issue",
                  });
                  if (!ok) return;
                  try {
                    onIssued(await reissue.mutateAsync({ linkId: l.id, sendNow: true }));
                  } catch {
                    // toasted by the mutation hook
                  }
                },
              },
              {
                label: "Revoke",
                icon: <ShieldOff className="h-3.5 w-3.5" />,
                variant: "danger",
                disabled: l.status === "REVOKED",
                onClick: async () => {
                  const ok = await confirm({
                    title: "Revoke this link?",
                    message: "It stops working immediately.",
                    confirmLabel: "Revoke",
                    danger: true,
                  });
                  if (ok) revoke.mutate(l.id);
                },
              },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <>
      <StandardTable<HandoverLinkDto>
        title="Handover links"
        subtitle="Only a hash of each link is stored; a lost link is re-issued, never recovered."
        columns={columns}
        data={links}
        keyExtractor={(l) => l.id}
        loading={loading}
        emptyState={{ title: "No links yet", description: "Create a link for each stakeholder who should accept the works." }}
      />
      {dialog}
    </>
  );
}

/** Phase 11: the stakeholder type a beneficiary most likely is. */
function stakeholderTypeFor(b: ProjectBeneficiaryDto | null): HandoverStakeholderType {
  if (!b) return "COMMUNITY_REPRESENTATIVE";
  if (b.beneficiaryType === "COMMUNITY") return "COMMUNITY_REPRESENTATIVE";
  if (b.beneficiaryType === "SCHOOL" || b.beneficiaryType === "INSTITUTION") return "CLIENT_STAFF";
  return "OTHER";
}

function CreateLinkModal({
  projectId,
  primaryBeneficiary,
  onClose,
  onIssued,
}: {
  projectId: string;
  /** Phase 11: pre-fills the recipient (still editable). */
  primaryBeneficiary: ProjectBeneficiaryDto | null;
  onClose: () => void;
  onIssued: (i: HandoverLinkIssuedDto) => void;
}) {
  const mutation = useCreateHandoverLinkMutation(projectId);
  const [form, setForm] = useState({
    label: primaryBeneficiary ? `Handover to ${primaryBeneficiary.name}` : "",
    recipientName: primaryBeneficiary ? primaryBeneficiary.contactName || primaryBeneficiary.name : "",
    recipientContact: primaryBeneficiary?.contactEmail ?? "",
    stakeholderType: stakeholderTypeFor(primaryBeneficiary),
    handoverSummary: "",
    expiresInDays: HANDOVER_LIMITS.defaultExpiryDays as number,
    requiresOtp: true,
    maxSubmissions: 1 as number,
    sendNow: true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onIssued(await mutation.mutateAsync(form));
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title="New handover link" subtitle="The stakeholder needs no account" onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={submit} className="grid gap-3 p-5 text-xs sm:grid-cols-2">
        <label className="space-y-1">
          <span className="font-semibold text-slate-700">Recipient name</span>
          <input required value={form.recipientName} onChange={(e) => set("recipientName", e.target.value)} className={inputClass} maxLength={120} />
        </label>
        <label className="space-y-1">
          <span className="font-semibold text-slate-700">Email address</span>
          <input
            required
            type="email"
            value={form.recipientContact}
            onChange={(e) => set("recipientContact", e.target.value)}
            className={inputClass}
            maxLength={200}
          />
        </label>
        <label className="space-y-1">
          <span className="font-semibold text-slate-700">Stakeholder</span>
          <CustomSelect
            value={form.stakeholderType}
            onChange={(v) => set("stakeholderType", v as HandoverStakeholderType)}
            options={Object.entries(HANDOVER_STAKEHOLDER_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </label>
        <label className="space-y-1">
          <span className="font-semibold text-slate-700">Label (internal)</span>
          <input required value={form.label} onChange={(e) => set("label", e.target.value)} className={inputClass} maxLength={120} placeholder="e.g. Community handover" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="font-semibold text-slate-700">What is being handed over</span>
          <textarea
            required
            rows={4}
            minLength={10}
            value={form.handoverSummary}
            onChange={(e) => set("handoverSummary", e.target.value)}
            className={inputClass}
            maxLength={4000}
            placeholder="Plain language: what was built, where, and what you want them to check."
          />
        </label>
        <label className="space-y-1">
          <span className="font-semibold text-slate-700">Link valid for (days)</span>
          <input
            type="number"
            min={1}
            max={HANDOVER_LIMITS.maxExpiryDays}
            value={form.expiresInDays}
            onChange={(e) => set("expiresInDays", Math.max(1, Math.min(HANDOVER_LIMITS.maxExpiryDays, Number(e.target.value) || 1)))}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="font-semibold text-slate-700">Responses allowed</span>
          <input
            type="number"
            min={1}
            max={HANDOVER_LIMITS.maxSubmissions}
            value={form.maxSubmissions}
            onChange={(e) => set("maxSubmissions", Math.max(1, Math.min(HANDOVER_LIMITS.maxSubmissions, Number(e.target.value) || 1)))}
            className={inputClass}
          />
        </label>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input type="checkbox" checked={form.requiresOtp} onChange={(e) => set("requiresOtp", e.target.checked)} className="mt-0.5" />
          <span>Require a one-time code sent to the email address (recommended).</span>
        </label>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input type="checkbox" checked={form.sendNow} onChange={(e) => set("sendNow", e.target.checked)} className="mt-0.5" />
          <span>Email the link to the recipient now. Otherwise copy it from the next screen.</span>
        </label>
        <div className="sm:col-span-2">
          <ModalActions onCancel={onClose} submitLabel="Create link" pendingLabel="Creating…" isPending={mutation.isPending} />
        </div>
      </form>
    </ModalShell>
  );
}

function SubmissionCard({
  project,
  submission: s,
  canConvert,
}: {
  project: ProjectSummaryDto;
  submission: HandoverSubmissionDto;
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
            {s.linkLabel} · {HANDOVER_STAKEHOLDER_LABELS[s.stakeholderType]} · {fmtDate(s.submittedAt)}
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
                {snag.photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {snag.photos.map((f) => (
                      <HandoverFileView key={f.objectKey} projectId={project.id} file={f} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.attachments.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {s.attachments.map((f) => (
              <HandoverFileView key={f.objectKey} projectId={project.id} file={f} />
            ))}
          </div>
        </div>
      )}

      <footer className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        {s.reviewedAt ? (
          <p className="text-[11px] text-slate-500">
            Reviewed by {s.reviewedByName ?? "—"} on {fmtDate(s.reviewedAt)}
            {s.reviewNotes ? `: ${s.reviewNotes}` : ""}
          </p>
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
  const multiPrime = project.contractorExecutionMode === "MULTI_PRIME_SEPARATE_IPC";
  const main = project.contractors.find((c) => c.isMainContractor) ?? project.contractors[0];
  const [contractorId, setContractorId] = useState(multiPrime ? "" : main?.id ?? "");
  const [severity, setSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [dueDate, setDueDate] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({
        submissionId: submission.id,
        body: { projectContractorId: contractorId || null, severity, dueDate: dueDate || null },
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title="Create defect tickets" subtitle={`${submission.snags.filter((s) => !s.defectTicketId).length} snag(s) without a ticket`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Responsible contractor</span>
          <CustomSelect
            value={contractorId}
            onChange={setContractorId}
            placeholder="Choose the contractor"
            options={project.contractors.map((c) => ({ value: c.id, label: `${c.organizationName} (${c.tradeCode})${c.isMainContractor ? " · main" : ""}` }))}
          />
        </label>
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
          disabled={multiPrime && !contractorId}
        />
      </form>
    </ModalShell>
  );
}
