import React, { useRef, useState } from "react";
import { Download, FilePlus2, FileSpreadsheet, FileUp, XCircle } from "lucide-react";
import type { NeedsAssessmentPreviewDto } from "@insite/shared";
import { apiErrorOf, NOT_NEEDS_ASSESSMENT_TEMPLATE } from "../../api/needsAssessment";
import { usePreviewNeedsAssessmentMutation } from "../../mutations/needsAssessment";
import { useDownloadTenantScopeWorkbookMutation } from "../../mutations/scope/useScopeMutations";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { NeedsAssessmentPreviewDialog } from "./NeedsAssessmentPreviewDialog";
import { NEEDS_ASSESSMENT_MAX_BYTES, readFileAsBase64 } from "./needsAssessmentParts";

/**
 * Client demo updates D1 (wave 2): the two ways to start a project. "Upload needs assessment"
 * (primary) reads the UBEC template on the server and opens the check dialog; "Start without one"
 * shows the project details form.
 */
export function NeedsAssessmentStart({
  onStartWithout,
  onCreated,
}: {
  onStartWithout: () => void;
  onCreated: (projectId: string) => void;
}) {
  const preview = usePreviewNeedsAssessmentMutation();
  const download = useDownloadTenantScopeWorkbookMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ fileBase64: string; fileName: string; result: NeedsAssessmentPreviewDto } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notTemplate, setNotTemplate] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNotTemplate(null);
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setFileError("Choose the needs assessment .xlsx file.");
    if (file.size > NEEDS_ASSESSMENT_MAX_BYTES) return setFileError("The file is larger than 10 MB.");
    setFileError(null);
    let fileBase64: string;
    try {
      fileBase64 = await readFileAsBase64(file);
    } catch {
      return setFileError("The file could not be read. Try again.");
    }
    preview.mutate(
      { fileBase64, fileName: file.name },
      {
        onSuccess: (result) => setPending({ fileBase64, fileName: file.name, result }),
        onError: (err) => {
          const body = apiErrorOf(err);
          if (body.code === NOT_NEEDS_ASSESSMENT_TEMPLATE) {
            setNotTemplate(body.message || "This file is not the UBEC needs assessment template: download the template, or start without one");
          }
        },
      }
    );
  };

  const downloadButton = (
    <button type="button" className={secondaryButton} disabled={download.isPending} onClick={() => download.mutate()}>
      <Download className="w-3.5 h-3.5" aria-hidden="true" /> {download.isPending ? "Preparing…" : "Download template"}
    </button>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <section
        aria-labelledby="na-upload-title"
        className="lg:col-span-2 bg-white rounded-2xl border-2 border-brand-primary/30 p-5 shadow-sm space-y-3"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
            <FileSpreadsheet className="w-5 h-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="na-upload-title" className="text-sm font-bold text-slate-900">
              Upload needs assessment
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              The filled UBEC needs assessment template sets up the project, its sites, facility units, BoQ and work phases. You check
              what was read and give anything missing. Nothing is saved until you confirm.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={primaryButton} disabled={preview.isPending} onClick={() => fileRef.current?.click()}>
            <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> {preview.isPending ? "Reading the file…" : "Upload needs assessment (.xlsx)"}
          </button>
          {downloadButton}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            aria-label="Needs assessment file"
            onChange={onFile}
          />
        </div>
        <p className="text-[11px] text-slate-500">Excel file, up to 10 MB. Use the template: other files cannot be read.</p>
        {fileError && (
          <p role="alert" className="text-xs font-medium text-rose-600">
            {fileError}
          </p>
        )}
        {notTemplate && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900 space-y-2">
            <p className="flex items-start gap-1.5 font-semibold">
              <XCircle className="mt-0.5 w-4 h-4 shrink-0" aria-hidden="true" /> {notTemplate}
            </p>
            <div className="flex flex-wrap gap-2">
              {downloadButton}
              <button type="button" className={secondaryButton} onClick={onStartWithout}>
                Start without one
              </button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="na-blank-title" className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <FilePlus2 className="w-5 h-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="na-blank-title" className="text-sm font-bold text-slate-900">
              Start without one
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Enter the project details yourself. You can add the sites, BoQ and work phases in the next steps.
            </p>
          </div>
        </div>
        <button type="button" className={secondaryButton} onClick={onStartWithout}>
          Start without one
        </button>
      </section>

      {pending && (
        <NeedsAssessmentPreviewDialog
          fileBase64={pending.fileBase64}
          fileName={pending.fileName}
          preview={pending.result}
          onClose={() => setPending(null)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
