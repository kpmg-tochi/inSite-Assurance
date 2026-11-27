import React, { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Trash2, XCircle } from "lucide-react";
import {
  NEEDS_FILE_MAX_BYTES,
  NEEDS_OPEN_PROPOSAL_STATUSES,
  NEEDS_UPLOAD_MAX_FILES,
  NEEDS_UPLOAD_MAX_TOTAL_BYTES,
  type NeedsFileIssue,
  type NeedsUploadFilePreview,
  type NeedsUploadFileResult,
  type NeedsUploadPreviewDto,
  type NeedsUploadResultDto,
} from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common/CustomSelect";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { apiErrorCode, apiErrorDetails } from "../../api/needsPipeline";
import { useConfirmNeedsUploadMutation, usePreviewNeedsUploadMutation, useDownloadCycleTemplateMutation } from "../../mutations/needs/useNeedsMutations";
import { useNeedsProposalsQuery } from "../../queries/needs/useNeedsQueries";
import { FlagChips, NEEDS_FILE_ACCEPT, downloadCsv, formatBytes, locationText, money, plural, readAsBase64 } from "./needsUi";

/**
 * Needs pipeline wave 2 (C4): upload needs assessments (.xlsx, template v2; older scope workbooks at
 * Identification only). Choose one or more files (each optionally a new version of a proposed
 * project) → the server checks every file (nothing saved) → each file shows what it becomes, its
 * issues (sheet, row, column, reason), warnings and the flags it would raise; the error list can be
 * downloaded as CSV → save sends only the valid files, each with the sha256 of its check. A file
 * that changed since the check (409) sends the user back to check again.
 */

interface ChosenFile {
  key: string;
  file: File;
  proposalId: string | null;
  problem: string | null;
}

type Checked = { files: Array<{ fileName: string; fileBase64: string; proposalId: string | null }>; preview: NeedsUploadPreviewDto };

let keySeq = 0;

function clientProblem(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".xlsx")) return "Not an .xlsx file: choose the needs assessment workbook.";
  if (file.size > NEEDS_FILE_MAX_BYTES) return `Larger than ${Math.round(NEEDS_FILE_MAX_BYTES / 1024 / 1024)} MB.`;
  if (file.size === 0) return "The file is empty.";
  return null;
}

/** Per-file results from a 422 NEEDS_FILE_INVALID (the server puts them in the error's details). */
function refusedResults(details: unknown): NeedsUploadFileResult[] | null {
  if (Array.isArray(details)) return details as NeedsUploadFileResult[];
  const files = (details as { files?: unknown } | null)?.files;
  return Array.isArray(files) ? (files as NeedsUploadFileResult[]) : null;
}

export function NeedsUploadDialog({
  cycleId,
  fixedProposal = null,
  onClose,
}: {
  cycleId: string;
  /** Opened from a proposal page: every file is a new version of it (one file). */
  fixedProposal?: { id: string; reference: string; title: string } | null;
  onClose: () => void;
}) {
  const preview = usePreviewNeedsUploadMutation(cycleId);
  const confirm = useConfirmNeedsUploadMutation(cycleId);
  const template = useDownloadCycleTemplateMutation();
  const proposalsQuery = useNeedsProposalsQuery(fixedProposal ? null : cycleId, {});
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<ChosenFile[]>([]);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [result, setResult] = useState<{ files: NeedsUploadFileResult[]; saved: NeedsUploadResultDto | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);

  const maxFiles = fixedProposal ? 1 : NEEDS_UPLOAD_MAX_FILES;
  const versionOptions = useMemo(
    () => [
      { value: "", label: "New proposed project" },
      ...(proposalsQuery.data ?? [])
        .filter((p) => NEEDS_OPEN_PROPOSAL_STATUSES.includes(p.status))
        .map((p) => ({ value: p.id, label: `New version of ${p.reference}`, description: p.title })),
    ],
    [proposalsQuery.data]
  );

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const room = Math.max(0, maxFiles - chosen.length);
    setMessage(incoming.length > room ? `Up to ${plural(maxFiles, "file")} at a time: ${plural(incoming.length - room, "file")} left out.` : null);
    const added = incoming.slice(0, room).map((file) => ({
      key: `f${++keySeq}`,
      file,
      proposalId: fixedProposal?.id ?? null,
      problem: clientProblem(file),
    }));
    setChosen((prev) => [...prev, ...added]);
  };

  const usable = chosen.filter((c) => !c.problem);

  const runCheck = async () => {
    if (usable.length === 0) return;
    if (usable.reduce((sum, c) => sum + c.file.size, 0) > NEEDS_UPLOAD_MAX_TOTAL_BYTES) {
      setMessage(`The files together are larger than ${Math.round(NEEDS_UPLOAD_MAX_TOTAL_BYTES / 1024 / 1024)} MB: check them in smaller groups.`);
      return;
    }
    setMessage(null);
    setReading(true);
    let files: Checked["files"];
    try {
      files = await Promise.all(usable.map(async (c) => ({ fileName: c.file.name, fileBase64: await readAsBase64(c.file), proposalId: c.proposalId })));
    } catch {
      setReading(false);
      setMessage("A file could not be read. Choose it again.");
      return;
    } finally {
      setReading(false);
    }
    preview.mutate({ files }, { onSuccess: (p) => setChecked({ files, preview: p }) });
  };

  const save = () => {
    if (!checked) return;
    const valid = checked.preview.files.filter((f) => f.status === "VALID");
    const files = valid.map((f) => ({ ...checked.files[f.index], sha256: f.sha256 }));
    if (files.length === 0) return;
    confirm.mutate(
      { files },
      {
        onSuccess: (saved) => setResult({ files: saved.files, saved }),
        onError: (err) => {
          const code = apiErrorCode(err);
          if (code === "NEEDS_FILE_CHANGED") {
            setChecked(null);
            setMessage("The files changed since they were checked. Check them again.");
            return;
          }
          if (code === "NEEDS_FILE_INVALID") {
            const files = refusedResults(apiErrorDetails(err));
            if (files) setResult({ files, saved: null });
          }
        },
      }
    );
  };

  const subtitle = fixedProposal ? `New version of ${fixedProposal.reference} · ${fixedProposal.title}` : "One proposed project per file (.xlsx)";

  // ------------------------------------------------------------------ result
  if (result) {
    const saved = result.saved;
    return (
      <ModalShell title="Upload saved" subtitle={subtitle} onClose={onClose} maxWidth="max-w-4xl">
        <div className="space-y-3 p-5">
          {saved ? (
            <p className="text-xs text-slate-700">
              {[
                saved.createdCount ? plural(saved.createdCount, "proposed project") + " created" : null,
                saved.versionCount ? plural(saved.versionCount, "new version") : null,
                saved.refusedCount ? plural(saved.refusedCount, "file") + " refused" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
              <XCircle className="h-4 w-4" aria-hidden="true" /> Nothing was saved: every file has errors.
            </p>
          )}
          <ul className="space-y-2">
            {result.files.map((f) => (
              <ResultRow key={`${f.index}-${f.fileName}`} file={f} />
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" className={primaryButton} onClick={onClose}>
            Done
          </button>
        </div>
      </ModalShell>
    );
  }

  // ------------------------------------------------------------------ checked
  if (checked) {
    const p = checked.preview;
    const anyIssues = p.files.some((f) => f.issues.length > 0 || f.warnings.length > 0);
    return (
      <ModalShell title="Check the needs assessments" subtitle={`${subtitle} · nothing is saved until you save`} onClose={onClose} maxWidth="max-w-5xl">
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {plural(p.validCount, "valid file")}
              </span>
              {p.invalidCount > 0 && (
                <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                  <XCircle className="h-4 w-4" aria-hidden="true" /> {plural(p.invalidCount, "file")} with errors (not saved)
                </span>
              )}
            </p>
            {anyIssues && (
              <button type="button" className={secondaryButton} onClick={() => downloadErrorList(p.files)}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download error list
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {p.files.map((f) => (
              <PreviewRow key={`${f.index}-${f.fileName}`} file={f} />
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {p.validCount === 0 && <p className="mr-auto text-xs font-medium text-rose-700">Fix the errors in the files and check them again.</p>}
          <button type="button" className={secondaryButton} onClick={() => setChecked(null)} disabled={confirm.isPending}>
            Back to the files
          </button>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryButton} disabled={p.validCount === 0 || confirm.isPending} onClick={save}>
            {confirm.isPending ? "Saving…" : `Save ${plural(p.validCount, "valid file")}`}
          </button>
        </div>
      </ModalShell>
    );
  }

  // ------------------------------------------------------------------ choose
  return (
    <ModalShell title={fixedProposal ? "Upload new version" : "Upload needs assessments"} subtitle={subtitle} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-4 p-5 text-sm text-slate-700">
        <ol className="list-decimal space-y-1 pl-5 text-xs">
          <li>
            Fill the needs assessment template: one proposed project per file, with its sites, the intervention and facilities breakdown and, where the stage
            needs it, the BoQ.
          </li>
          <li>Choose the files{fixedProposal ? "" : ` (up to ${NEEDS_UPLOAD_MAX_FILES}, each up to ${Math.round(NEEDS_FILE_MAX_BYTES / 1024 / 1024)} MB, ${Math.round(NEEDS_UPLOAD_MAX_TOTAL_BYTES / 1024 / 1024)} MB together)`}. Each file is checked before anything is saved.</li>
          <li>Files with errors are listed with the sheet, row and column to fix; the valid files can be saved straight away.</li>
        </ol>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`rounded-2xl border-2 border-dashed px-4 py-6 text-center ${dragOver ? "border-brand-primary bg-brand-primary/5" : "border-slate-300 bg-slate-50"}`}
        >
          <FileSpreadsheet className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
          <p className="mt-1 text-xs text-slate-600">Drop .xlsx files here, or</p>
          <button
            type="button"
            className={`${secondaryButton} mt-2`}
            onClick={() => inputRef.current?.click()}
            disabled={chosen.length >= maxFiles}
          >
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Choose {fixedProposal ? "file" : "files"}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple={!fixedProposal}
            accept={NEEDS_FILE_ACCEPT}
            className="hidden"
            aria-label="Needs assessment files (.xlsx)"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {message && (
          <p role="alert" className="text-xs font-medium text-rose-700">
            {message}
          </p>
        )}

        {chosen.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {chosen.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-900" title={c.file.name}>
                    {c.file.name}
                  </p>
                  <p className="text-[11px] text-slate-500">{formatBytes(c.file.size)}</p>
                  {c.problem && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-rose-700">
                      <XCircle className="h-3 w-3" aria-hidden="true" /> {c.problem}
                    </p>
                  )}
                </div>
                {!fixedProposal && !c.problem && (
                  <div className="w-full sm:w-64">
                    <CustomSelect
                      ariaLabel={`What ${c.file.name} is`}
                      value={c.proposalId ?? ""}
                      onChange={(v) => setChosen((prev) => prev.map((x) => (x.key === c.key ? { ...x, proposalId: v || null } : x)))}
                      options={versionOptions}
                      size="sm"
                      searchable={versionOptions.length > 8}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setChosen((prev) => prev.filter((x) => x.key !== c.key))}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  aria-label={`Remove ${c.file.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
        {!fixedProposal && (
          <button type="button" className={`${secondaryButton} mr-auto`} disabled={template.isPending} onClick={() => template.mutate(cycleId)}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download template"}
          </button>
        )}
        <button type="button" className={secondaryButton} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryButton} disabled={usable.length === 0 || reading || preview.isPending} onClick={runCheck}>
          {reading || preview.isPending ? "Checking…" : `Check ${plural(usable.length, "file")}`}
        </button>
      </div>
    </ModalShell>
  );
}

function downloadErrorList(files: NeedsUploadFilePreview[]) {
  const rows: Array<Array<string | number | null>> = [];
  for (const f of files) {
    for (const i of f.issues) rows.push([f.fileName, "Error", i.sheet, i.row, i.column, i.reason]);
    for (const i of f.warnings) rows.push([f.fileName, "Warning", i.sheet, i.row, i.column, i.reason]);
  }
  downloadCsv("Needs assessment upload errors.csv", ["File", "Type", "Sheet", "Row", "Column", "Reason"], rows);
}

function actionText(f: NeedsUploadFilePreview): string {
  if (f.action === "NEW_VERSION") return `New version of ${f.proposalReference ?? "the proposed project"}`;
  return "New proposed project (gets the next reference)";
}

function PreviewRow({ file }: { file: NeedsUploadFilePreview }) {
  const valid = file.status === "VALID";
  const s = file.summary;
  return (
    <li className={`rounded-xl border px-3 py-2 ${valid ? "border-slate-200" : "border-rose-200 bg-rose-50/40"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            {valid ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
            )}
            <span className="sr-only">{valid ? "Valid:" : "Has errors:"}</span>
            <span className="truncate">{file.fileName}</span>
          </p>
          <p className="text-[11px] text-slate-600">
            {actionText(file)}
            {file.templateVersion ? ` · ${file.templateVersion}` : " · no template version found"}
          </p>
        </div>
        <span className={`text-[11px] font-semibold ${valid ? "text-emerald-800" : "text-rose-700"}`}>{valid ? "Valid" : "Not saved"}</span>
      </div>
      {s && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
          <Fact label="Title" value={s.title ?? "–"} wide />
          <Fact label="Location" value={locationText(s.stateCode, s.lgaCodes)} wide />
          <Fact label="Sites" value={String(s.siteCount)} />
          <Fact label="Breakdown rows" value={String(s.breakdownRowCount)} />
          <Fact label="BoQ lines" value={String(s.boqLineCount)} />
          <Fact label="Preliminary cost" value={money(s.preliminaryCostNgn)} />
          <Fact label="Facilities" value={s.facilitiesSummary || "–"} wide />
        </dl>
      )}
      {file.expectedFlags.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          <p className="font-semibold">Flags it will raise</p>
          <ul className="mt-0.5 space-y-0.5">
            {file.expectedFlags.map((fl, i) => (
              <li key={`${fl.kind}-${i}`} className="flex gap-1">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> {fl.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <IssueTable items={file.issues} tone="error" />
      <IssueTable items={file.warnings} tone="warning" />
    </li>
  );
}

function ResultRow({ file }: { file: NeedsUploadFileResult }) {
  const refused = file.outcome === "REFUSED";
  return (
    <li className={`rounded-xl border px-3 py-2 ${refused ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-900">
          {refused ? (
            <XCircle className="h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          )}
          <span className="truncate">{file.fileName}</span>
        </p>
        <span className={`text-[11px] font-semibold ${refused ? "text-rose-700" : "text-emerald-800"}`}>
          {refused
            ? "Refused"
            : file.outcome === "CREATED"
              ? `Created ${file.reference ?? ""}${file.versionNumber ? ` v${file.versionNumber}` : ""}`
              : `${file.reference ?? ""} version ${file.versionNumber ?? ""} added`}
        </span>
      </div>
      {!refused && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          <FlagChips kinds={file.flags.map((f) => f.kind)} empty="No flags" />
          {file.proposalId && (
            <Link to={`/app/needs-assessment/proposals/${file.proposalId}`} className="font-semibold text-brand-primary hover:underline">
              Open {file.reference ?? "the proposed project"}
            </Link>
          )}
        </div>
      )}
      <IssueTable items={file.issues} tone="error" />
    </li>
  );
}

function IssueTable({ items, tone }: { items: NeedsFileIssue[]; tone: "error" | "warning" }) {
  if (items.length === 0) return null;
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div className="mt-2">
      <p className={`flex items-center gap-1 text-[11px] font-bold ${tone === "error" ? "text-rose-700" : "text-amber-800"}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {tone === "error" ? "Errors" : "Warnings"} ({items.length})
      </p>
      <div className="mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label={tone === "error" ? "Errors" : "Warnings"}>
        <table className="w-full min-w-[520px] text-[11px]">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-2 py-1">Sheet</th>
              <th scope="col" className="px-2 py-1">Row</th>
              <th scope="col" className="px-2 py-1">Column</th>
              <th scope="col" className="px-2 py-1">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((i, n) => (
              <tr key={`${i.sheet}-${i.row}-${i.column}-${n}`}>
                <td className="whitespace-nowrap px-2 py-1 text-slate-700">{i.sheet}</td>
                <td className="px-2 py-1 tabular-nums text-slate-700">{i.row ?? "–"}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-700">{i.column ?? "–"}</td>
                <td className="px-2 py-1 text-slate-900">{i.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}
