import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileUp, XCircle } from "lucide-react";
import { NEEDS_FILE_MAX_BYTES, type NeedsFileIssue, type NeedsOutOfCycleDto, type NeedsUploadFilePreview } from "@insite/shared";
import { secondaryButton, primaryButton } from "../../contracts/contractUi";
import { apiErrorCode, getVersionFileLink } from "../../../api/needsPipeline";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import {
  useConfirmOutOfCycleNeedsAssessmentMutation,
  usePreviewOutOfCycleNeedsAssessmentMutation,
} from "../../../mutations/needs/useApprovalMutations";
import { NEEDS_FILE_ACCEPT, cardCls, formatBytes, locationText, money, readAsBase64 } from "../needsUi";

/**
 * Needs pipeline wave 4 (C4): the optional needs assessment of an out-of-cycle request (template v2).
 * Choose the file → the server checks it (nothing saved) → issues, warnings and the flags it would
 * raise are shown → save sends it with the sha256 of the check (a changed file: check again).
 */
export function OutOfCycleNeedsAssessment({ request }: { request: NeedsOutOfCycleDto }) {
  const preview = usePreviewOutOfCycleNeedsAssessmentMutation(request.proposalId);
  const confirm = useConfirmOutOfCycleNeedsAssessmentMutation(request.proposalId);
  const openFile = useOpenNeedsFileMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<{ fileName: string; fileBase64: string; result: NeedsUploadFilePreview } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const version = request.currentVersion;

  const choose = async (file: File) => {
    setChecked(null);
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setMessage("Not an .xlsx file: choose the needs assessment workbook.");
    if (file.size > NEEDS_FILE_MAX_BYTES) return setMessage(`Larger than ${Math.round(NEEDS_FILE_MAX_BYTES / 1024 / 1024)} MB.`);
    setMessage(null);
    let fileBase64: string;
    try {
      fileBase64 = await readAsBase64(file);
    } catch {
      return setMessage("The file could not be read. Choose it again.");
    }
    preview.mutate({ fileName: file.name, fileBase64 }, { onSuccess: (result) => setChecked({ fileName: file.name, fileBase64, result }) });
  };

  const save = () => {
    if (!checked) return;
    confirm.mutate(
      { fileName: checked.fileName, fileBase64: checked.fileBase64, sha256: checked.result.sha256 },
      {
        onSuccess: () => setChecked(null),
        onError: (err) => {
          if (apiErrorCode(err) === "NEEDS_FILE_CHANGED") setChecked(null);
        },
      }
    );
  };

  return (
    <section className={`${cardCls} space-y-3`} aria-labelledby="ooc-needs-assessment">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="ooc-needs-assessment" className="text-sm font-bold text-slate-900">
            Needs assessment <span className="font-normal text-slate-500">(optional)</span>
          </h3>
          <p className="text-[11px] text-slate-500">The needs assessment template (sites, facilities breakdown, BoQ). It becomes the draft project's scope on approval.</p>
        </div>
        {request.canEdit && (
          <button type="button" className={secondaryButton} disabled={preview.isPending || confirm.isPending} onClick={() => fileRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {preview.isPending ? "Checking…" : version ? "Upload a new version" : "Upload the needs assessment"}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={NEEDS_FILE_ACCEPT}
          className="hidden"
          aria-label="Needs assessment file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (f) void choose(f);
          }}
        />
      </div>

      {version ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <span>
            <span className="font-semibold text-slate-900">Version {version.number}</span>
            <span className="text-slate-600">
              {" "}
              · {version.fileName} · {formatBytes(version.byteSize)} · {version.siteCount} site(s), {version.breakdownRowCount} breakdown row(s), {version.boqLineCount} BoQ line(s)
            </span>
            <span className="block text-[11px] text-slate-500">
              {money(version.costedTotalNgn ?? version.preliminaryCostNgn)} · {version.uploadedByName}, {formatDateTimeShort(version.uploadedAt)}
            </span>
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline disabled:opacity-50"
            disabled={openFile.isPending}
            onClick={() => openFile.mutate(() => getVersionFileLink(request.proposalId, version.number))}
          >
            Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      ) : (
        !checked && <p className="text-xs text-slate-500">No needs assessment yet.</p>
      )}

      {message && <p className="text-xs font-medium text-rose-700">{message}</p>}

      {checked && (
        <div className={`space-y-2 rounded-xl border px-3 py-2 ${checked.result.status === "VALID" ? "border-slate-200" : "border-rose-200 bg-rose-50/40"}`}>
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            {checked.result.status === "VALID" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-700" aria-hidden="true" />
            )}
            {checked.fileName} · {checked.result.status === "VALID" ? "Valid" : "Has errors: not saved"}
          </p>
          {checked.result.summary && (
            <p className="text-[11px] text-slate-700">
              {checked.result.summary.title ?? "Untitled"} · {locationText(checked.result.summary.stateCode, checked.result.summary.lgaCodes)} · {checked.result.summary.siteCount} site(s) ·{" "}
              {checked.result.summary.facilitiesSummary || "no facilities"} · {money(checked.result.summary.costedTotalNgn ?? checked.result.summary.preliminaryCostNgn)}
            </p>
          )}
          {checked.result.expectedFlags.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
              {checked.result.expectedFlags.map((f, i) => (
                <li key={`${f.kind}-${i}`} className="flex gap-1">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> {f.message}
                </li>
              ))}
            </ul>
          )}
          <Issues items={checked.result.issues} tone="error" />
          <Issues items={checked.result.warnings} tone="warning" />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={() => setChecked(null)}>
              Cancel
            </button>
            {checked.result.status === "VALID" && (
              <button type="button" className={primaryButton} disabled={confirm.isPending} onClick={save}>
                {confirm.isPending ? "Saving…" : "Save to the request"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Issues({ items, tone }: { items: NeedsFileIssue[]; tone: "error" | "warning" }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`text-[11px] font-bold ${tone === "error" ? "text-rose-700" : "text-amber-800"}`}>
        {tone === "error" ? "Errors" : "Warnings"} ({items.length})
      </p>
      <ul className="mt-0.5 max-h-48 space-y-0.5 overflow-y-auto text-[11px] text-slate-800">
        {items.map((i, n) => (
          <li key={`${i.sheet}-${i.row}-${i.column}-${n}`}>
            <span className="text-slate-500">
              {i.sheet}
              {i.row ? `, row ${i.row}` : ""}
              {i.column ? `, ${i.column}` : ""}:
            </span>{" "}
            {i.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
