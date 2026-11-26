import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, XCircle } from "lucide-react";
import type { ProjectScopeDto, ScopeWorkbookIssue, ScopeWorkbookPreviewDto } from "@insite/shared";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import {
  useConfirmScopeImportMutation,
  useDownloadScopeWorkbookMutation,
  usePreviewScopeImportMutation,
} from "../../mutations/scope/useScopeMutations";
import { ModalShell } from "../common/ModalShell";
import { TableBadge } from "../table";
import { primaryButton, secondaryButton } from "../contracts/contractUi";

/**
 * Redesign R2c: download the project's needs assessment (.xlsx, pre-filled when the project has data)
 * and import a filled one: file → server preview (grouped lines, row errors, warnings) → confirm.
 * Nothing is saved before confirm. Import is for drafts only.
 */

const MAX_BYTES = 10 * 1024 * 1024;

/** Design refinement (2026-11-26): a secondary tool on the BoQ summary, lighter than an outlined button. */
export const quietButton =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:opacity-50 disabled:cursor-not-allowed";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export function ScopeWorkbookToolbar({ projectId, scope, canEdit }: { projectId: string; scope: ProjectScopeDto; canEdit: boolean }) {
  const download = useDownloadScopeWorkbookMutation(projectId);
  const preview = usePreviewScopeImportMutation(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ fileBase64: string; fileName: string; result: ScopeWorkbookPreviewDto } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const importReason = !canEdit
    ? "You cannot change this project's scope."
    : !scope.importAllowed
      ? "Import is for draft projects. On a live project, change the scope below (every change is audited)."
      : null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setFileError("Choose the needs assessment .xlsx file.");
    if (file.size > MAX_BYTES) return setFileError("The file is larger than 10 MB.");
    setFileError(null);
    const fileBase64 = await readAsBase64(file);
    preview.mutate({ fileBase64, fileName: file.name }, { onSuccess: (result) => setPending({ fileBase64, fileName: file.name, result }) });
  };

  return (
    <>
      {/* Drafts, and imported live projects with no units or lines yet (`importAllowed`, UBEC IRL). The primary tool comes first. */}
      {(scope.projectStatus === "DRAFT" || scope.importAllowed) && (
      <button
        type="button"
        className={`${primaryButton} justify-center`}
        disabled={Boolean(importReason) || preview.isPending}
        title={importReason ?? "Upload a filled needs assessment (.xlsx). You will see a preview before anything is saved."}
        onClick={() => fileRef.current?.click()}
      >
        <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Import needs assessment"}
      </button>
      )}
      <button type="button" className={quietButton} disabled={download.isPending} onClick={() => download.mutate()}>
        <Download className="w-3.5 h-3.5" aria-hidden="true" /> {download.isPending ? "Preparing…" : "Download needs assessment"}
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} />
      {fileError && <p className="w-full text-xs font-medium text-rose-600">{fileError}</p>}
      {pending && (
        <ImportPreviewModal
          projectId={projectId}
          fileBase64={pending.fileBase64}
          fileName={pending.fileName}
          preview={pending.result}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}

function IssueList({ items, tone }: { items: ScopeWorkbookIssue[]; tone: "error" | "warning" }) {
  if (items.length === 0) return null;
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900";
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <Icon className="w-4 h-4" /> {items.length} {tone === "error" ? "error(s): fix them in the file and upload it again" : "warning(s)"}
      </p>
      <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5 text-[11px]">
        {items.map((i, n) => (
          <li key={`${i.sheet}-${i.row}-${i.code}-${n}`}>
            <span className="font-semibold">{i.sheet || "File"}</span>
            {i.column ? ` · ${i.column}` : ""}: {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImportPreviewModal({
  projectId,
  fileBase64,
  fileName,
  preview,
  onClose,
}: {
  projectId: string;
  fileBase64: string;
  fileName: string;
  preview: ScopeWorkbookPreviewDto;
  onClose: () => void;
}) {
  const confirm = useConfirmScopeImportMutation(projectId);
  const t = preview.totals;
  const replacing = preview.replaces.lineCount + preview.replaces.unitCount + preview.replaces.sprintCount > 0;
  const fills = preview.projectChanges.filter((c) => c.action === "FILL");

  return (
    <ModalShell title="Check the needs assessment" subtitle={`${fileName} · nothing is saved until you import`} onClose={onClose} maxWidth="max-w-4xl">
      <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Tile label="Work phases" value={String(t.sprintCount)} />
          <Tile label="Facility units" value={String(t.unitCount)} />
          <Tile label="BoQ lines" value={String(t.lineCount)} />
          <Tile label="Total" value={formatNaira(t.amountNgn)} hint={t.budgetNgn !== null ? `Budget ${formatNaira(t.budgetNgn)}` : undefined} />
        </div>
        <IssueList items={preview.issues} tone="error" />
        <IssueList items={preview.warnings} tone="warning" />
        {preview.canConfirm && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4" /> No errors. Amounts were recomputed as quantity × rate.
          </p>
        )}

        {preview.groups.length > 0 && (
          <section>
            <h4 className="text-xs font-bold text-slate-900 mb-1">Lines by facility and work phase</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-2">Facility</th>
                  <th className="py-1 pr-2">Work phases</th>
                  <th className="py-1 pr-2">Units</th>
                  <th className="py-1 pr-2 text-right">Lines</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.groups.map((g) => (
                  <tr key={`${g.facilityCode}-${g.sprintLabel}`}>
                    <td className="py-1 pr-2 font-semibold text-slate-800">{g.facilityName}</td>
                    <td className="py-1 pr-2">{g.sprintLabel}</td>
                    <td className="py-1 pr-2 font-mono text-[11px]">{g.unitCodes.join(", ")}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{g.lineCount}</td>
                    <td className="py-1 text-right tabular-nums">{formatNaira(g.amountNgn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {preview.sprints.length > 0 && (
          <section>
            <h4 className="text-xs font-bold text-slate-900 mb-1">Work phases</h4>
            <ul className="text-xs text-slate-700 space-y-0.5">
              {preview.sprints.map((s) => (
                <li key={s.number}>
                  <span className="font-semibold">{s.number}. {s.name}</span> · {formatDateShort(s.startDate)} – {formatDateShort(s.endDate)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {preview.projectChanges.length > 0 && (
          <section>
            <h4 className="text-xs font-bold text-slate-900 mb-1">Project sheet</h4>
            <ul className="text-xs text-slate-700 space-y-0.5">
              {preview.projectChanges.map((c) => (
                <li key={c.field} className="flex flex-wrap items-center gap-1.5">
                  <TableBadge variant={c.action === "FILL" ? "info" : c.action === "SAME" ? "neutral" : "warning"}>
                    {c.action === "FILL" ? "Will fill" : c.action === "SAME" ? "Same" : "Kept"}
                  </TableBadge>
                  <span className="font-semibold">{c.label}:</span> <span>{c.workbookValue}</span>
                  {c.action === "KEEP" && <span className="text-slate-500">(project keeps "{c.currentValue}")</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {replacing && (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Confirming replaces this draft's current scope: {preview.replaces.sprintCount} work phase(s), {preview.replaces.unitCount} unit(s) and{" "}
            {preview.replaces.lineCount} line(s).
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
        <button type="button" className={secondaryButton} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={!preview.canConfirm || confirm.isPending}
          onClick={() => confirm.mutate({ fileBase64, fileName, sha256: preview.sha256 }, { onSuccess: onClose })}
        >
          {confirm.isPending ? "Importing…" : fills.length ? `Import and fill ${fills.length} project field(s)` : "Import"}
        </button>
      </div>
    </ModalShell>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
