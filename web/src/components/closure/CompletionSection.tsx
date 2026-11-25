import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Award, FileDown, FileSignature, PenLine, ShieldOff, Upload } from "lucide-react";
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

const STATUS_TONE: Record<CompletionCertificateStatus, StatusTone> = {
  DRAFT: "neutral",
  PENDING_SIGNATURES: "pending",
  ISSUED: "good",
  REVOKED: "bad",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Phase 15: the Certificate of Completion on the project's Handover (closeout) tab. Draft (after the
 * final evaluation when the type asks for it), signatory slots with sign buttons for eligible users,
 * the beneficiary's signed paper copy recorded by staff, the PDF, revocation, the handover ceremony
 * deadline and the handover certificate.
 */
export function CompletionSection({ projectId }: { projectId: string }) {
  const query = useProjectCompletionQuery(projectId);
  const openPdf = useOpenCertificatePdfMutation(projectId);
  const openDocument = useOpenDocumentMutation(projectId);
  const [revokeOpen, setRevokeOpen] = useState(false);

  if (query.isLoading) return <Loader />;
  if (!query.data) return null;
  const c = query.data;
  const cert = c.certificate;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Award className="mt-0.5 h-5 w-5 text-brand-primary" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">Certificate of Completion</h2>
            <p className="text-xs text-slate-500">
              {c.rules.requireCocFor.length
                ? `Required for: ${c.rules.requireCocFor.map((g) => CLOSURE_GATE_META[g].label.toLowerCase()).join(", ")}.`
                : "Not required by this project's type."}{" "}
              Handover ceremony due {c.rules.handoverDueDaysAfterCoc} days after issue.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {cert && (
            <button
              type="button"
              onClick={() => openPdf.mutate()}
              disabled={openPdf.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <FileDown className="h-3.5 w-3.5" /> {cert.status === "ISSUED" ? "Certificate PDF" : "Draft for signature (PDF)"}
            </button>
          )}
          {cert && c.canRevoke && (
            <button
              type="button"
              onClick={() => setRevokeOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              <ShieldOff className="h-3.5 w-3.5" /> Revoke
            </button>
          )}
        </div>
      </div>

      <FinalEvaluationLine projectId={projectId} completion={c} />

      {!cert ? <DraftPanel projectId={projectId} completion={c} /> : <CertificatePanel projectId={projectId} cert={cert} />}

      {(c.handoverCeremony || c.handoverCertificateDocumentId) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {c.handoverCeremony && (
            <span>
              Handover ceremony:{" "}
              {c.handoverCeremony.status === "DONE"
                ? `held (${fmt(c.handoverCeremony.completedAt)})`
                : c.handoverCeremony.dueDate
                  ? `due by ${c.handoverCeremony.dueDate}`
                  : "due once the certificate is issued"}
            </span>
          )}
          {c.handoverCertificateDocumentId && (
            <button
              type="button"
              onClick={() => openDocument.mutate({ documentId: c.handoverCertificateDocumentId! })}
              className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline"
            >
              <FileSignature className="h-3.5 w-3.5" /> Handover certificate
            </button>
          )}
        </div>
      )}

      {c.revoked.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold">Revoked certificates ({c.revoked.length})</summary>
          <ul className="mt-2 space-y-1">
            {c.revoked.map((r) => (
              <li key={r.id}>
                {r.certificateNumber}: revoked {fmt(r.revokedAt)} — {r.revokedReason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {revokeOpen && cert && <RevokeModal projectId={projectId} cert={cert} onClose={() => setRevokeOpen(false)} />}
    </section>
  );
}

function FinalEvaluationLine({ projectId, completion }: { projectId: string; completion: ProjectCompletionDto }) {
  const f = completion.finalEvaluation;
  if (f.visitId) {
    return (
      <p className="text-xs text-emerald-700">
        Final evaluation of {f.visitDate} accepted.{" "}
        <Link to={`/app/projects/${projectId}/visits?visitId=${f.visitId}`} className="font-semibold text-brand-primary hover:underline">
          Open the visit
        </Link>
      </p>
    );
  }
  return (
    <p className={`text-xs ${f.required ? "text-amber-800" : "text-slate-500"}`}>
      {f.required ? "An accepted final evaluation visit is needed before the certificate can be drafted. " : "No accepted final evaluation yet. "}
      <Link to={`/app/projects/${projectId}/visits`} className="font-semibold text-brand-primary hover:underline">
        Visits
      </Link>
    </p>
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
  if (!completion.canDraft) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        No certificate yet.{completion.draftBlockedReason ? ` ${completion.draftBlockedReason}` : ""}
      </div>
    );
  }
  return (
    <form className="space-y-3 rounded-xl border border-slate-200 p-3" noValidate onSubmit={form.handleSubmit((v) => draft.mutate(v))}>
      <div className="text-xs font-semibold text-slate-800">Draft the certificate</div>
      <label className="block text-[11px] font-semibold text-slate-600">
        Date of completion
        <input
          type="date"
          max={todayIso()}
          className={`${inputClass} mt-1 max-w-[12rem] ${invalidClass(form, "completionDate")}`}
          {...form.register("completionDate")}
          {...fieldA11y(form, "completionDate")}
        />
        <FieldError form={form} name="completionDate" />
      </label>
      <label className="block text-[11px] font-semibold text-slate-600">
        Scope of works completed
        <textarea
          rows={4}
          className={`${inputClass} mt-1 ${invalidClass(form, "scopeSummary")}`}
          maxLength={4000}
          {...form.register("scopeSummary")}
          {...fieldA11y(form, "scopeSummary")}
        />
        <FieldError form={form} name="scopeSummary" />
      </label>
      <div className="flex justify-end">
        <SubmitButton
          form={form}
          pending={draft.isPending}
          pendingLabel="Drafting…"
          className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Draft certificate
        </SubmitButton>
      </div>
    </form>
  );
}

function CertificatePanel({ projectId, cert }: { projectId: string; cert: CompletionCertificateDto }) {
  const { hasPermission } = useAuth();
  const [editing, setEditing] = useState(false);
  const canEdit = cert.status === "DRAFT" && hasPermission("completion:draft_certificate");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
        <span className="font-bold text-slate-900">{cert.certificateNumber}</span>
        <StatusText label={COMPLETION_CERTIFICATE_STATUS_META[cert.status].label} tone={STATUS_TONE[cert.status]} />
        <span>Completion {cert.completionDate}</span>
        {cert.issuedAt && <span>· issued {fmt(cert.issuedAt)}</span>}
        <span>
          · {cert.signedCount} of {cert.slots.length} signed
        </span>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline">
            <PenLine className="h-3 w-3" /> Edit draft
          </button>
        )}
      </div>
      {editing ? <EditDraft projectId={projectId} cert={cert} onDone={() => setEditing(false)} /> : <p className="whitespace-pre-line text-xs text-slate-600">{cert.scopeSummary}</p>}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {cert.slots.map((slot) => (
          <SlotRow key={slot.key} projectId={projectId} cert={cert} slot={slot} />
        ))}
      </ul>
    </div>
  );
}

function EditDraft({ projectId, cert, onDone }: { projectId: string; cert: CompletionCertificateDto; onDone: () => void }) {
  const update = useUpdateCertificateMutation(projectId);
  const form = useZodForm(CertificateDraftFormSchema, {
    defaultValues: { completionDate: cert.completionDate, scopeSummary: cert.scopeSummary },
  });
  return (
    <form className="space-y-2" noValidate onSubmit={form.handleSubmit((v) => update.mutate(v, { onSuccess: onDone }))}>
      <input
        type="date"
        max={todayIso()}
        aria-label="Date of completion"
        className={`${inputClass} max-w-[12rem] ${invalidClass(form, "completionDate")}`}
        {...form.register("completionDate")}
        {...fieldA11y(form, "completionDate")}
      />
      <FieldError form={form} name="completionDate" />
      <textarea
        rows={4}
        aria-label="Scope of works completed"
        className={`${inputClass} ${invalidClass(form, "scopeSummary")}`}
        maxLength={4000}
        {...form.register("scopeSummary")}
        {...fieldA11y(form, "scopeSummary")}
      />
      <FieldError form={form} name="scopeSummary" />
      <div className="flex justify-end items-start gap-2">
        <button type="button" onClick={onDone} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">
          Cancel
        </button>
        <SubmitButton
          form={form}
          pending={update.isPending}
          className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}

function SlotRow({ projectId, cert, slot }: { projectId: string; cert: CompletionCertificateDto; slot: CocSlotDto }) {
  const sign = useSignCertificateMutation(projectId);
  const openDocument = useOpenDocumentMutation(projectId);
  const { ask, dialog } = useConfirmDialog();
  const [recordOpen, setRecordOpen] = useState(false);
  const s = slot.signature;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-900">{slot.label}</div>
        <div className="text-[11px] text-slate-500">
          {slot.isBeneficiary ? "Beneficiary institution (signed paper copy, recorded by staff)" : COC_SIGNATORY_SCOPE_META[slot.organizationScope].label}
        </div>
        {s ? (
          <div className="mt-1 text-[11px] text-slate-700">
            Signed by <span className="font-semibold">{s.signerName}</span>
            {s.isBeneficiary ? (s.beneficiaryRole ? `, ${s.beneficiaryRole}` : "") : s.roleName ? `, ${s.roleName}` : ""}
            {s.organizationName ? ` (${s.organizationName})` : ""} · {fmt(s.signedAt)}
            {s.recordedByName ? ` · recorded by ${s.recordedByName}` : ""}
            {s.evidenceDocumentId && (
              <button type="button" onClick={() => openDocument.mutate({ documentId: s.evidenceDocumentId! })} className="ml-2 font-semibold text-brand-primary hover:underline">
                Signed copy
              </button>
            )}
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-slate-400" title={slot.cannotSignReason ?? undefined}>
            Awaiting signature{!slot.canSign && slot.cannotSignReason ? ` · ${slot.cannotSignReason}` : ""}
          </div>
        )}
      </div>
      {!s && slot.canSign && !slot.isBeneficiary && (
        <button
          type="button"
          disabled={sign.isPending}
          onClick={async () => {
            const ok = await ask({
              title: `Sign as ${slot.label}`,
              message: `${defaultCocStatement(cert.certificateNumber, slot.label)} Your name, role, organisation and the time are recorded on the certificate and in the audit ledger.`,
              confirmLabel: "Sign",
            });
            if (ok) sign.mutate(slot.key);
          }}
          className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          Sign
        </button>
      )}
      {!s && slot.canSign && slot.isBeneficiary && (
        <button
          type="button"
          onClick={() => setRecordOpen(true)}
          className="inline-flex items-center gap-1 rounded-xl border border-brand-primary px-3 py-1.5 text-xs font-semibold text-brand-primary hover:bg-brand-primary/5"
        >
          <Upload className="h-3.5 w-3.5" /> Record signed copy
        </button>
      )}
      {recordOpen && <BeneficiaryModal projectId={projectId} cert={cert} slot={slot} onClose={() => setRecordOpen(false)} />}
      {dialog}
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
