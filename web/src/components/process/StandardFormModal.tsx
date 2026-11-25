import { z } from "zod";
import { Controller } from "react-hook-form";
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
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm, visibleError } from "../../lib/forms";
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

/** The modal's inputs, mapped to ProjectStandardInputSchema (which still decides). */
const StandardFormSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a code, e.g. NIS 444"),
    title: z.string().trim().min(3, "Enter a title (at least 3 characters)"),
    category: StandardCategoryEnum,
    specificationText: z.string().trim().min(10, "Describe the requirement (at least 10 characters)"),
    applicableWbsCodesText: z.string(),
    isMandatory: z.boolean(),
  })
  .transform((v) => ({
    code: v.code,
    title: v.title,
    category: v.category,
    specificationText: v.specificationText,
    applicableWbsCodes: splitCodes(v.applicableWbsCodesText),
    isMandatory: v.isMandatory,
  }))
  .pipe(ProjectStandardInputSchema);

/** Add or edit a project standard. Library entries arrive pre-filled and stay editable. */
export function StandardFormModal({
  title,
  initial,
  fromLibrary,
  itemSuggestions,
  isPending,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: StandardFormValue;
  /** Shows the library disclaimer and what the template is based on. */
  fromLibrary?: StandardLibraryEntry | null;
  /** Item numbers of the project's BoQ lines. */
  itemSuggestions: string[];
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (input: ProjectStandardInput) => Promise<void>;
}) {
  const form = useZodForm(StandardFormSchema, { defaultValues: initial });
  const { register } = form;

  const handleSubmit = form.handleSubmit(async (input) => {
    try {
      await onSubmit(input);
    } catch {
      // The mutation hook shows the error.
    }
  });

  // The BoQ item list is one text field; the contract's per-item issues are shown under it.
  const itemsError = (form.formState.errors as Record<string, { message?: string } | undefined>).applicableWbsCodes;
  const err = (k: "code" | "title" | "specificationText") => <FieldError form={form} name={k} className="text-[11px]" />;

  return (
    <ModalShell title={title} onClose={onCancel} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} noValidate className="p-5 space-y-4">
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
            <input id="std-code" className={`${inputClass} ${invalidClass(form, "code")}`} maxLength={40} {...register("code")} {...fieldA11y(form, "code")} />
            {err("code")}
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="std-title">
              Title
            </label>
            <input id="std-title" className={`${inputClass} ${invalidClass(form, "title")}`} maxLength={200} {...register("title")} {...fieldA11y(form, "title")} />
            {err("title")}
          </div>
        </div>
        <Controller
          control={form.control}
          name="category"
          render={({ field }) => (
            <CustomSelect
              label="Category"
              value={field.value}
              onChange={field.onChange}
              options={StandardCategoryEnum.options.map((c) => ({ value: c, label: STANDARD_CATEGORY_META[c].label }))}
              error={visibleError(form, "category")}
            />
          )}
        />
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="std-text">
            Requirement
          </label>
          <textarea
            id="std-text"
            rows={5}
            className={`${inputClass} ${invalidClass(form, "specificationText")}`}
            {...register("specificationText")}
            {...fieldA11y(form, "specificationText")}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Write numeric rules in full, e.g. "slump 75 ± 25 mm", "cube strength minimum 25 N/mm²".
          </p>
          {err("specificationText")}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="std-items">
            Applies to BoQ item nos.
          </label>
          <input
            id="std-items"
            className={inputClass}
            list="std-items-suggestions"
            placeholder="Leave empty for the whole project, e.g. 02, 03.1"
            {...register("applicableWbsCodesText")}
          />
          <datalist id="std-items-suggestions">
            {itemSuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-slate-500">Separate item nos. with commas. A number covers everything below it ("02" covers "02.03.1").</p>
          {fromLibrary && fromLibrary.suggestedFor.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">Typically used for: {fromLibrary.suggestedFor.join(", ")}.</p>
          )}
          {itemsError && form.formState.dirtyFields.applicableWbsCodesText && (
            <p className="mt-1 text-[11px] font-medium text-red-600">
              {itemsError.message ?? "Each item no. must be 1 to 40 characters, at most 200 items."}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-primary" {...register("isMandatory")} />
          Mandatory (otherwise advisory)
        </label>
        <ModalActions onCancel={onCancel} submitLabel="Save standard" pendingLabel="Saving…" isPending={isPending} disabled={!canSubmit(form)} />
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
