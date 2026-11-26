import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Award, CalendarClock, CheckCircle2, Circle, FileDown, FileSignature, PenLine, ShieldOff, Upload } from "lucide-react";
import {
  CLOSURE_GATE_META,
  COC_SIGNATORY_SCOPE_META,
  COMPLETION_CERTIFICATE_STATUS_META,
  defaultBeneficiaryAttestation,
  defaultCocStatement,
  RecordBeneficiarySignatureRequestSchema,
  RevokeCompletionCertificateRequestSchema,
  type CocSlotDto,
  type CompletionCertificateDto,
  type CompletionCertificateStatus,
  type ProjectCompletionDto,
} from "@insite/shared";
import Loader from "../Loader";
import { z } from "zod";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort } from "../../lib/formatters";
import { FieldError, SubmitButton, canSubmit, fieldA11y, invalidClass, useZodForm, zDateText } from "../../lib/forms";
import { useConfirmDialog } from "../process/ConfirmDialog";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import { StatusText, type StatusTone } from "../common/StatusText";
import { useProjectCompletionQuery } from "../../queries/closure/useClosureQueries";
import {
  useDraftCertificateMutation,
  useOpenCertificatePdfMutation,
  useRecordBeneficiaryMutation,
  useRevokeCertificateMutation,
  useSignCertificateMutation,
  useUpdateCertificateMutation,
} from "../../mutations/closure/useClosureMutations";
import { useOpenDocumentMutation } from "../../mutations/contracts/useContractMutations";
import { Dot, StageProgress, StatusHeader, linkAction, panelClass, primaryAction, secondaryAction, type StageState } from "./closureUi";

const STATUS_TONE: Record<CompletionCertificateStatus, StatusTone> = {
  DRAFT: "neutral",
  PENDING_SIGNATURES: "pending",
  ISSUED: "good",
  REVOKED: "bad",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Phase 15: the Certificate of Completion (Completion & handover → Certificate). Design round
 * 2026-11-26: a status header with the caller's next action, the stages Draft → Signatures → Issued,
 * the prerequisite as a small checklist, signatories as a list with status and action on the right,
 * the certificate text behind a disclosure, then the handover ceremony and revocation at the foot.
 * Same mutations as before: draft, edit, sign, record the beneficiary's signed paper copy, PDF, revoke.
 */
export function CompletionSection({ projectId }: { projectId: string }) {
  const query = useProjectCompletionQuery(projectId);
  const openPdf = useOpenCertificatePdfMutation(projectId);
  const openDocument = useOpenDocumentMutation(projectId);
  const sign = useSignCertificateMutation(projectId);
  const { ask, dialog } = useConfirmDialog();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [recordSlot, setRecordSlot] = useState<CocSlotDto | null>(null);

  if (query.isLoading) return <Loader />;
  if (!query.data) return null;
  const c = query.data;
  const cert = c.certificate;
  const issued = cert?.status === "ISSUED";

  const startSign = async (slot: CocSlotDto) => {
    if (!cert) return;
    if (slot.isBeneficiary) {
      setRecordSlot(slot);
      return;
    }
    const ok = await ask({
      title: `Sign as ${slot.label}`,
      message: `${defaultCocStatement(cert.certificateNumber, slot.label)} Your name, role, organisation and the time are recorded on the certificate and in the audit ledger.`,
      confirmLabel: "Sign",
    });
    if (ok) sign.mutate(slot.key);
  };

  // The caller's one next action: the first slot they may sign (or record) now.
  const nextSlot = cert && !issued ? (cert.slots.find((s) => !s.signature && s.canSign) ?? null) : null;

  const stages: { label: string; detail?: string; state: StageState }[] = [
    { label: "Draft", detail: cert ? `Completion ${formatDateShort(cert.completionDate)}` : "Not drafted yet", state: cert ? "done" : "current" },
    {
      label: "Signatures",
      detail: cert ? `${cert.signedCount} of ${cert.slots.length} signed` : undefined,
      state: issued ? "done" : cert ? "current" : "todo",
    },
    { label: "Issued", detail: cert?.issuedAt ? formatDateShort(cert.issuedAt) : undefined, state: issued ? "done" : "todo" },
  ];

  const requiredFor = c.rules.requireCocFor.length
    ? `Needed for: ${c.rules.requireCocFor.map((g) => CLOSURE_GATE_META[g].label.toLowerCase()).join(", ")}.`
    : "Not required by this project's type.";

  return (
    <section className={`${panelClass} space-y-6`} aria-labelledby="coc-heading">
      <StatusHeader
        icon={<Award className="h-5 w-5" />}
        title="Certificate of Completion"
        titleId="coc-heading"
        status={
          cert ? (
            <>
              <span className="font-semibold text-slate-900">{cert.certificateNumber}</span>
              <Dot />
              <StatusText label={COMPLETION_CERTIFICATE_STATUS_META[cert.status].label} tone={STATUS_TONE[cert.status]} />
              {!issued && (
                <>
                  <Dot />
                  <span>
                    {cert.signedCount} of {cert.slots.length} signed
                  </span>
                </>
              )}
            </>
          ) : (
            <StatusText label="Not drafted" tone="neutral" />
          )
        }
        help={requiredFor}
        actions={
          <>
            {cert && (
              <button type="button" onClick={() => openPdf.mutate()} disabled={openPdf.isPending} className={issued ? primaryAction : secondaryAction}>
                <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> {issued ? "Certificate PDF" : "Draft for signature (PDF)"}
              </button>
            )}
            {nextSlot && (
              <button type="button" onClick={() => void startSign(nextSlot)} disabled={sign.isPending} className={primaryAction}>
                {nextSlot.isBeneficiary ? <Upload className="h-3.5 w-3.5" aria-hidden="true" /> : <PenLine className="h-3.5 w-3.5" aria-hidden="true" />}
                {nextSlot.isBeneficiary ? "Record beneficiary signed copy" : `Sign as ${nextSlot.label}`}
              </button>
            )}
          </>
        }
      />

      <StageProgress label="Certificate stages" stages={stages} />

      <Prerequisites projectId={projectId} completion={c} />

      {!cert ? (
        <DraftPanel projectId={projectId} completion={c} />
      ) : (
        <CertificatePanel projectId={projectId} cert={cert} onSign={startSign} signPending={sign.isPending} />
      )}

      {(c.handoverCeremony || c.handoverCertificateDocumentId || c.revoked.length > 0 || (cert && c.canRevoke)) && (
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 text-xs text-slate-700 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {c.handoverCeremony && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                Handover ceremony:{" "}
                {c.handoverCeremony.status === "DONE"
                  ? `held (${fmt(c.handoverCeremony.completedAt)})`
                  : c.handoverCeremony.dueDate
                    ? `due by ${formatDateShort(c.handoverCeremony.dueDate)}`
                    : `due ${c.rules.handoverDueDaysAfterCoc} days after the certificate is issued`}
              </span>
            )}
            {c.handoverCertificateDocumentId && (
              <button type="button" onClick={() => openDocument.mutate({ documentId: c.handoverCertificateDocumentId! })} className={linkAction}>
                <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Handover certificate
              </button>
            )}
            {c.revoked.length > 0 && (
              <details className="text-slate-600">
                <summary className="cursor-pointer font-semibold">Revoked certificates ({c.revoked.length})</summary>
                <ul className="mt-2 space-y-1">
                  {c.revoked.map((r) => (
                    <li key={r.id}>
                      {r.certificateNumber}: revoked {fmt(r.revokedAt)}. {r.revokedReason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {cert && c.canRevoke && (
            <button
              type="button"
              onClick={() => setRevokeOpen(true)}
              className="inline-flex items-center gap-1.5 self-start rounded-xl px-2 py-1 font-semibold text-rose-700 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 sm:self-auto"
            >
              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" /> Revoke certificate
            </button>
          )}
        </div>
      )}

      {revokeOpen && cert && <RevokeModal projectId={projectId} cert={cert} onClose={() => setRevokeOpen(false)} />}
      {recordSlot && cert && <BeneficiaryModal projectId={projectId} cert={cert} slot={recordSlot} onClose={() => setRecordSlot(null)} />}
      {dialog}
    </section>
  );
}

/** What must be true before drafting: the accepted final evaluation (when the type asks for it). */
function Prerequisites({ projectId, completion }: { projectId: string; completion: ProjectCompletionDto }) {
  const f = completion.finalEvaluation;
  const blocked = !completion.certificate && !completion.canDraft && completion.draftBlockedReason;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Before drafting</h3>
      <ul className="space-y-1.5 text-xs">
        <li className="flex items-start gap-2">
          {f.visitId ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : f.required ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          ) : (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          )}
          <span className="text-slate-700">
            {f.visitId ? (
              <>
                <span className="sr-only">Done: </span>Final evaluation of {formatDateShort(f.visitDate)} accepted.{" "}
                <Link to={`/app/projects/${projectId}/visits?visitId=${f.visitId}`} className={linkAction}>
                  Open the monitoring visit
                </Link>
              </>
            ) : (
              <>
                <span className="sr-only">Not done: </span>
                {f.required ? "Final evaluation monitoring report accepted (required)." : "Final evaluation monitoring report accepted (optional)."}{" "}
                <Link to={`/app/projects/${projectId}/visits`} className={linkAction}>
                  Monitoring visits
                </Link>
              </>
            )}
          </span>
        </li>
        {blocked && (
          <li className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="text-slate-700">{completion.draftBlockedReason}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Draft and edit: DraftCompletionCertificateRequestSchema / UpdateCompletionCertificateRequestSchema,
 * with the scope required here (the field is pre-filled) and no future completion date.
 */
const CertificateDraftFormSchema = z.object({
  completionDate: zDateText("date of completion").refine((d) => d <= todayIso(), "The date of completion cannot be in the future"),
  scopeSummary: z
    .string()
    .trim()
    .min(20, "Describe the completed scope in at least 20 characters")
    .max(4000, "The scope is too long (at most 4000 characters)"),
});

function DraftPanel({ projectId, completion }: { projectId: string; completion: ProjectCompletionDto }) {
  const draft = useDraftCertificateMutation(projectId);
  const form = useZodForm(CertificateDraftFormSchema, {
    defaultValues: { completionDate: todayIso(), scopeSummary: completion.suggestedScopeSummary },
  });
  if (!completion.canDraft) return null;
  return (
    <form className="space-y-3 rounded-xl bg-slate-50 p-4" noValidate onSubmit={form.handleSubmit((v) => draft.mutate(v))}>
      <h3 className="text-sm font-semibold text-slate-900">Draft the certificate</h3>
      <label className="block text-[11px] font-semibold text-slate-600">
        Date of completion
        <input
          type="date"
          max={todayIso()}
          className={`${inputClass} mt-1 max-w-[12rem] bg-white ${invalidClass(form, "completionDate")}`}
          {...form.register("completionDate")}
          {...fieldA11y(form, "completionDate")}
        />
        <FieldError form={form} name="completionDate" />
      </label>
      <label className="block text-[11px] font-semibold text-slate-600">
        Scope of works completed
        <textarea
          rows={4}
          className={`${inputClass} mt-1 bg-white ${invalidClass(form, "scopeSummary")}`}
          maxLength={4000}
          {...form.register("scopeSummary")}
          {...fieldA11y(form, "scopeSummary")}
        />
        <FieldError form={form} name="scopeSummary" />
      </label>
      <div className="flex justify-end">
        <SubmitButton form={form} pending={draft.isPending} pendingLabel="Drafting…" className={primaryAction}>
          Draft certificate
        </SubmitButton>
      </div>
    </form>
  );
}

function CertificatePanel({
  projectId,
  cert,
  onSign,
  signPending,
}: {
  projectId: string;
  cert: CompletionCertificateDto;
  onSign: (slot: CocSlotDto) => void;
  signPending: boolean;
}) {
  const { hasPermission } = useAuth();
  const [editing, setEditing] = useState(false);
  const canEdit = cert.status === "DRAFT" && hasPermission("completion:draft_certificate");
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Signatories</h3>
        <ul className="divide-y divide-slate-100">
          {cert.slots.map((slot) => (
            <SlotRow key={slot.key} projectId={projectId} slot={slot} onSign={onSign} signPending={signPending} issued={cert.status === "ISSUED"} />
          ))}
        </ul>
      </div>

      {editing ? (
        <EditDraft projectId={projectId} cert={cert} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <details className="group min-w-0 flex-1 text-xs">
            <summary className="cursor-pointer font-semibold text-brand-primary hover:underline">
              <span className="group-open:hidden">Show certificate text</span>
              <span className="hidden group-open:inline">Hide certificate text</span>
            </summary>
            <div className="mt-2 space-y-1 rounded-xl bg-slate-50 p-3 text-slate-700">
              <p className="text-[11px] font-semibold text-slate-600">Date of completion: {formatDateShort(cert.completionDate)}</p>
              <p className="whitespace-pre-line">{cert.scopeSummary}</p>
            </div>
          </details>
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className={`${linkAction} text-xs`}>
              <PenLine className="h-3 w-3" aria-hidden="true" /> Edit draft
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EditDraft({ projectId, cert, onDone }: { projectId: string; cert: CompletionCertificateDto; onDone: () => void }) {
  const update = useUpdateCertificateMutation(projectId);
  const form = useZodForm(CertificateDraftFormSchema, {
    defaultValues: { completionDate: cert.completionDate, scopeSummary: cert.scopeSummary },
  });
  return (
    <form className="space-y-2 rounded-xl bg-slate-50 p-4" noValidate onSubmit={form.handleSubmit((v) => update.mutate(v, { onSuccess: onDone }))}>
      <h3 className="text-sm font-semibold text-slate-900">Edit the draft</h3>
      <input
        type="date"
        max={todayIso()}
        aria-label="Date of completion"
        className={`${inputClass} max-w-[12rem] bg-white ${invalidClass(form, "completionDate")}`}
        {...form.register("completionDate")}
        {...fieldA11y(form, "completionDate")}
      />
      <FieldError form={form} name="completionDate" />
      <textarea
        rows={4}
        aria-label="Scope of works completed"
        className={`${inputClass} bg-white ${invalidClass(form, "scopeSummary")}`}
        maxLength={4000}
        {...form.register("scopeSummary")}
        {...fieldA11y(form, "scopeSummary")}
      />
      <FieldError form={form} name="scopeSummary" />
      <div className="flex items-start justify-end gap-2">
        <button type="button" onClick={onDone} className={secondaryAction}>
          Cancel
        </button>
        <SubmitButton form={form} pending={update.isPending} className={primaryAction}>
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}

function SlotRow({
  projectId,
  slot,
  onSign,
  signPending,
  issued,
}: {
  projectId: string;
  slot: CocSlotDto;
  onSign: (slot: CocSlotDto) => void;
  signPending: boolean;
  issued: boolean;
}) {
  const openDocument = useOpenDocumentMutation(projectId);
  const s = slot.signature;
  const scope = slot.isBeneficiary ? "Beneficiary institution (signed paper copy, recorded by staff)" : COC_SIGNATORY_SCOPE_META[slot.organizationScope].label;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{slot.label}</p>
        {s ? (
          <p className="text-xs text-slate-600">
            {s.signerName}
            {s.isBeneficiary ? (s.beneficiaryRole ? `, ${s.beneficiaryRole}` : "") : s.roleName ? `, ${s.roleName}` : ""}
            {s.organizationName ? ` (${s.organizationName})` : ""} · {fmt(s.signedAt)}
            {s.recordedByName ? ` · recorded by ${s.recordedByName}` : ""}
            {s.evidenceDocumentId && (
              <>
                {" · "}
                <button type="button" onClick={() => openDocument.mutate({ documentId: s.evidenceDocumentId! })} className={linkAction}>
                  Signed copy
                </button>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-slate-600">
            {scope}
            {!slot.canSign && slot.cannotSignReason && !issued ? ` · ${slot.cannotSignReason}` : ""}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {s ? <StatusText label="Signed" tone="good" /> : <StatusText label="Awaiting signature" tone="pending" />}
        {!s && slot.canSign && (
          <button type="button" disabled={signPending && !slot.isBeneficiary} onClick={() => onSign(slot)} className={secondaryAction}>
            {slot.isBeneficiary ? (
              <>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Record signed copy
              </>
            ) : (
              "Sign"
            )}
          </button>
        )}
      </div>
    </li>
  );
}

/** RecordBeneficiarySignatureRequestSchema without the server-side keys (slot, object key, statement). */
const BeneficiaryFormSchema = RecordBeneficiarySignatureRequestSchema.pick({ beneficiaryName: true, beneficiaryRole: true }).extend({
  attest: z.boolean().refine((v) => v, "Confirm the attestation"),
});

function BeneficiaryModal({ projectId, cert, slot, onClose }: { projectId: string; cert: CompletionCertificateDto; slot: CocSlotDto; onClose: () => void }) {
  const record = useRecordBeneficiaryMutation(projectId);
  const form = useZodForm(BeneficiaryFormSchema, { defaultValues: { beneficiaryName: "", beneficiaryRole: "", attest: false } });
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const name = form.watch("beneficiaryName");
  return (
    <ModalShell title={`Record ${slot.label}`} subtitle={cert.certificateNumber} onClose={onClose}>
      <form
        className="space-y-3 p-5"
        noValidate
        onSubmit={form.handleSubmit((v) => {
          if (!file) return;
          record.mutate({ slotKey: slot.key, beneficiaryName: v.beneficiaryName, beneficiaryRole: v.beneficiaryRole, file, onProgress: setProgress }, { onSuccess: onClose });
        })}
      >
        <p className="text-xs text-slate-600">Upload a scan of the certificate the beneficiary signed on paper. It is filed in the document register as the beneficiary signed copy.</p>
        <label className="block text-[11px] font-semibold text-slate-600">
          Name of the person who signed
          <input
            className={`${inputClass} mt-1 ${invalidClass(form, "beneficiaryName")}`}
            maxLength={160}
            {...form.register("beneficiaryName")}
            {...fieldA11y(form, "beneficiaryName")}
          />
          <FieldError form={form} name="beneficiaryName" />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Their position
          <input
            className={`${inputClass} mt-1 ${invalidClass(form, "beneficiaryRole")}`}
            placeholder="e.g. Head teacher"
            maxLength={160}
            {...form.register("beneficiaryRole")}
            {...fieldA11y(form, "beneficiaryRole")}
          />
          <FieldError form={form} name="beneficiaryRole" />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Signed copy (PDF or image)
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block text-xs" />
          {!file && form.formState.isValid && <span className="mt-1 block font-normal text-slate-500">Choose the scan of the signed copy.</span>}
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" className="mt-0.5" {...form.register("attest")} {...fieldA11y(form, "attest")} />
          <span>{defaultBeneficiaryAttestation(cert.certificateNumber, name.trim() || "the beneficiary")}</span>
        </label>
        <FieldError form={form} name="attest" />
        {record.isPending && progress > 0 && progress < 1 && <p className="text-[11px] text-slate-500">Uploading… {Math.round(progress * 100)}%</p>}
        <ModalActions
          onCancel={onClose}
          submitLabel="Record signature"
          pendingLabel="Recording…"
          isPending={record.isPending}
          disabled={!canSubmit(form, { pending: record.isPending, blocked: !file })}
        />
      </form>
    </ModalShell>
  );
}

function RevokeModal({ projectId, cert, onClose }: { projectId: string; cert: CompletionCertificateDto; onClose: () => void }) {
  const revoke = useRevokeCertificateMutation(projectId);
  const form = useZodForm(RevokeCompletionCertificateRequestSchema, { defaultValues: { reason: "" } });
  return (
    <ModalShell title={`Revoke ${cert.certificateNumber}`} onClose={onClose} maxWidth="max-w-md">
      <form className="space-y-3 p-5" noValidate onSubmit={form.handleSubmit((v) => revoke.mutate(v.reason, { onSuccess: onClose }))}>
        <p className="text-xs text-slate-600">
          The certificate and its PDF are withdrawn, milestones that counted from it lose their date, and the gates it opened close again until a new
          certificate is issued. This cannot be done once the handover is accepted.
        </p>
        <textarea
          rows={3}
          className={`${inputClass} ${invalidClass(form, "reason")}`}
          placeholder="Why is it revoked?"
          aria-label="Reason"
          maxLength={1000}
          {...form.register("reason")}
          {...fieldA11y(form, "reason")}
        />
        <FieldError form={form} name="reason" />
        <ModalActions
          onCancel={onClose}
          submitLabel="Revoke certificate"
          pendingLabel="Revoking…"
          isPending={revoke.isPending}
          disabled={!canSubmit(form, { pending: revoke.isPending })}
        />
      </form>
    </ModalShell>
  );
}
