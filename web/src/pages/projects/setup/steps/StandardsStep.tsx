import React, { useMemo, useRef, useState } from "react";
import { BookOpen, ExternalLink, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import {
  DOCUMENT_MODE_META,
  NEEDS_ASSESSMENT_DOC_TYPE_META,
  NeedsAssessmentDocTypeEnum,
  STANDARD_CATEGORY_META,
  type NeedsAssessmentDocType,
  type NeedsAssessmentDocumentDto,
  type ProjectStandardDto,
  type StandardLibraryEntry,
} from "@insite/shared";
import { useAuth } from "../../../../lib/auth-context";
import { formatDateShort } from "../../../../lib/formatters";
import { CustomSelect } from "../../../../components/common";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../../../../components/table";
import { useConfirmDialog } from "../../../../components/process/ConfirmDialog";
import {
  EMPTY_STANDARD,
  formFromLibrary,
  StandardFormModal,
  StandardsLibraryModal,
  type StandardFormValue,
} from "../../../../components/process/StandardFormModal";
import {
  useNeedsAssessmentsQuery,
  useProjectStandardsQuery,
} from "../../../../queries/process/useProcessQueries";
import { useProjectBoqQuery } from "../../../../queries/boq/useBoqQueries";
import {
  useCreateStandardMutation,
  useDeleteNeedsAssessmentMutation,
  useDeleteStandardMutation,
  useOpenProjectDocumentMutation,
  useUpdateStandardMutation,
  useUploadNeedsAssessmentMutation,
} from "../../../../mutations/process/useProcessMutations";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { extractErrors, inputClass, labelClass, StepSection, useRegisterStep, type StepProps } from "../setupContext";

const MAX_DOC_BYTES = 25 * 1024 * 1024;
const ACCEPT_DOCS = ".pdf,.doc,.docx,.txt,image/jpeg,image/png,image/webp";

type EditorState =
  | { kind: "new"; initial: StandardFormValue; library: StandardLibraryEntry | null }
  | { kind: "edit"; standard: ProjectStandardDto }
  | null;

function formatBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** "Standards and needs assessment" (Phase 7). Data is saved through its own endpoints; saving marks the step reviewed. */
export function StandardsStep({ projectId, setup, readOnly }: StepProps) {
  const { hasPermission } = useAuth();
  const canManage = !readOnly && hasPermission("projects:manage_standards_docs");
  const config = setup.process.config;
  const stepStatus = setup.steps.find((s) => s.stepId === "standards");
  const standardsOn = config.standardsSpecificationMode !== "DISABLED";
  const docsOn = config.needsAssessmentMode !== "DISABLED";

  const standardsQuery = useProjectStandardsQuery(projectId, standardsOn);
  const docsQuery = useNeedsAssessmentsQuery(projectId, docsOn);
  const boqQuery = useProjectBoqQuery(projectId, standardsOn && hasPermission("boq:view"));
  const createStandard = useCreateStandardMutation(projectId);
  const updateStandard = useUpdateStandardMutation(projectId);
  const deleteStandard = useDeleteStandardMutation(projectId);
  const uploadDoc = useUploadNeedsAssessmentMutation(projectId);
  const deleteDoc = useDeleteNeedsAssessmentMutation(projectId);
  const openDoc = useOpenProjectDocumentMutation(projectId);
  const save = useSaveSetupStepMutation(projectId);
  const { ask, dialog } = useConfirmDialog();

  const [editor, setEditor] = useState<EditorState>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Upload form
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState<NeedsAssessmentDocType>("COMMUNITY_NEEDS_ASSESSMENT");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const dirty = Boolean(stepStatus && !stepStatus.saved && setup.status === "DRAFT");
  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    try {
      await save.mutateAsync({ stepId: "standards", body: {}, silent: opts?.silent });
      setSaveError(null);
      return true;
    } catch (err) {
      setSaveError(extractErrors(err).general);
      return false;
    }
  });

  const standards = useMemo(() => standardsQuery.data ?? [], [standardsQuery.data]);
  const docs = docsQuery.data ?? [];
  const wbsSuggestions = useMemo(() => {
    const codes = new Set<string>();
    for (const item of boqQuery.data ?? []) codes.add(item.wbsCode);
    return [...codes].sort();
  }, [boqQuery.data]);

  const standardColumns: TableColumnDef<ProjectStandardDto>[] = [
    {
      id: "code",
      header: "Standard",
      width: "w-72",
      cell: (s) => (
        <div>
          <div className="font-bold text-slate-900">
            <span className="font-mono text-brand-primary">{s.code}</span> {s.title}
          </div>
          <div className="text-[11px] text-slate-500">{STANDARD_CATEGORY_META[s.category].label}</div>
        </div>
      ),
    },
    {
      id: "text",
      header: "Requirement",
      cell: (s) => <p className="text-[11px] text-slate-600 line-clamp-2 max-w-md">{s.specificationText}</p>,
    },
    {
      id: "wbs",
      header: "Applies to",
      width: "w-40",
      cell: (s) =>
        s.applicableWbsCodes.length === 0 ? (
          <span className="text-[11px] text-slate-500">Whole project</span>
        ) : (
          <span className="font-mono text-[11px] text-slate-700">{s.applicableWbsCodes.join(", ")}</span>
        ),
    },
    {
      id: "mandatory",
      header: "Mandatory",
      width: "w-28",
      cell: (s) => <TableBadge variant={s.isMandatory ? "warning" : "neutral"}>{s.isMandatory ? "Mandatory" : "Advisory"}</TableBadge>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "w-40",
      cell: (s) =>
        canManage ? (
          <div className="flex justify-end gap-1.5">
            <TableActionButton icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => setEditor({ kind: "edit", standard: s })}>
              Edit
            </TableActionButton>
            <TableActionButton
              variant="danger"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={async () => {
                const ok = await ask({
                  title: `Delete ${s.code}?`,
                  message: "Briefs and report checks stop using this standard. Reports already checked keep their result.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) deleteStandard.mutate(s.id);
              }}
            >
              Delete
            </TableActionButton>
          </div>
        ) : null,
    },
  ];

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setUploadError("Choose a file.");
    if (file.size > MAX_DOC_BYTES) return setUploadError("The file is larger than 25 MB.");
    if (docTitle.trim().length < 3) return setUploadError("Give the document a title (at least 3 characters).");
    setUploadError(null);
    try {
      await uploadDoc.mutateAsync({ file, title: docTitle.trim(), documentType: docType });
      setFile(null);
      setDocTitle("");
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      // Toast from the mutation hook.
    }
  };

  const docColumns: TableColumnDef<NeedsAssessmentDocumentDto>[] = [
    {
      id: "title",
      header: "Document",
      width: "w-64",
      cell: (d) => (
        <div>
          <div className="font-bold text-slate-900">{d.title}</div>
          <div className="text-[11px] text-slate-500">
            {NEEDS_ASSESSMENT_DOC_TYPE_META[d.documentType].label} · {formatBytes(d.byteSize)} · {formatDateShort(d.uploadedAt)}
          </div>
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "w-40",
      cell: (d) => (
        <div className="flex justify-end gap-1.5">
          <TableActionButton icon={<ExternalLink className="w-3.5 h-3.5" />} onClick={() => openDoc.mutate(d.objectKey)}>
            Open
          </TableActionButton>
          {canManage && (
            <TableActionButton
              variant="danger"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={async () => {
                const ok = await ask({ title: `Delete "${d.title}"?`, message: "The file is removed from the project.", confirmLabel: "Delete", danger: true });
                if (ok) deleteDoc.mutate(d.id);
              }}
            >
              Delete
            </TableActionButton>
          )}
        </div>
      ),
    },
  ];

  const requirementBadge = (mode: typeof config.standardsSpecificationMode) => (
    <TableBadge variant={mode === "REQUIRED_AT_CREATION" ? "warning" : mode === "DISABLED" ? "neutral" : "info"}>
      {DOCUMENT_MODE_META[mode].label}
    </TableBadge>
  );

  if (!stepStatus) {
    return (
      <StepSection title="Standards and needs assessment">
        <p className="text-xs text-slate-600">
          Standards and needs-assessment documents are both turned off in this project's process settings.
        </p>
      </StepSection>
    );
  }

  return (
    <>
      {dialog}
      <StepSection
        title="Standards and needs assessment"
        description="Standards are passed to field briefs and used to check submitted reports. Needs-assessment documents record why the project exists."
      >
        {saveError && <p className="text-xs font-medium text-red-600">{saveError}</p>}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">Standards: {requirementBadge(config.standardsSpecificationMode)}</span>
          <span className="inline-flex items-center gap-1.5">Needs assessment: {requirementBadge(config.needsAssessmentMode)}</span>
          <span>{stepStatus.required ? "This step must be complete before activation." : "This step is optional."}</span>
        </div>
        {stepStatus.issues.filter((i) => i.code !== "STEP_NOT_SAVED").length > 0 && (
          <ul className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 list-disc pl-6">
            {stepStatus.issues
              .filter((i) => i.code !== "STEP_NOT_SAVED")
              .map((i) => (
                <li key={i.code}>{i.message}</li>
              ))}
          </ul>
        )}
        {!canManage && !readOnly && (
          <p className="text-[11px] text-slate-500">You can view standards and documents; changing them needs the "manage standards and documents" permission.</p>
        )}
      </StepSection>

      {standardsOn && (
        <StandardTable
          title="Project standards"
          subtitle="Empty WBS list means the standard applies to the whole project."
          headerActions={
            canManage ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                >
                  <BookOpen className="w-3.5 h-3.5" /> Add from library
                </button>
                <button
                  type="button"
                  onClick={() => setEditor({ kind: "new", initial: EMPTY_STANDARD, library: null })}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
                >
                  <Plus className="w-3.5 h-3.5" /> Add standard
                </button>
              </div>
            ) : undefined
          }
          columns={standardColumns}
          data={standards}
          keyExtractor={(s) => s.id}
          loading={standardsQuery.isLoading}
          emptyState={{ title: "No standards yet", description: "Add a standard, or start from the library." }}
        />
      )}

      {docsOn && (
        <div className="space-y-3">
          {canManage && (
            <form onSubmit={handleUpload} className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-slate-900">Upload a needs-assessment document</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className={labelClass} htmlFor="na-file">
                    File (PDF, Word, text or image, up to 25 MB)
                  </label>
                  <input
                    id="na-file"
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT_DOCS}
                    className="block w-full text-xs text-slate-700 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFile(f);
                      if (f && !docTitle) setDocTitle(f.name.replace(/\.[^.]+$/, ""));
                    }}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="na-title">
                    Title
                  </label>
                  <input id="na-title" className={inputClass()} value={docTitle} maxLength={200} onChange={(e) => setDocTitle(e.target.value)} />
                </div>
                <CustomSelect
                  label="Document type"
                  value={docType}
                  onChange={setDocType}
                  options={NeedsAssessmentDocTypeEnum.options.map((t) => ({ value: t, label: NEEDS_ASSESSMENT_DOC_TYPE_META[t].label }))}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500">PDF, Word or image, up to 25 MB.</span>
                <button
                  type="submit"
                  disabled={uploadDoc.isPending || !file}
                  className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                >
                  <FileUp className="w-3.5 h-3.5" /> {uploadDoc.isPending ? "Uploading…" : "Upload"}
                </button>
              </div>
              {uploadError && <p className="text-[11px] font-medium text-red-600">{uploadError}</p>}
            </form>
          )}
          <StandardTable
            title="Needs-assessment documents"
            columns={docColumns}
            data={docs}
            keyExtractor={(d) => d.id}
            loading={docsQuery.isLoading}
            emptyState={{ title: "No documents yet", description: canManage ? "Upload the first document above." : undefined }}
          />
        </div>
      )}

      {libraryOpen && (
        <StandardsLibraryModal
          existingCodes={standards.map((s) => s.code)}
          onCancel={() => setLibraryOpen(false)}
          onPick={(entry) => {
            setLibraryOpen(false);
            setEditor({ kind: "new", initial: formFromLibrary(entry), library: entry });
          }}
        />
      )}
      {editor?.kind === "new" && (
        <StandardFormModal
          title={editor.library ? `Add ${editor.library.code} from the library` : "Add a standard"}
          initial={editor.initial}
          fromLibrary={editor.library}
          wbsSuggestions={wbsSuggestions}
          isPending={createStandard.isPending}
          onCancel={() => setEditor(null)}
          onSubmit={async (input) => {
            await createStandard.mutateAsync(input);
            setEditor(null);
          }}
        />
      )}
      {editor?.kind === "edit" && (
        <StandardFormModal
          title={`Edit ${editor.standard.code}`}
          initial={{
            code: editor.standard.code,
            title: editor.standard.title,
            category: editor.standard.category,
            specificationText: editor.standard.specificationText,
            applicableWbsCodesText: editor.standard.applicableWbsCodes.join(", "),
            isMandatory: editor.standard.isMandatory,
          }}
          wbsSuggestions={wbsSuggestions}
          isPending={updateStandard.isPending}
          onCancel={() => setEditor(null)}
          onSubmit={async (input) => {
            await updateStandard.mutateAsync({ standardId: editor.standard.id, body: input });
            setEditor(null);
          }}
        />
      )}
    </>
  );
}
