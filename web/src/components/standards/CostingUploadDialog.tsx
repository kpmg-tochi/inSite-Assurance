import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, XCircle } from "lucide-react";
import { COSTING_STANDARD_FILE_MAX_BYTES, type CostingStandardImportPreviewDto, type NeedsFileIssue } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { apiErrorCode, apiErrorDetails } from "../../api/needsPipeline";
import {
  useConfirmCostingImportMutation,
  useDownloadCostingTemplateMutation,
  usePreviewCostingImportMutation,
} from "../../mutations/needs/useStandardsMutations";
import { NEEDS_FILE_ACCEPT, downloadCsv, inputCls, labelCls, money, plural, readAsBase64 } from "../needs/needsUi";

/**
 * Needs pipeline wave 2 (C1): upload a costing standard from its workbook (`standards:manage`).
 * Choose the .xlsx → the server checks it (nothing saved): issues with sheet, row, column and reason,
 * the changes against the latest version, and whether it saves as a new version or edits the latest
 * in place (only while no cycle or needs assessment uses it) → a note → save with the check's sha256.
 */

type Pending = { fileBase64: string; fileName: string; preview: CostingStandardImportPreviewDto };

export function CostingUploadDialog({ onClose }: { onClose: () => void }) {
  const template = useDownloadCostingTemplateMutation();
  const preview = usePreviewCostingImportMutation();
  const confirm = useConfirmCostingImportMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [refused, setRefused] = useState<NeedsFileIssue[]>([]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setFileError("Choose the costing standard .xlsx file.");
    if (file.size > COSTING_STANDARD_FILE_MAX_BYTES) return setFileError(`The file is larger than ${Math.round(COSTING_STANDARD_FILE_MAX_BYTES / 1024 / 1024)} MB.`);
    setFileError(null);
    setRefused([]);
    let fileBase64: string;
    try {
      fileBase64 = await readAsBase64(file);
    } catch {
      return setFileError("The file could not be read. Try again.");
    }
    preview.mutate({ fileBase64, fileName: file.name }, { onSuccess: (p) => setPending({ fileBase64, fileName: file.name, preview: p }) });
  };

  const onConfirm = () => {
    if (!pending) return;
    confirm.mutate(
      { fileBase64: pending.fileBase64, fileName: pending.fileName, sha256: pending.preview.sha256, note: note.trim() || null },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          const code = apiErrorCode(err);
          if (code === "COSTING_STANDARD_FILE_CHANGED" || code === "COSTING_STANDARD_LOCKED") {
            setPending(null);
            setFileError(code === "COSTING_STANDARD_LOCKED" ? "The latest version is now in use. Choose the file again: it will save as a new version." : "The file changed since it was checked. Choose it again.");
            return;
          }
          const details = apiErrorDetails(err) as { issues?: NeedsFileIssue[] } | null;
          setRefused(details?.issues ?? []);
        },
      }
    );
  };

  const fileInput = (
    <input ref={fileRef} type="file" accept={NEEDS_FILE_ACCEPT} className="hidden" aria-label="Costing standard file (.xlsx)" onChange={onFile} />
  );

  if (pending) {
    const p = pending.preview;
    const ok = p.standard !== null && p.issues.length === 0;
    const c = p.changes;
    return (
      <ModalShell title="Check the costing standard" subtitle={`${pending.fileName} · nothing is saved until you save`} onClose={onClose} maxWidth="max-w-4xl">
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          <p className={`rounded-xl border px-3 py-2 text-xs font-semibold ${p.editsLatestInPlace ? "border-amber-200 bg-amber-50 text-amber-900" : "border-brand-primary/25 bg-brand-primary/5 text-slate-900"}`}>
            {p.editsLatestInPlace
              ? `Edits version ${p.targetVersion} in place (no cycle or needs assessment uses it yet).`
              : `Will save as version ${p.targetVersion}. Earlier versions stay as they are for the cycles that use them.`}
          </p>

          {p.standard && (
            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Tile label="Rates" value={String(p.standard.rates.length)} />
              <Tile label="Ceilings" value={String(p.standard.ceilings.length)} />
              <Tile label="Supervision and monitoring" value={`${p.standard.supervisionMonitoringPct}%`} />
              <Tile label="Contingency" value={`${p.standard.contingencyPct}%`} />
            </dl>
          )}

          {c && (
            <section className="rounded-xl border border-slate-200 px-3 py-2 text-xs" aria-label="Changes against the latest version">
              <p className="font-bold text-slate-900">Changes against the latest version</p>
              {c.added.length === 0 && c.changed.length === 0 && c.removed.length === 0 && !c.settingsChanged ? (
                <p className="mt-1 text-slate-600">No changes.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-slate-700">
                  {c.added.length > 0 && (
                    <li>
                      <span className="font-semibold">{plural(c.added.length, "item")} added:</span> {c.added.join(", ")}
                    </li>
                  )}
                  {c.changed.length > 0 && (
                    <li>
                      <span className="font-semibold">{plural(c.changed.length, "rate")} changed:</span>
                      <ul className="mt-0.5 max-h-40 space-y-0.5 overflow-y-auto pl-3">
                        {c.changed.map((x) => (
                          <li key={x.itemCode}>
                            {x.itemCode}: {money(x.fromRateNgn)} → {money(x.toRateNgn)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                  {c.removed.length > 0 && (
                    <li>
                      <span className="font-semibold">{plural(c.removed.length, "item")} removed:</span> {c.removed.join(", ")}
                    </li>
                  )}
                  {c.settingsChanged && <li>Supervision and monitoring, contingency, a zone factor or a ceiling changed.</li>}
                </ul>
              )}
            </section>
          )}

          <Issues items={refused} tone="error" title="The save was refused" />
          <Issues items={p.issues} tone="error" title="Errors" />
          <Issues items={p.warnings} tone="warning" title="Warnings" />
          {(p.issues.length > 0 || p.warnings.length > 0) && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() =>
                downloadCsv("Costing standard errors.csv", ["Type", "Sheet", "Row", "Column", "Reason"], [
                  ...p.issues.map((i) => ["Error", i.sheet, i.row, i.column, i.reason]),
                  ...p.warnings.map((i) => ["Warning", i.sheet, i.row, i.column, i.reason]),
                ])
              }
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download error list
            </button>
          )}
          {ok && (
            <>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> No errors.
              </p>
              <div>
                <label className={labelCls} htmlFor="costing-note">
                  What changed (shown in the versions list)
                </label>
                <textarea id="costing-note" rows={2} maxLength={500} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {fileError && <p className="mr-auto text-xs font-medium text-rose-700">{fileError}</p>}
          {!ok && !fileError && <p className="mr-auto text-xs font-medium text-rose-700">Fix the errors in the file and choose it again.</p>}
          <button type="button" className={secondaryButton} onClick={() => fileRef.current?.click()} disabled={preview.isPending || confirm.isPending}>
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Choose another file"}
          </button>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryButton} disabled={!ok || confirm.isPending || preview.isPending} onClick={onConfirm}>
            {confirm.isPending ? "Saving…" : p.editsLatestInPlace ? `Update version ${p.targetVersion}` : `Save version ${p.targetVersion}`}
          </button>
        </div>
        {fileInput}
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Upload costing standard" subtitle="Rates, zone factors, supervision and monitoring, contingency and ceilings, from the workbook" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3 p-5 text-xs text-slate-700">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Download the template. It holds the latest version, so change only what is new.</li>
          <li>Keep each item code: needs assessments refer to the rates by item code.</li>
          <li>
            Choose the filled file. You see what changes before anything is saved. A version a cycle or a needs assessment already uses is never edited: the
            save becomes the next version.
          </li>
        </ol>
        {fileError && <p className="font-medium text-rose-700">{fileError}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <button type="button" className={secondaryButton} disabled={template.isPending} onClick={() => template.mutate()}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download template"}
        </button>
        <button type="button" className={primaryButton} disabled={preview.isPending} onClick={() => fileRef.current?.click()}>
          <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Choose filled file"}
        </button>
      </div>
      {fileInput}
    </ModalShell>
  );
}

function Issues({ items, tone, title }: { items: NeedsFileIssue[]; tone: "error" | "warning"; title: string }) {
  if (items.length === 0) return null;
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"}`} role={tone === "error" ? "alert" : undefined}>
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <Icon className="h-4 w-4" aria-hidden="true" /> {title} ({items.length})
      </p>
      <div className="mt-1 max-h-48 overflow-auto">
        <table className="w-full min-w-[480px] text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide opacity-80">
              <th scope="col" className="py-0.5 pr-2">Sheet</th>
              <th scope="col" className="py-0.5 pr-2">Row</th>
              <th scope="col" className="py-0.5 pr-2">Column</th>
              <th scope="col" className="py-0.5">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={`${i.sheet}-${i.row}-${i.column}-${n}`}>
                <td className="py-0.5 pr-2">{i.sheet}</td>
                <td className="py-0.5 pr-2 tabular-nums">{i.row ?? "–"}</td>
                <td className="py-0.5 pr-2">{i.column ?? "–"}</td>
                <td className="py-0.5">{i.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm font-bold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
