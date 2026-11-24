import React, { useMemo, useState } from "react";
import type { FacilityArchetype, FormField } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { useLeaveGuard } from "../../lib/navigationGuard";
import { useFormComponentVersionsQuery } from "../../queries/forms/useFormQueries";
import type { FormComponentKind } from "../../api/forms/formsApi";
import { fieldsAreValid, FormFieldsEditor, fromEditorFields, toEditorFields, type EditorField } from "./FormFieldsEditor";
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
  /** Snapshots that use the version being edited: saving creates a new version when above 0. */
  usageCount: number;
  pending: boolean;
  onClose: () => void;
  onSave: (fields: FormField[]) => Promise<unknown>;
}) {
  const [fields, setFields] = useState<EditorField[]>(() => toEditorFields(initialFields));
  const initialJson = useMemo(() => JSON.stringify(initialFields), [initialFields]);
  const dirty = headerDirty || JSON.stringify(fromEditorFields(fields)) !== initialJson;
  const valid = headerValid && fieldsAreValid(fields, context);

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
          <button type="button" className={primaryButton} disabled={pending || !valid || !dirty} onClick={() => void save()}>
            {pending ? "Saving…" : "Save"}
          </button>
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
