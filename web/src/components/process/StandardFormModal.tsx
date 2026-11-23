import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  ProjectStandardInputSchema,
  STANDARD_CATEGORY_META,
  StandardCategoryEnum,
  STANDARDS_LIBRARY,
  STANDARDS_LIBRARY_DISCLAIMER,
  type ProjectStandardInput,
  type StandardLibraryEntry,
} from "@insite/shared";
import { CustomSelect } from "../common";
import { ModalShell, ModalActions, inputClass } from "../common/ModalShell";

export interface StandardFormValue {
  code: string;
  title: string;
  category: ProjectStandardInput["category"];
  specificationText: string;
  applicableWbsCodesText: string;
  isMandatory: boolean;
}

export const EMPTY_STANDARD: StandardFormValue = {
  code: "",
  title: "",
  category: "GENERAL_SPECIFICATION",
  specificationText: "",
  applicableWbsCodesText: "",
  isMandatory: true,
};

export function formFromLibrary(entry: StandardLibraryEntry): StandardFormValue {
  return {
    code: entry.code,
    title: entry.title,
    category: entry.category,
    specificationText: entry.specificationText,
    applicableWbsCodesText: "",
    isMandatory: entry.isMandatory,
  };
}

const splitCodes = (text: string) =>
  text
    .split(/[,\n;]/)
    .map((c) => c.trim())
    .filter(Boolean);

/** Add or edit a project standard. Library entries arrive pre-filled and stay editable. */
export function StandardFormModal({
  title,
  initial,
  fromLibrary,
  wbsSuggestions,
  isPending,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: StandardFormValue;
  /** Shows the library disclaimer and what the template is based on. */
  fromLibrary?: StandardLibraryEntry | null;
  wbsSuggestions: string[];
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (input: ProjectStandardInput) => Promise<void>;
}) {
  const [form, setForm] = useState<StandardFormValue>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ProjectStandardInputSchema.safeParse({
      code: form.code,
      title: form.title,
      category: form.category,
      specificationText: form.specificationText,
      applicableWbsCodes: splitCodes(form.applicableWbsCodesText),
      isMandatory: form.isMandatory,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    try {
      await onSubmit(parsed.data);
    } catch {
      // The mutation hook shows the error.
    }
  };

  const err = (k: string) => (fieldErrors[k] ? <p className="mt-1 text-[11px] font-medium text-red-600">{fieldErrors[k]}</p> : null);

  return (
    <ModalShell title={title} onClose={onCancel} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {fromLibrary && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold">{STANDARDS_LIBRARY_DISCLAIMER}</p>
              <p className="mt-0.5">Based on: {fromLibrary.basedOn}</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="std-code">
              Code
            </label>
            <input id="std-code" className={inputClass} value={form.code} maxLength={40} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            {err("code")}
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="std-title">
              Title
            </label>
            <input id="std-title" className={inputClass} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            {err("title")}
          </div>
        </div>
        <CustomSelect
          label="Category"
          value={form.category}
          onChange={(v) => setForm({ ...form, category: v })}
          options={StandardCategoryEnum.options.map((c) => ({ value: c, label: STANDARD_CATEGORY_META[c].label }))}
          error={fieldErrors.category}
        />
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="std-text">
            Requirement
          </label>
          <textarea
            id="std-text"
            rows={5}
            className={inputClass}
            value={form.specificationText}
            onChange={(e) => setForm({ ...form, specificationText: e.target.value })}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Write numeric rules as "slump 75 ± 25 mm", "cube strength minimum 25 N/mm²" so the automatic check on reports can read them.
          </p>
          {err("specificationText")}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="std-wbs">
            Applies to WBS codes
          </label>
          <input
            id="std-wbs"
            className={inputClass}
            list="std-wbs-suggestions"
            placeholder="Leave empty for the whole project, e.g. 02, 03.1"
            value={form.applicableWbsCodesText}
            onChange={(e) => setForm({ ...form, applicableWbsCodesText: e.target.value })}
          />
          <datalist id="std-wbs-suggestions">
            {wbsSuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-slate-500">Separate codes with commas. A code covers everything below it ("02" covers "02.03.1").</p>
          {fromLibrary && fromLibrary.suggestedFor.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">Typically used for: {fromLibrary.suggestedFor.join(", ")}.</p>
          )}
          {err("applicableWbsCodes")}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-primary" checked={form.isMandatory} onChange={(e) => setForm({ ...form, isMandatory: e.target.checked })} />
          Mandatory (a failed check on this standard is critical)
        </label>
        <ModalActions onCancel={onCancel} submitLabel="Save standard" pendingLabel="Saving…" isPending={isPending} />
      </form>
    </ModalShell>
  );
}

/** Picks a starting template from the shared starter library. */
export function StandardsLibraryModal({
  existingCodes,
  onCancel,
  onPick,
}: {
  existingCodes: string[];
  onCancel: () => void;
  onPick: (entry: StandardLibraryEntry) => void;
}) {
  return (
    <ModalShell title="Add from the standards library" subtitle="Pick a starting point; you can edit everything before saving." onClose={onCancel} maxWidth="max-w-2xl">
      <div className="p-5 space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <p className="font-semibold">{STANDARDS_LIBRARY_DISCLAIMER}</p>
        </div>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {STANDARDS_LIBRARY.map((entry) => {
            const taken = existingCodes.includes(entry.code);
            return (
              <li key={entry.code} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">
                    <span className="font-mono text-brand-primary">{entry.code}</span> {entry.title}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {STANDARD_CATEGORY_META[entry.category].label} · Based on {entry.basedOn}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600 line-clamp-2">{entry.specificationText}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onPick(entry)}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  title={taken ? "A standard with this code exists; change the code before saving." : undefined}
                >
                  {taken ? "Use (code taken)" : "Use"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </ModalShell>
  );
}
