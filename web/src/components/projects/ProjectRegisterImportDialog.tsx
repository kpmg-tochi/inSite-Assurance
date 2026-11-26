import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, XCircle } from "lucide-react";
import {
  formatProjectCode,
  PROJECT_REGISTER_IMPORT_STATUS_LABELS,
  PROJECT_REGISTER_MAX_BYTES,
  PROJECT_REGISTER_MAX_ROWS,
  type ProjectRegisterImportPreviewDto,
  type ProjectRegisterImportResultDto,
  type ProjectRegisterIssue,
} from "@insite/shared";
import { useTerm } from "../../lib/auth-context";
import { useGuardedNavigate } from "../../lib/navigationGuard";
import {
  registerErrorCode,
  useConfirmProjectRegisterImportMutation,
  useDownloadProjectRegisterTemplateMutation,
  usePreviewProjectRegisterImportMutation,
} from "../../mutations/projects/useProjectRegisterMutations";
import { ModalShell } from "../common/ModalShell";
import { TableBadge } from "../table";
import { primaryButton, secondaryButton } from "../contracts/contractUi";

/**
 * UBEC IRL: import existing projects into the register from the template (.xlsx). Choose the file →
 * server preview (what each row becomes, row errors and warnings) → confirm with the preview's
 * sha256. Nothing is saved before confirm. Projects not started become drafts; ongoing and completed
 * ones become live imported projects.
 */

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

type Pending = { fileBase64: string; fileName: string; preview: ProjectRegisterImportPreviewDto };

export function ProjectRegisterImportDialog({ onClose }: { onClose: () => void }) {
  const template = useDownloadProjectRegisterTemplateMutation();
  const preview = usePreviewProjectRegisterImportMutation();
  const confirm = useConfirmProjectRegisterImportMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmIssues, setConfirmIssues] = useState<ProjectRegisterIssue[]>([]);
  const [result, setResult] = useState<ProjectRegisterImportResultDto | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setFileError("Choose the project register .xlsx file.");
    if (file.size > PROJECT_REGISTER_MAX_BYTES) return setFileError(`The file is larger than ${Math.round(PROJECT_REGISTER_MAX_BYTES / 1024 / 1024)} MB.`);
    setFileError(null);
    setConfirmIssues([]);
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
      { fileBase64: pending.fileBase64, fileName: pending.fileName, sha256: pending.preview.sha256 },
      {
        onSuccess: (r) => setResult(r),
        onError: (err) => {
          const code = registerErrorCode(err);
          if (code === "PROJECT_REGISTER_FILE_CHANGED") {
            setPending(null);
            setFileError("The file changed since the preview. Choose it again.");
            return;
          }
          const issues = (err as { response?: { data?: { error?: { details?: { issues?: ProjectRegisterIssue[] } } } } })?.response?.data?.error
            ?.details?.issues;
          setConfirmIssues(issues ?? []);
        },
      }
    );
  };

  const chooseFile = () => fileRef.current?.click();
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      className="hidden"
      aria-label="Project register file (.xlsx)"
      onChange={onFile}
    />
  );

  if (result) {
    return (
      <ModalShell title="Projects imported" subtitle="They are in the register now." onClose={onClose} maxWidth="max-w-2xl">
        <ImportResult result={result} onClose={onClose} />
      </ModalShell>
    );
  }

  if (pending) {
    return (
      <ModalShell title="Check the project register" subtitle={`${pending.fileName} · nothing is saved until you confirm`} onClose={onClose} maxWidth="max-w-6xl">
        <PreviewBody preview={pending.preview} confirmIssues={confirmIssues} />
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          {fileError && <p className="mr-auto text-xs font-medium text-rose-600">{fileError}</p>}
          <button type="button" className={secondaryButton} onClick={chooseFile} disabled={preview.isPending || confirm.isPending}>
            <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Choose another file"}
          </button>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={!pending.preview.canConfirm || confirm.isPending || preview.isPending}
            title={pending.preview.canConfirm ? undefined : "Fix the errors in the file and choose it again."}
            onClick={onConfirm}
          >
            {confirm.isPending ? "Importing…" : `Import ${pending.preview.totals.rowCount} project${pending.preview.totals.rowCount === 1 ? "" : "s"}`}
          </button>
        </div>
        {fileInput}
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Import projects" subtitle="Add existing projects to the register from a spreadsheet." onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-5 space-y-4 text-sm text-slate-700">
        <ol className="list-decimal pl-5 space-y-1.5 text-xs">
          <li>Download the template. It has the workspace's states, project types and owners as lists.</li>
          <li>Fill one row per project (up to {PROJECT_REGISTER_MAX_ROWS}). Leave Status blank for projects not started yet: they become drafts you finish setting up.</li>
          <li>Ongoing and completed projects become live projects with the progress you report. It is replaced by verified progress once their scope is added.</li>
          <li>Choose the filled file. You see a preview before anything is saved.</li>
        </ol>
        {fileError && <p className="text-xs font-medium text-rose-600">{fileError}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-slate-100">
        <button type="button" className={secondaryButton} disabled={template.isPending} onClick={() => template.mutate()}>
          <Download className="w-3.5 h-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download template"}
        </button>
        <button type="button" className={primaryButton} disabled={preview.isPending} onClick={chooseFile}>
          <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Choose filled file"}
        </button>
      </div>
      {fileInput}
    </ModalShell>
  );
}

function PreviewBody({ preview, confirmIssues }: { preview: ProjectRegisterImportPreviewDto; confirmIssues: ProjectRegisterIssue[] }) {
  const term = useTerm();
  const t = preview.totals;
  // Sheet-level errors (no row) are listed above the table; row errors sit on their row.
  const sheetIssues = preview.issues.filter((i) => i.row === null);
  const sheetWarnings = preview.warnings.filter((i) => i.row === null);

  return (
    <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="File check">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Tile label="Projects" value={String(t.rowCount)} />
        <Tile label="Drafts (not started)" value={String(t.draftCount)} />
        <Tile label="Live (ongoing or completed)" value={String(t.liveCount)} />
        <Tile label="New contractors" value={String(t.newContractorCount)} hint="Added to the organisations" />
      </div>
      {t.rowsWithErrors > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
          <XCircle className="w-4 h-4" aria-hidden="true" /> {t.rowsWithErrors} row{t.rowsWithErrors === 1 ? " has" : "s have"} errors: fix them in the file and choose it again.
        </p>
      )}
      <IssueList items={confirmIssues} tone="error" title="The import was refused" />
      <IssueList items={sheetIssues} tone="error" title="File errors" />
      <IssueList items={sheetWarnings} tone="warning" title="File warnings" />
      {preview.canConfirm && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> No errors. Check the rows, then import.
        </p>
      )}

      {preview.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="Rows in the file">
          <table className="w-full min-w-[1000px] text-xs">
            <caption className="sr-only">Rows in the file and what each one becomes</caption>
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-2 py-1.5">Row</th>
                <th scope="col" className="px-2 py-1.5">Code</th>
                <th scope="col" className="px-2 py-1.5">{term("externalReference")}</th>
                <th scope="col" className="px-2 py-1.5">Name</th>
                <th scope="col" className="px-2 py-1.5">State</th>
                <th scope="col" className="px-2 py-1.5">Type</th>
                <th scope="col" className="px-2 py-1.5">Contractor</th>
                <th scope="col" className="px-2 py-1.5">Status</th>
                <th scope="col" className="px-2 py-1.5 text-right">% complete</th>
                <th scope="col" className="px-2 py-1.5">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.rows.map((r) => (
                <tr key={r.row} className={r.issues.length > 0 ? "bg-rose-50/60" : undefined}>
                  <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.row}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.code ? <span className="font-mono font-semibold text-slate-800">{formatProjectCode(r.code)}</span> : <span className="text-slate-400">–</span>}
                    {r.code && r.codeAssigned && (
                      <span className="ml-1 text-[10px] font-semibold text-slate-500" title="The file's code was blank or already used: the next free code is given.">
                        (auto)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-700">{r.externalReference ?? "–"}</td>
                  <td className="px-2 py-1.5 text-slate-900">
                    <span className="font-semibold">{r.name || "–"}</span>
                    {r.school && <span className="block text-[11px] text-slate-500">{r.school}</span>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-700">
                    {r.regionName ?? "–"}
                    {r.lga && <span className="text-slate-500"> · {r.lga}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">{r.projectTypeName ?? "–"}</td>
                  <td className="px-2 py-1.5 text-slate-700">
                    {r.contractorName ?? "–"}
                    {r.contractorIsNew && (
                      <span className="ml-1">
                        <TableBadge variant="info">New</TableBadge>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="text-slate-800">{PROJECT_REGISTER_IMPORT_STATUS_LABELS[r.status]}</span>
                    <span className="block text-[10px] text-slate-500">{r.mode === "DRAFT" ? "Draft" : "Live"}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{r.percentComplete === null ? "–" : `${r.percentComplete}%`}</td>
                  <td className="px-2 py-1.5 min-w-[220px]">
                    {r.issues.length === 0 && r.warnings.length === 0 ? (
                      <span className="text-emerald-700">OK</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.issues.map((i, n) => (
                          <li key={`e${n}`} className="flex gap-1 text-rose-700">
                            <XCircle className="w-3.5 h-3.5 shrink-0 mt-px" aria-label="Error" />
                            <span>
                              {i.column ? <span className="font-semibold">{i.column}: </span> : null}
                              {i.message}
                            </span>
                          </li>
                        ))}
                        {r.warnings.map((i, n) => (
                          <li key={`w${n}`} className="flex gap-1 text-amber-800">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-label="Warning" />
                            <span>
                              {i.column ? <span className="font-semibold">{i.column}: </span> : null}
                              {i.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImportResult({ result, onClose }: { result: ProjectRegisterImportResultDto; onClose: () => void }) {
  const navigate = useGuardedNavigate();
  const open = (id: string, mode: "DRAFT" | "LIVE") => {
    onClose();
    navigate(mode === "DRAFT" ? `/app/projects/${id}/setup/review` : `/app/projects/${id}/dashboard`);
  };
  return (
    <>
      <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Tile label="Live projects" value={String(result.liveCount)} hint="Add their scope to replace the reported progress" />
          <Tile label="Drafts" value={String(result.draftCount)} hint="Finish their setup, then make them active" />
        </div>
        {result.created.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs">
            {result.created.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-mono font-semibold text-slate-700">{formatProjectCode(c.code)}</span> <span className="text-slate-900">{c.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => open(c.id, c.mode)}
                  className="shrink-0 rounded text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                >
                  {c.mode === "DRAFT" ? "Continue setup" : "Open"}
                  <span className="sr-only"> {formatProjectCode(c.code)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end px-5 py-3 border-t border-slate-100">
        <button type="button" className={primaryButton} onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

function IssueList({ items, tone, title }: { items: ProjectRegisterIssue[]; tone: "error" | "warning"; title: string }) {
  if (items.length === 0) return null;
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900";
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`} role={tone === "error" ? "alert" : undefined}>
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <Icon className="w-4 h-4" aria-hidden="true" /> {title} ({items.length})
      </p>
      <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5 text-[11px]">
        {items.map((i, n) => (
          <li key={`${i.sheet}-${i.row}-${i.code}-${n}`}>
            <span className="font-semibold">
              {i.sheet || "File"}
              {i.row !== null ? ` row ${i.row}` : ""}
            </span>
            {i.column ? ` · ${i.column}` : ""}: {i.message}
          </li>
        ))}
      </ul>
    </div>
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
