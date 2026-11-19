import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Sparkles, Upload, X } from "lucide-react";
import {
  formatMoney,
  type BoqItemInput,
  type BoqPreviewResponse,
  type ContractorSuggestionResponse,
  type ProjectBoqItemMapping,
} from "@insite/shared";
import { useProjectBoqQuery } from "../../../../queries/boq/useBoqQueries";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { useBoqRevisionsQuery } from "../../../../queries/projects/useProjectSetupQueries";
import {
  useCommitBoqMutation,
  usePreviewBoqMutation,
  useSaveSetupStepMutation,
  useSuggestContractorsMutation,
} from "../../../../mutations/projects/useProjectSetupMutations";
import type { BoqItemRecordDto } from "../../../../api/types";
import {
  extractErrors,
  FieldError,
  inputClass,
  labelClass,
  NO_ERRORS,
  StepSection,
  useRegisterStep,
  type FormErrors,
  type StepProps,
} from "../setupContext";

type Mapping = Required<Pick<ProjectBoqItemMapping, "boqItemId" | "trancheId" | "isHoldPoint">> & {
  holdPointInstruction: string | null;
  isOpaqueLumpSum: boolean;
  projectContractorId: string | null;
};

const toMapping = (i: BoqItemRecordDto): Mapping => ({
  boqItemId: i.id,
  trancheId: i.trancheId,
  isHoldPoint: i.isHoldPoint,
  holdPointInstruction: i.holdPointInstruction,
  isOpaqueLumpSum: i.isOpaqueLumpSum,
  projectContractorId: i.projectContractorId ?? null,
});

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function BoqStep({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const isLive = setup.status !== "DRAFT";
  const boqQuery = useProjectBoqQuery(projectId);
  const revisions = useBoqRevisionsQuery(projectId, isLive);
  const items = useMemo(() => boqQuery.data ?? [], [boqQuery.data]);
  const tranches = setup.facility.tranches;
  const contractors = setup.parties.contractors;
  const multiPrime = setup.parties.contractorExecutionMode === "MULTI_PRIME_SEPARATE_IPC";
  const showContractorColumn = contractors.length > 1;

  // Mapping edits, keyed by item id.
  const initial = useMemo(() => Object.fromEntries(items.map((i) => [i.id, toMapping(i)])), [items]);
  const [edits, setEdits] = useState<Record<string, Mapping>>({});
  useEffect(() => setEdits({}), [initial]);
  const current = (id: string) => edits[id] ?? initial[id];
  const changed = Object.values(edits).filter((m) => JSON.stringify(m) !== JSON.stringify(initial[m.boqItemId]));
  const dirty = changed.length > 0;
  const setMapping = (id: string, patch: Partial<Mapping>) =>
    setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? initial[id]), ...patch } }));

  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    try {
      await save.mutateAsync({ stepId: "boq", body: { items: changed }, silent: opts?.silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  // ---- Upload with preview --------------------------------------------------
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<BoqPreviewResponse | null>(null);
  const [reason, setReason] = useState("");
  const previewMutation = usePreviewBoqMutation(projectId);
  const commitMutation = useCommitBoqMutation(projectId);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    const base64 = await fileToBase64(file);
    const result = await previewMutation.mutateAsync({ base64, fileName: file.name });
    setPreview(result);
  };

  const commit = async () => {
    if (!preview) return;
    const valid: BoqItemInput[] = preview.rows
      .filter((r) => r.item)
      .map((r) => ({ ...r.item!, holdPointInstruction: null, trancheId: null }));
    await commitMutation.mutateAsync({ items: valid, mode: "REPLACE", ...(isLive ? { reason: reason.trim() } : {}) });
    setPreview(null);
    setFileName(null);
    setReason("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // ---- Bulk actions --------------------------------------------------------
  const unmappedWithSuggestion = items.filter((i) => !current(i.id)?.trancheId && i.aiSuggestedTrancheId);
  const acceptSuggestedTranches = () => {
    // Only items with a suggestion; anything without one stays unmapped and blocks activation.
    for (const i of unmappedWithSuggestion) setMapping(i.id, { trancheId: i.aiSuggestedTrancheId });
  };

  const suggest = useSuggestContractorsMutation(projectId);
  const [suggestion, setSuggestion] = useState<ContractorSuggestionResponse | null>(null);
  const [packageTargets, setPackageTargets] = useState<Record<string, string>>({});
  const openSuggestion = async () => {
    const res = await suggest.mutateAsync();
    setSuggestion(res);
    const byCode = new Map(contractors.map((c) => [c.tradeCode, c.id]));
    setPackageTargets(
      Object.fromEntries(res.packages.map((p) => [p.tradeCode, p.existingProjectContractorId ?? byCode.get(p.tradeCode) ?? ""]))
    );
  };
  const applySuggestion = () => {
    if (!suggestion) return;
    const byWbs = new Map(items.map((i) => [i.wbsCode, i.id]));
    for (const p of suggestion.packages) {
      const target = packageTargets[p.tradeCode];
      if (!target) continue;
      for (const w of p.matchedWbsCodes) {
        const id = byWbs.get(w);
        if (id) setMapping(id, { projectContractorId: target });
      }
    }
    setSuggestion(null);
  };

  const unmapped = items.filter((i) => !current(i.id)?.trancheId).length;
  const unassigned = items.filter((i) => !current(i.id)?.projectContractorId).length;
  const total = items.reduce((s, i) => s + i.budgetedCostNgn, 0);

  return (
    <div className="space-y-5">
      <StepSection
        title={isLive ? "Revise the bill of quantities" : "Upload the bill of quantities"}
        description={
          isLive
            ? "An upload creates a revision with a reason. Items with certified progress keep at least the certified quantity and rate, and cannot be removed."
            : "Upload an .xlsx or .csv. The server reads it and shows every row with any problems before anything is saved. A new upload replaces the draft BOQ."
        }
      >
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={previewMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> {previewMutation.isPending ? "Reading…" : "Choose file"}
            </button>
            {fileName && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <FileSpreadsheet className="w-4 h-4" /> {fileName}
              </span>
            )}
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{preview.validCount} usable rows</span>
              <span className="rounded-lg bg-amber-50 px-3 py-1 font-semibold text-amber-800">{preview.warningCount} with warnings</span>
              <span className="rounded-lg bg-rose-50 px-3 py-1 font-semibold text-rose-700">{preview.errorCount} not usable</span>
              <span className="rounded-lg bg-slate-50 px-3 py-1 font-semibold text-slate-700">{formatMoney(preview.totalBudgetedCostNgn, { currency })}</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Columns read:{" "}
              {Object.entries(preview.detectedColumns)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k} ← "${v}"`)
                .join(", ")}
            </p>
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">WBS</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber} className={`border-t border-slate-100 ${r.errors.length ? "bg-rose-50/60" : r.warnings.length ? "bg-amber-50/50" : ""}`}>
                      <td className="px-3 py-1.5 text-slate-500">{r.rowNumber}</td>
                      <td className="px-3 py-1.5 font-mono">{r.item?.wbsCode ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.item?.description ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.item?.unit ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right">{r.item ? r.item.totalQuantity.toLocaleString() : "—"}</td>
                      <td className="px-3 py-1.5 text-right">{r.item ? formatMoney(r.item.budgetedCostNgn, { currency }) : "—"}</td>
                      <td className="px-3 py-1.5">
                        {[...r.errors, ...r.warnings].map((m, i) => (
                          <p key={i} className={i < r.errors.length ? "text-rose-700" : "text-amber-800"}>
                            {m}
                          </p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isLive && (
              <div>
                <label className={labelClass} htmlFor="boq-reason">
                  Reason for this revision <span className="text-red-500">*</span>
                </label>
                <input id="boq-reason" className={inputClass()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Variation order 3" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={commit}
                disabled={preview.validCount === 0 || commitMutation.isPending || (isLive && reason.trim().length < 3)}
                className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {commitMutation.isPending ? "Saving…" : `Save ${preview.validCount} item(s)`}
              </button>
              <button type="button" onClick={() => setPreview(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700">
                Discard
              </button>
              {preview.errorCount > 0 && (
                <p className="inline-flex items-center gap-1 text-[11px] text-rose-700">
                  <AlertTriangle className="w-3.5 h-3.5" /> Rows that are not usable are left out. Fix them in the file and upload again to include them.
                </p>
              )}
            </div>
          </div>
        )}

        {isLive && (revisions.data?.length ?? 0) > 0 && (
          <div className="text-[11px] text-slate-500 space-y-0.5">
            <p className="font-semibold text-slate-600">Revisions</p>
            {revisions.data!.map((r) => (
              <p key={r.id}>
                #{r.revisionNumber} · {new Date(r.createdAt).toLocaleDateString()} · {r.uploadedByName ?? "Unknown"} · {r.reason}
              </p>
            ))}
          </div>
        )}
      </StepSection>

      <StepSection
        title="Items"
        description={`${items.length} item(s), ${formatMoney(total, { currency })}. Every item must be mapped to a tranche${multiPrime ? " and assigned to a contractor" : ""} before activation.`}
        actions={
          !readOnly &&
          items.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={acceptSuggestedTranches}
                disabled={unmappedWithSuggestion.length === 0}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Maps unmapped items that have a suggested tranche. Items without a suggestion stay unmapped."
              >
                Accept {unmappedWithSuggestion.length} suggested tranche(s)
              </button>
              {showContractorColumn && (
                <button
                  type="button"
                  onClick={openSuggestion}
                  disabled={suggest.isPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" /> {suggest.isPending ? "Working…" : "Suggest packages"}
                </button>
              )}
            </div>
          )
        }
      >
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-lg px-3 py-1 font-semibold ${unmapped ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
            {unmapped} not mapped to a tranche
          </span>
          {multiPrime && (
            <span className={`rounded-lg px-3 py-1 font-semibold ${unassigned ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
              {unassigned} without a contractor
            </span>
          )}
          {dirty && <span className="rounded-lg bg-slate-100 px-3 py-1 font-semibold text-slate-700">{changed.length} unsaved change(s)</span>}
        </div>
        {errors.general && <FieldError message={errors.general} />}

        {suggestion && (
          <div className="rounded-xl border border-brand-primary/30 bg-brand-primary/5 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold text-slate-900">Suggested packages</p>
                <p className="text-[11px] text-slate-500">
                  {suggestion.engine === "AZURE_OPENAI" ? `AI suggestion (${suggestion.engineDetail ?? "model"})` : "Section and keyword rules"}. Nothing is
                  saved until you apply and save.
                </p>
              </div>
              <button type="button" onClick={() => setSuggestion(null)} aria-label="Close">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            {suggestion.packages.map((p) => (
              <div key={p.tradeCode} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs">
                <div className="md:col-span-5">
                  <p className="font-semibold text-slate-800">
                    {p.suggestedTradeCategory} <span className="font-mono text-slate-500">{p.tradeCode}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {p.matchedWbsCodes.length} item(s) · {formatMoney(p.estimatedPackageBudgetNgn, { currency })} · {p.rationale}
                  </p>
                </div>
                <div className="md:col-span-7">
                  <select
                    className={inputClass()}
                    value={packageTargets[p.tradeCode] ?? ""}
                    onChange={(e) => setPackageTargets((t) => ({ ...t, [p.tradeCode]: e.target.value }))}
                  >
                    <option value="">Do not assign</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.organizationName} ({c.tradeCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-slate-500">To use a package for a contractor that is not on the project yet, add the contractor in Parties first.</p>
            <button type="button" onClick={applySuggestion} className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover">
              Apply to items
            </button>
          </div>
        )}

        {boqQuery.isLoading ? (
          <p className="text-xs text-slate-500">Loading items…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-slate-500">No items yet. Upload a file above.</p>
        ) : (
          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">WBS</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Lump sum</th>
                  <th className="px-3 py-2">Hold point</th>
                  <th className="px-3 py-2">Tranche</th>
                  {showContractorColumn && <th className="px-3 py-2">Contractor</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const m = current(i.id);
                  if (!m) return null;
                  const suggested = tranches.find((t) => t.id === i.aiSuggestedTrancheId);
                  return (
                    <tr key={i.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono">{i.wbsCode}</td>
                      <td className="px-3 py-2 max-w-xs">
                        <p>{i.description}</p>
                        <p className="text-[11px] text-slate-400">
                          {i.totalQuantity.toLocaleString()} {i.unit}
                          {i.cumulativeCertifiedPct > 0 && ` · ${i.cumulativeCertifiedPct}% certified`}
                        </p>
                        {i.opacityWarningReason && <p className="text-[11px] text-amber-700">{i.opacityWarningReason}</p>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(i.budgetedCostNgn, { currency })}</td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Lump sum ${i.wbsCode}`}
                          checked={m.isOpaqueLumpSum}
                          onChange={(e) => setMapping(i.id, { isOpaqueLumpSum: e.target.checked })}
                          disabled={readOnly}
                        />
                      </td>
                      <td className="px-3 py-2 min-w-[180px]">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={m.isHoldPoint}
                            onChange={(e) => setMapping(i.id, { isHoldPoint: e.target.checked })}
                            disabled={readOnly}
                          />
                          <span>Hold point</span>
                        </label>
                        {m.isHoldPoint && (
                          <input
                            className={`${inputClass()} mt-1`}
                            value={m.holdPointInstruction ?? ""}
                            placeholder="What to photograph before covering"
                            onChange={(e) => setMapping(i.id, { holdPointInstruction: e.target.value || null })}
                            disabled={readOnly}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 min-w-[160px]">
                        <select
                          className={inputClass(!m.trancheId)}
                          value={m.trancheId ?? ""}
                          onChange={(e) => setMapping(i.id, { trancheId: e.target.value || null })}
                          disabled={readOnly}
                        >
                          <option value="">Not mapped</option>
                          {tranches.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.trancheNumber}. {t.name}
                            </option>
                          ))}
                        </select>
                        {!m.trancheId && suggested && <p className="mt-1 text-[11px] text-slate-500">Suggested: {suggested.trancheNumber}</p>}
                      </td>
                      {showContractorColumn && (
                        <td className="px-3 py-2 min-w-[160px]">
                          <select
                            className={inputClass(multiPrime && !m.projectContractorId)}
                            value={m.projectContractorId ?? ""}
                            onChange={(e) => setMapping(i.id, { projectContractorId: e.target.value || null })}
                            disabled={readOnly}
                          >
                            <option value="">No contractor</option>
                            {contractors.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.organizationName} ({c.tradeCode})
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tranches.length === 0 && items.length > 0 && (
          <p className="text-[11px] text-amber-700">Add tranches in the Facility step to map items.</p>
        )}
      </StepSection>
    </div>
  );
}
