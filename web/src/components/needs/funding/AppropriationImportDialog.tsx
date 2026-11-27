import React, { useRef, useState } from "react";
import { z } from "zod";
import { CheckCircle2, Download, FileUp, XCircle } from "lucide-react";
import {
  APPROPRIATED_SCHEDULE_COLUMNS,
  type AppropriationIssue,
  type AppropriationPreviewDto,
  type AppropriationPreviewRow,
  type AppropriationResultDto,
  type AppropriationRowOutcome,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { TableBadge, type TableBadgeVariant } from "../../table";
import { primaryButton, secondaryButton } from "../../contracts/contractUi";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zDateText } from "../../../lib/forms";
import { apiErrorCode, apiErrorDetails } from "../../../api/needsPipeline";
import {
  useConfirmAppropriationMutation,
  useDownloadAppropriationTemplateMutation,
  usePreviewAppropriationMutation,
} from "../../../mutations/needs/useFundingMutations";
import { NEEDS_FILE_ACCEPT, inputCls, labelCls, money, plural, readAsBase64, todayInTenant } from "../needsUi";
import { Figure, ProjectCodeLink, ProposalLink } from "./fundingUi";

/**
 * Needs pipeline wave 4 (C3): import the appropriated schedule (Direct Intervention). Download the
 * template → fill one row per funded proposed project (its reference) → the server checks the file and
 * says per row what happens (funded in full, partly funded, an approved out-of-cycle request, refused)
 * and which proposals at Funding are not in it (not funded: they close as "Not selected" and can be
 * carried into the next cycle) → with the appropriation date, confirm (the check's sha256): the funded
 * proposals become draft projects and the schedule is saved as the year's approved list. The person
 * who approved the portfolio cannot confirm (`cannotConfirmReason`, 409 SAME_PERSON_FUNDING).
 */

const MAX_BYTES = 5 * 1024 * 1024;

type Checked = { fileName: string; fileBase64: string; preview: AppropriationPreviewDto };

const OUTCOME_META: Record<AppropriationRowOutcome, { label: string; variant: TableBadgeVariant }> = {
  MATCHED: { label: "Funded", variant: "success" },
  PARTLY_FUNDED: { label: "Partly funded", variant: "warning" },
  OUT_OF_CYCLE: { label: "Out-of-cycle", variant: "info" },
  REFUSED: { label: "Refused", variant: "danger" },
};

const DateSchema = z.object({ appropriatedOn: zDateText("Appropriation date") });

/** Issues from a refused confirm (422): an array, or `{ issues }`. */
function confirmIssuesOf(err: unknown): AppropriationIssue[] {
  const d = apiErrorDetails(err);
  if (Array.isArray(d)) return d as AppropriationIssue[];
  const issues = (d as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as AppropriationIssue[]) : [];
}

export function AppropriationImportDialog({
  cycleId,
  cannotConfirmReason,
  onClose,
}: {
  cycleId: string;
  cannotConfirmReason: string | null;
  onClose: () => void;
}) {
  const template = useDownloadAppropriationTemplateMutation(cycleId);
  const preview = usePreviewAppropriationMutation(cycleId);
  const confirm = useConfirmAppropriationMutation(cycleId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [result, setResult] = useState<AppropriationResultDto | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmIssues, setConfirmIssues] = useState<AppropriationIssue[]>([]);
  const today = todayInTenant();
  const form = useZodForm(DateSchema, { defaultValues: { appropriatedOn: "" } });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setFileError("Choose the appropriated schedule .xlsx file.");
    if (file.size > MAX_BYTES) return setFileError(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
    setFileError(null);
    setConfirmIssues([]);
    let fileBase64: string;
    try {
      fileBase64 = await readAsBase64(file);
    } catch {
      return setFileError("The file could not be read. Try again.");
    }
    preview.mutate({ fileName: file.name, fileBase64 }, { onSuccess: (p) => setChecked({ fileName: file.name, fileBase64, preview: p }) });
  };

  const onConfirm = form.handleSubmit(({ appropriatedOn }) => {
    if (!checked) return;
    confirm.mutate(
      { fileName: checked.fileName, fileBase64: checked.fileBase64, sha256: checked.preview.sha256, appropriatedOn },
      {
        onSuccess: (r) => setResult(r),
        onError: (err) => {
          if (apiErrorCode(err) === "NEEDS_FILE_CHANGED") {
            setChecked(null);
            setFileError("The file changed since it was checked. Choose it again.");
            return;
          }
          setConfirmIssues(confirmIssuesOf(err));
        },
      }
    );
  });

  const chooseFile = () => fileRef.current?.click();
  const fileInput = <input ref={fileRef} type="file" accept={NEEDS_FILE_ACCEPT} className="hidden" aria-label="Appropriated schedule (.xlsx)" onChange={onFile} />;

  if (result) {
    return (
      <ModalShell title="Appropriation recorded" subtitle={result.fundingRecord.fileName ?? undefined} onClose={onClose} maxWidth="max-w-3xl">
        <div className="space-y-3 p-5 text-xs text-slate-700">
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {plural(result.converted.length, "draft project")} created.
            {result.notSelected.length > 0 && ` ${plural(result.notSelected.length, "proposed project")} not funded.`}
          </p>
          <p>Give the projects their lots and batches on the Procurement plan tab. The schedule is also saved under Approved lists.</p>
          {result.converted.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {result.converted.map((c) => (
                <li key={c.projectId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
                  <span>
                    <ProposalLink proposalId={c.proposalId} reference={c.reference} /> → <ProjectCodeLink projectId={c.projectId} code={c.projectCode} />
                  </span>
                  <span className="tabular-nums text-slate-800">{money(c.fundedAmountNgn)}</span>
                </li>
              ))}
            </ul>
          )}
          {result.notSelected.length > 0 && (
            <p className="text-slate-600">Not funded (can be carried into the next cycle): {result.notSelected.map((n) => n.reference).join(", ")}.</p>
          )}
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button type="button" className={primaryButton} onClick={onClose}>
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  if (checked) {
    const p = checked.preview;
    const blockedReason = cannotConfirmReason ?? (!p.canConfirm ? "Fix the errors in the file and choose it again." : null);
    return (
      <ModalShell title="Check the appropriated schedule" subtitle={`${checked.fileName} · nothing is saved until you confirm`} onClose={onClose} maxWidth="max-w-6xl">
        <form noValidate onSubmit={onConfirm}>
          <CheckedSchedule preview={p} confirmIssues={confirmIssues} />
          <div className="flex flex-wrap items-end justify-end gap-3 border-t border-slate-100 px-5 py-3">
            <div className="mr-auto w-56">
              <label className={labelCls} htmlFor="appropriated-on">
                Appropriation date <span className="text-rose-600">*</span>
              </label>
              <input
                id="appropriated-on"
                type="date"
                max={today}
                className={`${inputCls} ${invalidClass(form, "appropriatedOn")}`}
                {...form.register("appropriatedOn")}
                {...fieldA11y(form, "appropriatedOn")}
              />
              <FieldError form={form} name="appropriatedOn" />
            </div>
            {fileError && <p className="text-xs font-medium text-rose-700">{fileError}</p>}
            <button type="button" className={secondaryButton} onClick={chooseFile} disabled={preview.isPending || confirm.isPending}>
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Choose another file"}
            </button>
            <button type="button" className={secondaryButton} onClick={onClose}>
              Cancel
            </button>
            <SubmitButton
              form={form}
              pending={confirm.isPending}
              pendingLabel="Converting…"
              blocked={Boolean(blockedReason)}
              hint={blockedReason ?? "Enter the appropriation date."}
            >
              Confirm the appropriation ({plural(p.totals.matched + p.totals.partlyFunded, "new project")})
            </SubmitButton>
          </div>
          {blockedReason && form.formState.isValid && <p className="px-5 pb-3 text-right text-[11px] font-medium text-rose-700">{blockedReason}</p>}
        </form>
        {fileInput}
      </ModalShell>
    );
  }

  const required = APPROPRIATED_SCHEDULE_COLUMNS.filter((c) => c.required).map((c) => c.header);
  return (
    <ModalShell title="Import appropriated schedule" subtitle="The projects the appropriation funds, from the template" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3 p-5 text-xs text-slate-700">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Download the template. It is the approved list workbook with a Proposal reference column (e.g. 2027-DI-014).</li>
          <li>Fill one row per funded proposed project. Required: {required.join(", ")}. A cost below the approved amount means partly funded.</li>
          <li>Proposed projects at Funding that are not in the file are not funded: they close as "Not selected" and can be carried into the next cycle.</li>
          <li>Choose the filled file. You see every row's outcome before anything is saved.</li>
        </ol>
        {cannotConfirmReason && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            {cannotConfirmReason} You can check the file, but another person must confirm it.
          </p>
        )}
        {fileError && <p className="font-medium text-rose-700">{fileError}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <button type="button" className={secondaryButton} disabled={template.isPending} onClick={() => template.mutate()}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download template"}
        </button>
        <button type="button" className={primaryButton} disabled={preview.isPending} onClick={chooseFile}>
          <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {preview.isPending ? "Reading…" : "Choose filled file"}
        </button>
      </div>
      {fileInput}
    </ModalShell>
  );
}

function CheckedSchedule({ preview, confirmIssues }: { preview: AppropriationPreviewDto; confirmIssues: AppropriationIssue[] }) {
  const t = preview.totals;
  return (
    <div
      className="max-h-[62vh] space-y-4 overflow-y-auto p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
      tabIndex={0}
      role="region"
      aria-label="File check"
    >
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Funded" value={String(t.matched)} tone={t.matched > 0 ? "good" : undefined} />
        <Figure label="Partly funded" value={String(t.partlyFunded)} />
        <Figure label="Out-of-cycle" value={String(t.outOfCycle)} />
        <Figure label="Refused rows" value={String(t.refused)} tone={t.refused > 0 ? "alert" : undefined} />
        <Figure label="Not funded" value={String(t.notFunded)} hint="Carried forward" />
        <Figure label="Funded total" value={money(t.fundedNgn)} />
      </div>
      <IssueBox title="The confirm was refused" items={confirmIssues} />
      <IssueBox title="File errors" items={preview.issues} />
      {preview.canConfirm && confirmIssues.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> No errors. Check the rows, enter the appropriation date and confirm.
        </p>
      )}
      {preview.rows.length > 0 && <RowsTable rows={preview.rows} />}
      {preview.notFunded.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" aria-labelledby="appropriation-not-funded">
          <h4 id="appropriation-not-funded" className="text-xs font-bold text-slate-900">
            Not funded, carried forward ({preview.notFunded.length})
          </h4>
          <p className="text-[11px] text-slate-600">These proposed projects at Funding are not in the file. On confirm they close as "Not selected"; the next cycle can carry them forward.</p>
          <ul className="mt-1 divide-y divide-slate-200 text-xs">
            {preview.notFunded.map((n) => (
              <li key={n.proposalId} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span>
                  <ProposalLink proposalId={n.proposalId} reference={n.reference} /> · {n.title}
                </span>
                <span className="tabular-nums text-slate-700">Approved {money(n.approvedAmountNgn)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RowsTable({ rows }: { rows: AppropriationPreviewRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="Rows in the file">
      <table className="w-full min-w-[960px] text-xs">
        <caption className="sr-only">Rows in the file and the outcome of each</caption>
        <thead className="bg-slate-50">
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-2 py-1.5">Row</th>
            <th scope="col" className="px-2 py-1.5">Ref</th>
            <th scope="col" className="px-2 py-1.5">Proposed project</th>
            <th scope="col" className="px-2 py-1.5 text-right">Approved</th>
            <th scope="col" className="px-2 py-1.5 text-right">Funded</th>
            <th scope="col" className="px-2 py-1.5">Outcome</th>
            <th scope="col" className="px-2 py-1.5">Issues</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.rowNumber} className={r.outcome === "REFUSED" ? "bg-rose-50/60" : undefined}>
              <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.rowNumber}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-900">{r.rowRef || "–"}</td>
              <td className="px-2 py-1.5 text-slate-900">
                {r.proposalId && r.proposalReference ? (
                  <ProposalLink proposalId={r.proposalId} reference={r.proposalReference} />
                ) : (
                  <span className="font-semibold">{r.proposalReference ?? "No reference"}</span>
                )}
                <span className="block text-[11px] text-slate-600">{r.title || "–"}</span>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-700">{money(r.approvedAmountNgn)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-900">{money(r.fundedAmountNgn)}</td>
              <td className="px-2 py-1.5">
                <TableBadge variant={OUTCOME_META[r.outcome].variant}>{OUTCOME_META[r.outcome].label}</TableBadge>
              </td>
              <td className="min-w-[220px] px-2 py-1.5">
                {r.issues.length === 0 ? (
                  <span className="text-emerald-700">OK</span>
                ) : (
                  <ul className="space-y-0.5">
                    {r.issues.map((i, n) => (
                      <li key={`${i.code}-${n}`} className="flex gap-1 text-rose-700">
                        <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-label="Error" />
                        <span>
                          {i.column ? <span className="font-semibold">{i.column}: </span> : null}
                          {i.message.replace(/^Row \d+: /, "")}
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
  );
}

function IssueBox({ title, items }: { title: string; items: AppropriationIssue[] }) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <XCircle className="h-4 w-4" aria-hidden="true" /> {title} ({items.length})
      </p>
      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
        {items.map((i, n) => (
          <li key={`${i.code}-${i.row}-${n}`}>
            {i.row !== null && <span className="font-semibold">Row {i.row}</span>}
            {i.column ? ` · ${i.column}` : ""}
            {i.row !== null || i.column ? ": " : ""}
            {i.message.replace(/^Row \d+: /, "")}
          </li>
        ))}
      </ul>
    </div>
  );
}
