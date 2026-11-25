import React, { useState } from "react";
import { Archive, Download, FileSignature, FileUp, X } from "lucide-react";
import { z } from "zod";
import { ArchiveProjectDocumentRequestSchema, defaultSignOffStatement, type ProjectDocumentDetailDto } from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import Drawer from "../Drawer";
import Loader from "../Loader";
import { useAuth } from "../../lib/auth-context";
import { formatDateTimeShort } from "../../lib/formatters";
import { useDocumentTypesQuery, useProjectDocumentQuery } from "../../queries/contracts/useContractQueries";
import { useArchiveDocumentMutation, useOpenDocumentMutation, useSignDocumentMutation } from "../../mutations/contracts/useContractMutations";
import { DocumentUploadDialog } from "./DocumentUploadDialog";
import { canOfferSignOff } from "./documentSignOff";
import { dangerButton, formatBytes, primaryButton, secondaryButton, shortHash, smallInput, StatusChip } from "../contracts/contractUi";

/**
 * Phase 13: one register document: its versions (each downloadable), the sign-offs (who, role,
 * organisation, when, statement hash), and the actions Sign off, New version and Archive.
 */
export function DocumentDrawer({ projectId, documentId, onClose }: { projectId: string; documentId: string; onClose: () => void }) {
  const q = useProjectDocumentQuery(projectId, documentId);
  return (
    <Drawer onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="px-5 py-4 bg-brand-navy text-white flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-bold truncate">{q.data?.title ?? "Document"}</h3>
          {q.data && (
            <p className="text-[11px] text-white/70">
              {q.data.documentType.name} · version {q.data.currentVersion}
              {q.data.contractorName ? ` · ${q.data.contractorName}` : ""}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-white/75 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {q.isLoading ? <Loader /> : q.data ? <DocumentDetail key={q.data.id} projectId={projectId} doc={q.data} /> :<p className="text-xs text-slate-500">Could not load the document.</p>}
      </div>
    </Drawer>
  );
}

function DocumentDetail({ projectId, doc }: { projectId: string; doc: ProjectDocumentDetailDto }) {
  const { hasPermission } = useAuth();
  const canUpload = hasPermission("documents:upload");
  const open = useOpenDocumentMutation(projectId);
  const sign = useSignDocumentMutation(projectId);
  const archive = useArchiveDocumentMutation(projectId);
  const types = useDocumentTypesQuery(true, canUpload);
  const [signing, setSigning] = useState(false);
  const defaultStatement = defaultSignOffStatement(doc.title, doc.currentVersion);
  const [versioning, setVersioning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const current = doc.signOffs.filter((s) => s.version === doc.currentVersion);
  const earlier = doc.signOffs.filter((s) => s.version !== doc.currentVersion);
  const allowedMimeTypes = types.data?.find((t) => t.id === doc.documentType.id)?.allowedMimeTypes;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {doc.isArchived && <StatusChip label="Archived" cls="bg-slate-100 text-slate-600 border-slate-200" />}
        {doc.documentType.requiresSignOff &&
          (doc.awaitingSignOff ? (
            <StatusChip label="Awaiting sign-off" cls="bg-amber-50 text-amber-800 border-amber-200" />
          ) : (
            <StatusChip label={`Signed off (${doc.signOffCount})`} cls="bg-emerald-50 text-emerald-800 border-emerald-200" />
          ))}
        {doc.signedByMe && <StatusChip label="You signed this version" cls="bg-brand-primary/5 text-brand-primary border-brand-primary/25" />}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={open.isPending} onClick={() => open.mutate({ documentId: doc.id })}>
          <Download className="w-3.5 h-3.5" /> Open current version
        </button>
        {canOfferSignOff(doc, hasPermission) && !signing && (
          <button type="button" className={primaryButton} onClick={() => setSigning(true)}>
            <FileSignature className="w-3.5 h-3.5" /> Sign off
          </button>
        )}
        {canUpload && !doc.isArchived && (
          <button type="button" className={secondaryButton} onClick={() => setVersioning(true)}>
            <FileUp className="w-3.5 h-3.5" /> New version
          </button>
        )}
        {canUpload && !doc.isArchived && !archiving && (
          <button type="button" className={dangerButton} onClick={() => setArchiving(true)}>
            <Archive className="w-3.5 h-3.5" /> Archive
          </button>
        )}
      </div>

      {signing && (
        <SignOffForm
          version={doc.currentVersion}
          defaultStatement={defaultStatement}
          pending={sign.isPending}
          onCancel={() => setSigning(false)}
          onSubmit={(statement) =>
            sign.mutate(
              { documentId: doc.id, version: doc.currentVersion, statement: statement === defaultStatement ? undefined : statement },
              { onSuccess: () => setSigning(false) }
            )
          }
        />
      )}

      {archiving && (
        <ArchiveForm
          pending={archive.isPending}
          onCancel={() => setArchiving(false)}
          onSubmit={(reason) => archive.mutate({ documentId: doc.id, reason }, { onSuccess: () => setArchiving(false) })}
        />
      )}

      <section className="space-y-2">
        <h4 className="text-xs font-bold text-slate-900">Sign-offs on version {doc.currentVersion}</h4>
        {current.length === 0 ? (
          <p className="text-[11px] text-slate-500">{doc.documentType.requiresSignOff ? "None yet. This type needs a sign-off." : "None."}</p>
        ) : (
          <SignOffList signOffs={current} />
        )}
        {earlier.length > 0 && (
          <details className="text-[11px]">
            <summary className="cursor-pointer font-semibold text-slate-600">Sign-offs on earlier versions ({earlier.length})</summary>
            <div className="mt-2">
              <SignOffList signOffs={earlier} showVersion />
            </div>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-bold text-slate-900">Versions</h4>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {[...doc.versions]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <li key={v.version} className="flex items-start justify-between gap-2 p-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    Version {v.version}
                    {v.version === doc.currentVersion ? " (current)" : ""}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {v.uploadedByName ?? "Unknown"} · {formatDateTimeShort(v.uploadedAt)} · {formatBytes(v.byteSize)}
                  </p>
                  {v.note && <p className="text-[11px] text-slate-600">{v.note}</p>}
                  <p className="text-[10px] text-slate-400" title={v.sha256}>
                    SHA-256 {shortHash(v.sha256)}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-[11px] font-semibold text-brand-primary hover:underline disabled:opacity-50"
                  disabled={open.isPending}
                  onClick={() => open.mutate({ documentId: doc.id, version: v.version })}
                >
                  Download
                </button>
              </li>
            ))}
        </ul>
      </section>

      {versioning && (
        <DocumentUploadDialog
          projectId={projectId}
          onClose={() => setVersioning(false)}
          newVersionOf={{ id: doc.id, title: doc.title, currentVersion: doc.currentVersion, allowedMimeTypes }}
        />
      )}
    </>
  );
}

/** The sign-off statement: the server accepts 10 to 1000 characters (SignProjectDocumentRequestSchema). */
const SignOffFormSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(10, "Write a statement of at least 10 characters")
    .max(1000, "The statement is too long (at most 1000 characters)"),
});

function SignOffForm({
  version,
  defaultStatement,
  pending,
  onCancel,
  onSubmit,
}: {
  version: number;
  defaultStatement: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (statement: string) => void;
}) {
  const form = useZodForm(SignOffFormSchema, { defaultValues: { statement: defaultStatement } });
  return (
    <form
      onSubmit={form.handleSubmit((v) => onSubmit(v.statement))}
      noValidate
      className="rounded-xl border border-brand-primary/25 bg-brand-primary/5 p-3 space-y-2"
    >
      <p className="text-xs font-semibold text-slate-900">Sign off version {version}</p>
      <p className="text-[11px] text-slate-600">
        Your sign-off records your name, role, organisation, the time and this statement against version {version}. It is an
        acknowledgement in the platform, not a qualified electronic signature.
      </p>
      <textarea
        rows={3}
        className={`${smallInput} ${invalidClass(form, "statement")}`}
        maxLength={1000}
        aria-label="Statement"
        {...form.register("statement")}
        {...fieldA11y(form, "statement")}
      />
      <FieldError form={form} name="statement" />
      <div className="flex justify-end items-start gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        <SubmitButton form={form} pending={pending} pendingLabel="Signing…" className={primaryButton}>
          Confirm sign-off
        </SubmitButton>
      </div>
    </form>
  );
}

function ArchiveForm({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const form = useZodForm(ArchiveProjectDocumentRequestSchema, { defaultValues: { reason: "" } });
  return (
    <form onSubmit={form.handleSubmit((v) => onSubmit(v.reason))} noValidate className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-900">Archive this document?</p>
      <p className="text-[11px] text-slate-600">It stays in the record with its versions and sign-offs, but no longer counts as evidence.</p>
      <input
        className={`${smallInput} ${invalidClass(form, "reason")}`}
        placeholder="Why it is archived"
        aria-label="Reason"
        maxLength={500}
        {...form.register("reason")}
        {...fieldA11y(form, "reason")}
      />
      <FieldError form={form} name="reason" />
      <div className="flex justify-end items-start gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        <SubmitButton form={form} pending={pending} hint="Give a reason of at least 5 characters." className={dangerButton}>
          Archive
        </SubmitButton>
      </div>
    </form>
  );
}

function SignOffList({ signOffs, showVersion = false }: { signOffs: ProjectDocumentDetailDto["signOffs"]; showVersion?: boolean }) {
  return (
    <ul className="space-y-2">
      {signOffs.map((s) => (
        <li key={s.id} className="rounded-xl border border-slate-200 p-3 text-xs space-y-1">
          <p className="font-semibold text-slate-900">
            {s.userName ?? "Unknown user"}
            <span className="font-normal text-slate-500">
              {s.roleName ? ` · ${s.roleName}` : ""}
              {s.organizationName ? ` · ${s.organizationName}` : ""}
            </span>
          </p>
          <p className="text-[11px] text-slate-500">
            {formatDateTimeShort(s.signedAt)}
            {showVersion ? ` · version ${s.version}` : ""} ·{" "}
            <span title={s.statementHash}>statement {shortHash(s.statementHash)}</span>
          </p>
          <p className="text-[11px] text-slate-600 italic">“{s.statement}”</p>
        </li>
      ))}
    </ul>
  );
}
