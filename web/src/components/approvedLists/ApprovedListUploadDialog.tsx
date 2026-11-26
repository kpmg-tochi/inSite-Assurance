import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, XCircle } from "lucide-react";
import {
  APPROVED_LIST_COLUMNS,
  APPROVED_LIST_KIND_LABELS,
  APPROVED_LIST_MAX_BYTES,
  APPROVED_LIST_MAX_ROWS,
  APPROVED_LIST_SHEETS,
  type ApprovedListImportPreviewDto,
  type ApprovedListImportPreviewRow,
  type ApprovedListImportResultDto,
  type ApprovedListIssue,
  type ApprovedListLinkedProject,
} from "@insite/shared";
import {
  approvedListErrorCode,
  useConfirmApprovedListImportMutation,
  useDownloadApprovedListTemplateMutation,
  usePreviewApprovedListImportMutation,
} from "../../mutations/approvedLists";
import { useTerm } from "../../lib/auth-context";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { ModalShell } from "../common/ModalShell";
import { TableBadge, type TableBadgeVariant } from "../table";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { MatchStatusChip, lgaNames, projectLabel, stateName } from "./approvedListUi";

/**
 * Client demo updates E3 (wave 4): upload an approved list (the Approved Projects & Implementation
 * Schedule or a State's Approved BEAP) from the template (.xlsx), `approved_lists:manage`. Choose the
 * file → the server checks it (list header, the list it replaces, every row's action, link and match,
 * the rows removed) → import with the check's sha256. Nothing is saved before import; a file with an
 * error is refused whole. On import the dialog closes and the page selects the saved list.
 */

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

type Pending = { fileBase64: string; fileName: string; preview: ApprovedListImportPreviewDto };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ApprovedListUploadDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** Called with the saved list once the import succeeded (the dialog is closed by the caller). */
  onImported: (result: ApprovedListImportResultDto) => void;
}) {
  const term = useTerm();
  const template = useDownloadApprovedListTemplateMutation();
  const preview = usePreviewApprovedListImportMutation();
  const confirm = useConfirmApprovedListImportMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmIssues, setConfirmIssues] = useState<ApprovedListIssue[]>([]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setFileError("Choose the approved list .xlsx file.");
    if (file.size > APPROVED_LIST_MAX_BYTES) return setFileError(`The file is larger than ${Math.round(APPROVED_LIST_MAX_BYTES / 1024 / 1024)} MB.`);
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
        onSuccess: (r) => onImported(r),
        onError: (err) => {
          const code = approvedListErrorCode(err);
          if (code === "APPROVED_LIST_FILE_CHANGED") {
            setPending(null);
            setFileError("The file changed since it was checked. Choose it again.");
            return;
          }
          const issues = (err as { response?: { data?: { error?: { details?: { issues?: ApprovedListIssue[] } } } } })?.response?.data?.error
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
      aria-label="Approved list file (.xlsx)"
      onChange={onFile}
    />
  );

  if (pending) {
    const p = pending.preview;
    return (
      <ModalShell title="Check the approved list" subtitle={`${pending.fileName} · nothing is saved until you import`} onClose={onClose} maxWidth="max-w-6xl">
        <CheckedFile preview={p} confirmIssues={confirmIssues} />
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          {fileError ? (
            <p className="mr-auto text-xs font-medium text-rose-600">{fileError}</p>
          ) : (
            !p.canConfirm && <p className="mr-auto text-xs font-medium text-rose-600">Fix the errors and upload the file again.</p>
          )}
          <button type="button" className={secondaryButton} onClick={chooseFile} disabled={preview.isPending || confirm.isPending}>
            <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Choose another file"}
          </button>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={!p.canConfirm || confirm.isPending || preview.isPending}
            title={p.canConfirm ? undefined : "Fix the errors and upload the file again."}
            onClick={onConfirm}
          >
            {confirm.isPending ? "Importing…" : `Import list (${plural(p.totals.rowCount, "row")})`}
          </button>
        </div>
        {fileInput}
      </ModalShell>
    );
  }

  const required = APPROVED_LIST_COLUMNS.filter((c) => c.required).map((c) => c.header);
  return (
    <ModalShell
      title="Upload approved list"
      subtitle="The Approved Projects & Implementation Schedule or a State's Approved BEAP, from the template."
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="p-5 space-y-4 text-sm text-slate-700">
        <ol className="list-decimal pl-5 space-y-1.5 text-xs">
          <li>Download the template. One file holds one list: fill the List sheet (intervention year, list, State for a BEAP, title, approved by and on).</li>
          <li>
            Fill one row per approved project on the Rows sheet (up to {APPROVED_LIST_MAX_ROWS}). Required: {required.join(", ")}. The optional Project ID
            column links the row to a project by its code or its {term("externalReference")}; blank keeps the current link.
          </li>
          <li>
            Uploading a list that is already on file (same year, list and State) replaces it: rows are matched by Row ref, so their project links stay;
            rows missing from the file are removed and their projects unlinked.
          </li>
          <li>Choose the filled file. You see what changes before anything is saved.</li>
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

function CheckedFile({ preview, confirmIssues }: { preview: ApprovedListImportPreviewDto; confirmIssues: ApprovedListIssue[] }) {
  const t = preview.totals;
  // Errors outside the Rows sheet (and file-level ones) are listed above the table; row errors sit on their row.
  const isSheetLevel = (i: ApprovedListIssue) => i.row === null || i.sheet !== APPROVED_LIST_SHEETS.rows;
  const sheetIssues = preview.issues.filter(isSheetLevel);
  const sheetWarnings = preview.warnings.filter(isSheetLevel);

  return (
    <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="File check">
      <ListHeader preview={preview} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Tile label="Rows" value={String(t.rowCount)} />
        <Tile label="New" value={String(t.newCount)} />
        <Tile label="Updated" value={String(t.updatedCount)} />
        <Tile label="Unchanged" value={String(t.unchangedCount)} />
        <Tile label="Removed" value={String(t.removedCount)} hint={t.removedCount > 0 ? "Their projects are unlinked" : undefined} alert={t.removedCount > 0} />
        <Tile label="Linked" value={`${t.linkedCount}/${t.rowCount}`} />
        <Tile label="Budget mismatches" value={String(t.mismatchCount)} alert={t.mismatchCount > 0} />
        <Tile label="Total estimate" value={formatNaira(t.totalEstimateNgn)} />
      </div>

      {t.rowsWithErrors > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
          <XCircle className="w-4 h-4" aria-hidden="true" /> {t.rowsWithErrors} row{t.rowsWithErrors === 1 ? " has" : "s have"} errors: fix them in the file and upload it again.
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

      {preview.rows.length > 0 && <RowsTable rows={preview.rows} />}
      {preview.removedRows.length > 0 && <RemovedRows rows={preview.removedRows} />}
    </div>
  );
}

function ListHeader({ preview }: { preview: ApprovedListImportPreviewDto }) {
  const l = preview.list;
  const missing = <span className="text-rose-700">Missing</span>;
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3" aria-label="The list in the file">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {l.kind ? APPROVED_LIST_KIND_LABELS[l.kind] : "List kind missing"}
        {l.kind === "MG_BEAP" && ` · ${l.stateCode ? stateName(l.stateCode) : "State missing"}`}
        {l.interventionYear !== null && ` · Intervention year ${l.interventionYear}`}
      </p>
      <p className="mt-0.5 text-sm font-bold text-slate-900">{l.title || "Untitled list"}</p>
      <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-4">
        <HeaderField label="Intervention year" value={l.interventionYear !== null ? String(l.interventionYear) : missing} />
        <HeaderField label="State" value={l.stateCode ? stateName(l.stateCode) : l.kind === "DI_SCHEDULE" ? "All States" : missing} />
        <HeaderField label="Approved by" value={l.approvedBy || missing} />
        <HeaderField label="Approved on" value={l.approvedOn ? formatDateShort(l.approvedOn) : missing} />
      </dl>
      <p className="mt-2 text-xs text-slate-700">
        {preview.replaces ? (
          <>
            <span className="font-semibold">Replaces {preview.replaces.title}</span> ({plural(preview.replaces.rowCount, "row")}
            {preview.replaces.importedAt ? `, uploaded ${formatDateShort(preview.replaces.importedAt)}` : ""})
          </>
        ) : (
          <span className="font-semibold">New list</span>
        )}
      </p>
    </section>
  );
}

function HeaderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

const ACTION_META: Record<ApprovedListImportPreviewRow["action"], { label: string; variant: TableBadgeVariant }> = {
  NEW: { label: "New", variant: "info" },
  UPDATED: { label: "Updated", variant: "warning" },
  UNCHANGED: { label: "Unchanged", variant: "neutral" },
};

const LINK_SOURCE_HINT: Record<ApprovedListImportPreviewRow["linkSource"], string | null> = {
  KEPT: "Current link kept",
  FROM_FILE: "Linked from the file",
  NONE: null,
};

function RowsTable({ rows }: { rows: ApprovedListImportPreviewRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="Rows in the file">
      <table className="w-full min-w-[1100px] text-xs">
        <caption className="sr-only">Rows in the file and what each one becomes</caption>
        <thead className="bg-slate-50">
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-2 py-1.5">Row</th>
            <th scope="col" className="px-2 py-1.5">Ref</th>
            <th scope="col" className="px-2 py-1.5">Project</th>
            <th scope="col" className="px-2 py-1.5">State · LGAs</th>
            <th scope="col" className="px-2 py-1.5 text-right">Estimate</th>
            <th scope="col" className="px-2 py-1.5">Change</th>
            <th scope="col" className="px-2 py-1.5">Linked projects</th>
            <th scope="col" className="px-2 py-1.5">Match</th>
            <th scope="col" className="px-2 py-1.5">Issues</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.row} className={r.issues.length > 0 ? "bg-rose-50/60" : undefined}>
              <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.row}</td>
              <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-slate-900">{r.rowRef ?? <span className="text-slate-400">–</span>}</td>
              <td className="px-2 py-1.5 text-slate-900">
                <span className="font-semibold">{r.projectTitle || "–"}</span>
                {r.schoolNames.length > 0 && <span className="block text-[11px] text-slate-500">{r.schoolNames.join("; ")}</span>}
                {r.facilityScope && <span className="block text-[11px] text-slate-500">{r.facilityScope}</span>}
              </td>
              <td className="px-2 py-1.5 text-slate-700">
                {r.stateCode ? stateName(r.stateCode) : "–"}
                {r.lgaCodes.length > 0 && <span className="block text-[11px] text-slate-500">{lgaNames(r.lgaCodes)}</span>}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-slate-800">
                {r.costEstimateNgn === null ? "–" : formatNaira(r.costEstimateNgn)}
              </td>
              <td className="px-2 py-1.5">
                <TableBadge variant={ACTION_META[r.action].variant}>{ACTION_META[r.action].label}</TableBadge>
              </td>
              <td className="px-2 py-1.5 min-w-[180px]">
                <LinkedProjectList projects={r.linkedProjects} empty={r.matchStatus === "NOT_LINKED" ? "–" : "Not visible to you"} />
                {LINK_SOURCE_HINT[r.linkSource] && r.matchStatus !== "NOT_LINKED" && (
                  <span className="block text-[10px] text-slate-500">{LINK_SOURCE_HINT[r.linkSource]}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <MatchStatusChip status={r.matchStatus} />
              </td>
              <td className="px-2 py-1.5 min-w-[220px]">
                <RowIssues row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinkedProjectList({ projects, empty }: { projects: ApprovedListLinkedProject[]; empty: string }) {
  if (projects.length === 0) return <span className="text-slate-400">{empty}</span>;
  return (
    <ul className="space-y-1">
      {projects.map((p) => (
        <li key={p.id}>
          <span className="font-mono font-semibold text-slate-800">{projectLabel(p)}</span>
          <span className="block text-[11px] text-slate-600">{p.name}</span>
          {p.mismatch?.flagged && <span className="block text-[11px] text-rose-700">{p.mismatch.summary}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Row messages start "Row 12: …" for other readers; here the row number is already shown beside them. */
function issueText(i: ApprovedListIssue): string {
  return i.row !== null ? i.message.replace(/^Row \d+: /, "") : i.message;
}

function RowIssues({ row }: { row: ApprovedListImportPreviewRow }) {
  if (row.issues.length === 0 && row.warnings.length === 0) return <span className="text-emerald-700">OK</span>;
  return (
    <ul className="space-y-0.5">
      {row.issues.map((i, n) => (
        <li key={`e${n}`} className="flex gap-1 text-rose-700">
          <XCircle className="w-3.5 h-3.5 shrink-0 mt-px" aria-label="Error" />
          <span>
            {i.column ? <span className="font-semibold">{i.column}: </span> : null}
            {issueText(i)}
          </span>
        </li>
      ))}
      {row.warnings.map((i, n) => (
        <li key={`w${n}`} className="flex gap-1 text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-label="Warning" />
          <span>
            {i.column ? <span className="font-semibold">{i.column}: </span> : null}
            {issueText(i)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RemovedRows({ rows }: { rows: ApprovedListImportPreviewDto["removedRows"] }) {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900" aria-labelledby="approved-list-removed">
      <h4 id="approved-list-removed" className="flex items-center gap-1.5 text-xs font-bold">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" /> {plural(rows.length, "row")} not in the file: removed on import
      </h4>
      <ul className="mt-1 divide-y divide-amber-200/70 text-xs">
        {rows.map((r) => (
          <li key={r.rowRef} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
            <span>
              <span className="font-semibold">{r.rowRef}</span> · {r.projectTitle}
            </span>
            <span className="text-[11px]">
              {r.linkedProjects.length === 0
                ? "No linked project"
                : `Unlinks ${r.linkedProjects.map((p) => `${projectLabel(p)} (${p.name})`).join(", ")}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IssueList({ items, tone, title }: { items: ApprovedListIssue[]; tone: "error" | "warning"; title: string }) {
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
            {i.column ? ` · ${i.column}` : ""}: {issueText(i)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${alert ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
