import React, { useMemo, useState } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import {
  formatDateShort,
  formatNaira,
} from "../../lib/formatters";
import {
  formatLotBatch,
  FUNDING_SOURCES,
  LOT_TITLE_MAX,
  NIGERIA_STATES,
  SCHOOL_LEVEL_LABELS,
  type FundingSourceCode,
  type LotChoice,
  type NeedsAssessmentConfirmRequest,
  type NeedsAssessmentFieldKey,
  type NeedsAssessmentFieldValue,
  type NeedsAssessmentPreviewDto,
  type ProjectTypeDto,
  type ScopeWorkbookIssue,
} from "@insite/shared";
import { apiErrorOf, NEEDS_ASSESSMENT_INPUT_REQUIRED } from "../../api/needsAssessment";
import { useConfirmNeedsAssessmentMutation } from "../../mutations/needsAssessment";
import { useProjectTypesQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { useProjectLotsQuery } from "../../queries/projectLots";
import { CustomSelect } from "../common";
import { ModalShell } from "../common/ModalShell";
import { TableBadge } from "../table";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { IssueList, Tile } from "./needsAssessmentParts";

/**
 * Client demo updates D1 (wave 2): what the needs assessment will create, before anything is saved.
 * Each field is tagged "From needs assessment" (filled from the template) or "Needs your input";
 * the person gives the missing ones (and may change the others) here; the values sent win over the
 * file. Confirm creates the draft with its sites, facility units, BoQ and work phases.
 */

/** Fields the person can give or change before confirm (the confirm `overrides`). */
const EDITABLE_KEYS = ["name", "projectTypeId", "interventionYear", "lot", "stateCode", "fundingSourceCode", "totalBudgetNgn"] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];
const isEditable = (key: NeedsAssessmentFieldKey): key is EditableKey => (EDITABLE_KEYS as readonly string[]).includes(key);

/** Lot select values besides a lot id. */
const FILE_LOT = "__file";
const NEW_LOT = "new";

const NO_TYPES: ProjectTypeDto[] = [];

const inputCls = (hasError: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary disabled:bg-slate-50 ${
    hasError ? "border-rose-400" : "border-slate-300"
  }`;

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s₦]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** What wizard-only fields need, when the file left them out. */
const WIZARD_HINT: Partial<Record<NeedsAssessmentFieldKey, string>> = {
  lgaCode: "Add it in the wizard once the draft is created.",
  description: "Add it in the wizard once the draft is created.",
  strategicJustification: "Add it in the wizard once the draft is created.",
  assumptions: "Add it in the wizard once the draft is created.",
  sites: "Add the sites in the wizard once the draft is created.",
  scope: "The BoQ has no lines: add them in BoQ & work phases once the draft is created.",
};

export function NeedsAssessmentPreviewDialog({
  fileBase64,
  fileName,
  preview,
  onClose,
  onCreated,
}: {
  fileBase64: string;
  fileName: string;
  preview: NeedsAssessmentPreviewDto;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const confirm = useConfirmNeedsAssessmentMutation();
  const types = useProjectTypesQuery(false).data ?? NO_TYPES;

  const fieldOf = (key: NeedsAssessmentFieldKey): NeedsAssessmentFieldValue | undefined => preview.fields.find((f) => f.key === key);
  const fileYearValue = fieldOf("interventionYear")?.value;
  const fileYear = typeof fileYearValue === "number" ? fileYearValue : null;
  const lotField = fieldOf("lot");
  const fileLotTitle = typeof lotField?.value === "string" && !lotField.needsInput ? lotField.value : null;
  const lotsQuery = useProjectLotsQuery(fileYear);

  const initialValues = useMemo((): Record<EditableKey, string> => {
    const text = (key: NeedsAssessmentFieldKey) => {
      const v = preview.fields.find((f) => f.key === key)?.value;
      return v === null || v === undefined ? "" : String(v);
    };
    return {
      name: text("name"),
      projectTypeId: text("projectTypeId"),
      interventionYear: text("interventionYear"),
      lot: fileLotTitle ? FILE_LOT : "",
      stateCode: text("stateCode"),
      fundingSourceCode: text("fundingSourceCode"),
      totalBudgetNgn: text("totalBudgetNgn"),
    };
  }, [preview, fileLotTitle]);

  // Fields that need input start open; the others open on "Change".
  const [editing, setEditing] = useState<Set<EditableKey>>(
    () => new Set(EDITABLE_KEYS.filter((k) => preview.fields.find((f) => f.key === k)?.needsInput))
  );
  const [values, setValues] = useState<Record<EditableKey, string>>(initialValues);
  const [newLotTitle, setNewLotTitle] = useState("");
  const [serverErrors, setServerErrors] = useState<Partial<Record<EditableKey, string>>>({});
  const [confirmIssues, setConfirmIssues] = useState<ScopeWorkbookIssue[]>([]);

  const typeRequired = types.length > 0;
  const setValue = (key: EditableKey, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setServerErrors((e) => ({ ...e, [key]: undefined }));
  };
  const startEditing = (key: EditableKey) => setEditing((s) => new Set(s).add(key));
  const revertToFile = (key: EditableKey) => {
    setEditing((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
    setValue(key, initialValues[key]);
  };

  // Effective values: the person's input when the field is open, else the file's.
  const year = editing.has("interventionYear") ? Number(values.interventionYear) || null : fileYear;
  const yearDto = year ? lotsQuery.data?.years.find((y) => y.interventionYear === year) : undefined;
  const lotSel = editing.has("lot") ? values.lot : fileLotTitle ? FILE_LOT : "";
  const budgetValue = fieldOf("totalBudgetNgn")?.value;
  const budget = editing.has("totalBudgetNgn") ? parseAmount(values.totalBudgetNgn) : typeof budgetValue === "number" ? budgetValue : null;

  const codePreview = useMemo(() => {
    if (!year) return null;
    if (lotSel === FILE_LOT) {
      if (year === fileYear && preview.codePreview) return preview.codePreview;
      if (!fileLotTitle || !yearDto) return null;
      const match = yearDto.lots.find((l) => l.title.trim().toLowerCase() === fileLotTitle.trim().toLowerCase());
      return match ? formatLotBatch(match.number, match.nextBatchNumber) : formatLotBatch(yearDto.nextLotNumber, 1);
    }
    if (lotSel === NEW_LOT) return yearDto ? formatLotBatch(yearDto.nextLotNumber, 1) : null;
    const lot = yearDto?.lots.find((l) => l.id === lotSel);
    return lot ? formatLotBatch(lot.number, lot.nextBatchNumber) : null;
  }, [year, lotSel, fileYear, fileLotTitle, yearDto, preview.codePreview]);

  /** Input problems of an open field ("" = fine); a closed field is checked against the file. */
  const inputError = (key: EditableKey): string | null => {
    const v = values[key].trim();
    switch (key) {
      case "name":
        return v.length < 3 ? "Enter the project name (at least 3 characters)" : null;
      case "projectTypeId":
        return typeRequired && !v ? "Choose the delivery model" : null;
      case "interventionYear":
        return !v ? "Choose the intervention year" : null;
      case "lot":
        if (!v) return "Choose a lot, or New lot";
        if (v === NEW_LOT) {
          const t = newLotTitle.trim();
          if (t.length < 3) return "Enter the lot title, e.g. Renovation of Public Schools";
          if (t.length > LOT_TITLE_MAX) return `At most ${LOT_TITLE_MAX} characters`;
        }
        return null;
      case "totalBudgetNgn": {
        const n = parseAmount(v);
        return n === null || n <= 0 ? "Enter the budget (more than 0)" : null;
      }
      default:
        return null;
    }
  };
  const requiredKeys: EditableKey[] = ["name", ...(typeRequired ? (["projectTypeId"] as const) : []), "interventionYear", "lot", "totalBudgetNgn"];
  const missing = requiredKeys.filter((key) => {
    if (editing.has(key)) return inputError(key) !== null;
    const f = fieldOf(key);
    return !f || f.value === null || f.needsInput;
  });

  const buildOverrides = (): NeedsAssessmentConfirmRequest["overrides"] => {
    const o: NeedsAssessmentConfirmRequest["overrides"] = {};
    if (editing.has("name") && values.name.trim()) o.name = values.name.trim();
    if (editing.has("projectTypeId") && values.projectTypeId) o.projectTypeId = values.projectTypeId;
    if (editing.has("interventionYear") && values.interventionYear) o.interventionYear = Number(values.interventionYear);
    if (editing.has("lot") && values.lot && values.lot !== FILE_LOT) {
      const choice: LotChoice = values.lot === NEW_LOT ? { newLotTitle: newLotTitle.trim() } : { lotId: values.lot };
      o.lotChoice = choice;
    }
    if (editing.has("stateCode") && values.stateCode) o.stateCode = values.stateCode;
    if (editing.has("fundingSourceCode") && values.fundingSourceCode) o.fundingSourceCode = values.fundingSourceCode as FundingSourceCode;
    if (editing.has("totalBudgetNgn")) {
      const n = parseAmount(values.totalBudgetNgn);
      if (n !== null && n > 0) o.totalBudgetNgn = n;
    }
    return o;
  };

  const submit = () => {
    setConfirmIssues([]);
    confirm.mutate(
      { fileBase64, fileName, sha256: preview.sha256, overrides: buildOverrides() },
      {
        onSuccess: (result) => onCreated(result.projectId),
        onError: (err) => {
          const body = apiErrorOf(err);
          const details = (body.details ?? {}) as { missing?: NeedsAssessmentFieldKey[]; issues?: ScopeWorkbookIssue[] };
          if (body.code === NEEDS_ASSESSMENT_INPUT_REQUIRED) {
            const keys = (details.missing ?? []).filter(isEditable);
            setEditing((s) => new Set([...s, ...keys]));
            setServerErrors((e) => ({ ...e, ...Object.fromEntries(keys.map((k) => [k, "Give a value before creating the draft"])) }));
          } else if (body.code === "INTERVENTION_YEAR_NOT_ALLOWED") {
            startEditing("interventionYear");
            setServerErrors((e) => ({ ...e, interventionYear: body.message ?? "This year is not allowed" }));
          } else if (body.code === "LOT_NOT_FOUND") {
            startEditing("lot");
            setValue("lot", "");
            setServerErrors((e) => ({ ...e, lot: body.message ?? "That lot no longer exists: choose another" }));
          } else if (Array.isArray(details.issues)) {
            setConfirmIssues(details.issues);
          }
        },
      }
    );
  };

  const yearOptions = (lotsQuery.data?.allowedInterventionYears ?? []).map((y) => ({ value: String(y), label: String(y) }));
  const lotOptions = [
    ...(fileLotTitle ? [{ value: FILE_LOT, label: `As in the file: ${fileLotTitle}` }] : []),
    ...(yearDto?.lots ?? []).map((l) => ({
      value: l.id,
      label: `LOT ${l.number} · ${l.title} · ${l.projectCount} ${l.projectCount === 1 ? "project" : "projects"}`,
    })),
    { value: NEW_LOT, label: "New lot…" },
  ];

  const renderInput = (key: EditableKey) => {
    // An empty field is listed beside Create draft; a typed value that does not pass is shown here.
    const typed = key === "lot" ? values.lot === NEW_LOT && newLotTitle.trim() !== "" : values[key].trim() !== "";
    const err = serverErrors[key] ?? (typed ? inputError(key) : null) ?? undefined;
    const id = `na-${key}`;
    switch (key) {
      case "name":
        return (
          <>
            <input
              id={id}
              aria-label="Project name"
              maxLength={200}
              className={inputCls(Boolean(err))}
              value={values.name}
              onChange={(e) => setValue("name", e.target.value)}
            />
            {err && <p className="mt-1 text-[11px] font-medium text-rose-600">{err}</p>}
          </>
        );
      case "projectTypeId":
        return (
          <CustomSelect
            value={values.projectTypeId}
            onChange={(v) => setValue("projectTypeId", v)}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Choose the delivery model"
            ariaLabel="Delivery model"
            error={err}
          />
        );
      case "interventionYear":
        return (
          <CustomSelect
            value={values.interventionYear}
            onChange={(v) => {
              setValue("interventionYear", v);
              // A lot belongs to one year: another year drops a chosen existing lot.
              if (values.lot && values.lot !== FILE_LOT && values.lot !== NEW_LOT) setValue("lot", fileLotTitle ? FILE_LOT : "");
            }}
            options={yearOptions}
            placeholder={lotsQuery.isLoading ? "Loading…" : "Choose the year"}
            ariaLabel="Intervention year"
            error={err}
          />
        );
      case "lot":
        return (
          <div className="space-y-2">
            <CustomSelect
              value={values.lot}
              onChange={(v) => setValue("lot", v)}
              options={lotOptions}
              placeholder={!year ? "Choose the intervention year first" : lotsQuery.isLoading ? "Loading…" : "Choose a lot"}
              ariaLabel="Lot"
              searchable={(yearDto?.lots.length ?? 0) > 8}
              disabled={!year || lotsQuery.isLoading}
              error={values.lot === NEW_LOT ? serverErrors.lot : err}
            />
            {values.lot === NEW_LOT && (
              <div>
                <input
                  id={id}
                  aria-label="Lot title"
                  maxLength={LOT_TITLE_MAX}
                  placeholder="Lot title, e.g. Renovation, Equipment and Furnishings of Public Schools"
                  className={inputCls(Boolean(err))}
                  value={newLotTitle}
                  onChange={(e) => setNewLotTitle(e.target.value)}
                />
                {err && <p className="mt-1 text-[11px] font-medium text-rose-600">{err}</p>}
              </div>
            )}
            {lotsQuery.isError && <p className="text-[11px] text-rose-600">The lots could not be loaded. Close and upload the file again.</p>}
          </div>
        );
      case "stateCode":
        return (
          <CustomSelect
            value={values.stateCode}
            onChange={(v) => setValue("stateCode", v)}
            options={NIGERIA_STATES.map((s) => ({ value: s.code, label: s.name }))}
            placeholder="Choose the state"
            ariaLabel="State"
            searchable
            error={err}
          />
        );
      case "fundingSourceCode":
        return (
          <CustomSelect
            value={values.fundingSourceCode}
            onChange={(v) => setValue("fundingSourceCode", v)}
            options={FUNDING_SOURCES.map((f) => ({ value: f.code, label: f.label }))}
            placeholder="Choose the funding source"
            ariaLabel="Funding source"
            error={err}
          />
        );
      case "totalBudgetNgn": {
        const n = parseAmount(values.totalBudgetNgn);
        return (
          <>
            <input
              id={id}
              aria-label="Budget"
              inputMode="decimal"
              className={inputCls(Boolean(err))}
              value={values.totalBudgetNgn}
              onChange={(e) => setValue("totalBudgetNgn", e.target.value)}
            />
            {err ? (
              <p className="mt-1 text-[11px] font-medium text-rose-600">{err}</p>
            ) : (
              n !== null && n > 0 && <p className="mt-1 text-[11px] text-slate-500">{formatNaira(n)}</p>
            )}
          </>
        );
      }
    }
  };

  const required = new Set<NeedsAssessmentFieldKey>(requiredKeys);
  const scope = preview.scope;
  const t = scope.totals;
  const overBudget = budget !== null && t.amountNgn > budget;
  const hasIssues = !preview.canConfirm || preview.issues.length > 0;
  const blockedReason = hasIssues
    ? "Fix the errors in the file and upload it again."
    : missing.length > 0
      ? `Still needed: ${missing.map((k) => fieldOf(k)?.label ?? k).join(", ")}.`
      : null;

  return (
    <ModalShell
      title="Check the needs assessment"
      subtitle={`${fileName} · nothing is saved until you create the draft`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="p-5 space-y-5 max-h-[72vh] overflow-y-auto">
        <IssueList items={preview.issues} tone="error" />
        <IssueList items={confirmIssues} tone="error" />

        <section aria-labelledby="na-fields-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h4 id="na-fields-title" className="text-xs font-bold text-slate-900">
              Project details
            </h4>
            {codePreview && (
              <p className="text-[11px] text-slate-600" aria-live="polite">
                Will be <span className="font-bold text-slate-900">{codePreview}</span>
                {year ? ` · Intervention year ${year}` : ""}. The number is given when the draft is created.
              </p>
            )}
          </div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {preview.fields.map((f) => {
              const editable = isEditable(f.key) && (f.key !== "projectTypeId" || typeRequired);
              const open = editable && isEditable(f.key) && editing.has(f.key);
              return (
                <li key={f.key} className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-2 px-3 py-2.5">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-800">
                      {f.label}
                      {required.has(f.key) && <span className="text-red-500"> *</span>}
                    </p>
                    <FieldTag field={f} changed={open && !f.needsInput} />
                  </div>
                  <div className="min-w-0">
                    {open && isEditable(f.key) ? (
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">{renderInput(f.key)}</div>
                        {!f.needsInput && (
                          <button
                            type="button"
                            className="shrink-0 mt-1.5 text-[11px] font-semibold text-brand-primary hover:underline"
                            onClick={() => revertToFile(f.key as EditableKey)}
                          >
                            Use the file's value
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs ${f.display ? "text-slate-800" : "text-slate-400"} whitespace-pre-line break-words`}>
                          {f.display ?? "Not in the file"}
                        </p>
                        {editable && (
                          <button
                            type="button"
                            className="shrink-0 text-[11px] font-semibold text-brand-primary hover:underline"
                            onClick={() => startEditing(f.key as EditableKey)}
                          >
                            Change<span className="sr-only">: {f.label}</span>
                          </button>
                        )}
                      </div>
                    )}
                    {f.message && <p className="mt-1 text-[11px] text-amber-800">{f.message}</p>}
                    {f.needsInput && !isEditable(f.key) && !f.message && WIZARD_HINT[f.key] && (
                      <p className="mt-1 text-[11px] text-slate-500">{WIZARD_HINT[f.key]}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="na-scope-title" className="space-y-3">
          <h4 id="na-scope-title" className="text-xs font-bold text-slate-900">
            BoQ & work phases
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Tile label="Work phases" value={String(t.sprintCount)} />
            <Tile label="Facility units" value={String(t.unitCount)} />
            <Tile label="BoQ lines" value={String(t.lineCount)} />
            <Tile
              label="Total"
              value={formatNaira(t.amountNgn)}
              hint={budget !== null ? `${overBudget ? "Above the budget of" : "Budget"} ${formatNaira(budget)}` : "No budget given"}
              tone={overBudget ? "warning" : undefined}
            />
          </div>
          {scope.groups.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">Lines by facility and work phase</caption>
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-2">Facility</th>
                    <th className="py-1 pr-2">Work phases</th>
                    <th className="py-1 pr-2">Units</th>
                    <th className="py-1 pr-2 text-right">Lines</th>
                    <th className="py-1 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scope.groups.map((g) => (
                    <tr key={`${g.facilityCode}-${g.sprintLabel}`}>
                      <td className="py-1 pr-2 font-semibold text-slate-800">{g.facilityName}</td>
                      <td className="py-1 pr-2">{g.sprintLabel}</td>
                      <td className="py-1 pr-2 font-mono text-[11px]">{g.unitCodes.join(", ")}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{g.lineCount}</td>
                      <td className="py-1 text-right tabular-nums">{formatNaira(g.amountNgn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {scope.sprints.length > 0 && (
            <ul className="text-xs text-slate-700 space-y-0.5">
              {scope.sprints.map((s) => (
                <li key={s.number}>
                  <span className="font-semibold">
                    {s.number}. {s.name}
                  </span>{" "}
                  · {formatDateShort(s.startDate)} – {formatDateShort(s.endDate)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="na-sites-title" className="space-y-2">
          <h4 id="na-sites-title" className="text-xs font-bold text-slate-900">
            Sites ({preview.sites.length})
          </h4>
          {preview.sites.length === 0 ? (
            <p className="text-xs text-slate-500">The file lists no sites. Add them in the wizard once the draft is created.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-2">No.</th>
                    <th className="py-1 pr-2">School</th>
                    <th className="py-1 pr-2">Level</th>
                    <th className="py-1 pr-2">LGA</th>
                    <th className="py-1 pr-2">Located</th>
                    <th className="py-1 pr-2 text-right">Units</th>
                    <th className="py-1 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.sites.map((s) => {
                    const located = s.latitude !== null && s.longitude !== null;
                    return (
                      <tr key={s.siteNumber}>
                        <td className="py-1 pr-2 tabular-nums">{s.siteNumber}</td>
                        <td className="py-1 pr-2 font-semibold text-slate-800">{s.schoolName ?? "—"}</td>
                        <td className="py-1 pr-2">{s.schoolLevel ? SCHOOL_LEVEL_LABELS[s.schoolLevel] : "—"}</td>
                        <td className="py-1 pr-2">{s.lgaName ?? "—"}</td>
                        <td className="py-1 pr-2">
                          {located ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <MapPin className="w-3 h-3" aria-hidden="true" /> Yes
                            </span>
                          ) : (
                            <span className="text-slate-500">No</span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{s.unitCount}</td>
                        <td className="py-1 text-right tabular-nums">{formatNaira(s.amountNgn)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <IssueList items={preview.warnings} tone="warning" />
        {!hasIssues && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> No errors in the file. Amounts were recomputed as quantity × rate.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
        {blockedReason && <p className="mr-auto text-[11px] font-medium text-slate-600">{blockedReason}</p>}
        <button type="button" className={secondaryButton} onClick={onClose} disabled={confirm.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={Boolean(blockedReason) || confirm.isPending}
          title={blockedReason ?? undefined}
          onClick={submit}
        >
          {confirm.isPending ? "Creating the draft…" : "Create draft"}
        </button>
      </div>
    </ModalShell>
  );
}

function FieldTag({ field, changed }: { field: NeedsAssessmentFieldValue; changed: boolean }) {
  if (field.needsInput) return <TableBadge variant="warning">Needs your input</TableBadge>;
  if (changed) return <TableBadge variant="neutral">Changed</TableBadge>;
  if (field.source === "TEMPLATE") return <TableBadge variant="info">From needs assessment</TableBadge>;
  return <TableBadge variant="neutral">Not in the file</TableBadge>;
}
