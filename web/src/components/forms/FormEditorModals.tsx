import React, { useMemo, useState } from "react";
import { FormFieldSchema, validateFormFields, type FacilityArchetype, type FormField } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { useLeaveGuard } from "../../lib/navigationGuard";
import { useFormComponentVersionsQuery } from "../../queries/forms/useFormQueries";
import type { FormComponentKind } from "../../api/forms/formsApi";
import { FormFieldsEditor, fromEditorFields, toEditorFields, type EditorField } from "./FormFieldsEditor";
import { formatDateTimeShort } from "../../lib/formatters";

/**
 * Redesign R3: modal shells for editing a component's fields (with the unsaved-changes guard) and for
 * a component's version history.
 */

export function FieldsEditorModal({
  title,
  subtitle,
  context,
  initialFields,
  previewFacility,
  header,
  headerValid = true,
  headerDirty = false,
  headerIssue,
  requestIssues,
  usageCount,
  pending,
  onClose,
  onSave,
}: {
  title: string;
  subtitle?: React.ReactNode;
  context: "SECTION" | "SUBFORM";
  initialFields: FormField[];
  previewFacility?: { name: string; pluralName?: string | null; archetype: FacilityArchetype };
  /** Extra inputs above the fields (section code and title). */
  header?: React.ReactNode;
  headerValid?: boolean;
  headerDirty?: boolean;
  /** Shown next to Save while the header inputs are invalid. */
  headerIssue?: string;
  /** The whole save request against its shared schema; messages of what it would refuse. */
  requestIssues?: (fields: FormField[]) => string[];
  /** Snapshots that use the version being edited: saving creates a new version when above 0. */
  usageCount: number;
  pending: boolean;
  onClose: () => void;
  onSave: (fields: FormField[]) => Promise<unknown>;
}) {
  const [fields, setFields] = useState<EditorField[]>(() => toEditorFields(initialFields));
  const initialJson = useMemo(() => JSON.stringify(initialFields), [initialFields]);
  const plain = useMemo(() => fromEditorFields(fields), [fields]);
  const dirty = headerDirty || JSON.stringify(plain) !== initialJson;
  // Validated as you edit, with the rules the server runs (shared validateFormFields and schemas).
  const fieldIssues = useMemo(() => {
    const out: string[] = [];
    if (plain.length === 0) out.push("Add at least one question.");
    for (const i of validateFormFields(plain, { context })) out.push(`Question ${i.index + 1}: ${i.message}`);
    plain.forEach((f, index) => {
      const parsed = FormFieldSchema.safeParse(f);
      if (!parsed.success) out.push(`Question ${index + 1}: ${parsed.error.issues[0]?.message ?? "check this question"}`);
    });
    return out;
  }, [plain, context]);
  const contractIssues = requestIssues ? requestIssues(plain) : [];
  const valid = headerValid && fieldIssues.length === 0 && contractIssues.length === 0;
  const firstIssue = !headerValid ? headerIssue ?? "Complete the fields above." : fieldIssues[0] ?? contractIssues[0];
  const issueCount = (headerValid ? 0 : 1) + fieldIssues.length + (fieldIssues.length ? 0 : contractIssues.length);

  const save = async () => {
    if (!valid) return false;
    try {
      await onSave(fromEditorFields(fields));
      return true;
    } catch {
      return false;
    }
  };
  useLeaveGuard(dirty ? { label: title, save } : null);

  const close = () => {
    if (dirty && !window.confirm("Discard the unsaved changes?")) return;
    onClose();
  };

  return (
    <ModalShell title={title} subtitle={subtitle} onClose={close} maxWidth="max-w-4xl">
      <div className="p-5 space-y-4">
        {header}
        <FormFieldsEditor fields={fields} onChange={setFields} context={context} previewFacility={previewFacility} />
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          {usageCount > 0 && <p className="mr-auto text-[11px] text-slate-500">Used by {usageCount} built form(s): saving creates a new version; those forms keep theirs.</p>}
          <button type="button" className={secondaryButton} onClick={close}>
            Cancel
          </button>
          <span className="inline-flex flex-col items-end gap-1">
            <button
              type="button"
              className={primaryButton}
              disabled={pending || !valid || !dirty}
              aria-describedby={!valid ? "fields-editor-save-hint" : undefined}
              onClick={() => void save()}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {!valid && firstIssue && (
              <span id="fields-editor-save-hint" className="max-w-sm text-right text-[11px] text-slate-500">
                Fix to save: {firstIssue}
                {issueCount > 1 && ` (+${issueCount - 1} more)`}
              </span>
            )}
          </span>
        </div>
      </div>
    </ModalShell>
  );
}

export function VersionsModal({ kind, componentKey, title, onClose }: { kind: FormComponentKind; componentKey: string; title: string; onClose: () => void }) {
  const q = useFormComponentVersionsQuery(kind, componentKey);
  return (
    <ModalShell title={`Versions: ${title}`} onClose={onClose} maxWidth="max-w-md">
      <div className="p-5">
        {q.isLoading && <p className="text-xs text-slate-500">Loading…</p>}
        <ul className="divide-y divide-slate-100">
          {(q.data ?? []).map((v) => (
            <li key={v.id} className="py-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">
                Version {v.version}
                {v.isLatest ? " (latest)" : ""}
                {v.isArchived ? " · archived" : ""}
              </span>
              <span className="text-slate-500">
                {v.usageCount === 0 ? "not used yet" : `used by ${v.usageCount} form${v.usageCount === 1 ? "" : "s"}`} · {formatDateTimeShort(v.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ModalShell>
  );
}
