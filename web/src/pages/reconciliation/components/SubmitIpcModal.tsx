import React, { useMemo, useState } from "react";
import { OPEN_IPC_STATUSES, type IpcClaimDto, type MediaType } from "@insite/shared";
import type { BoqItemRecordDto, ProjectSummaryDto } from "../../../api/types";
import { CustomSelect, type CustomSelectOption } from "../../../components/common";
import { uploadSupportingDocument } from "../../../api/reconciliation/reconciliationApi";
import { useSubmitIpcMutation } from "../../../mutations/reconciliation/useReconciliationMutations";
import { formatNaira } from "../../../lib/formatters";
import { useAuth, useTerm } from "../../../lib/auth-context";
import { ModalActions, ModalShell, inputClass } from "./ModalShell";

const DOC_TYPE_OPTIONS: Array<{ value: MediaType; label: string }> = [
  { value: "WAYBILL_DOCUMENT", label: "Waybill / delivery note" },
  { value: "LAB_CUBE_TEST_CERT", label: "Lab / cube test certificate" },
  { value: "MILL_CERTIFICATE", label: "Mill certificate" },
  { value: "SITE_PHOTO", label: "Site photo" },
];

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);

interface Props {
  project: ProjectSummaryDto;
  ipcs: IpcClaimDto[];
  boqItems: BoqItemRecordDto[];
  onClose: () => void;
  onSubmitted: (ipcId: string) => void;
}

/**
 * Contractor claim form. Amounts shown here are for display only; the server computes the
 * claim from the percentages and the BOQ budget.
 */
export function SubmitIpcModal({ project, ipcs, boqItems, onClose, onSubmitted }: Props) {
  const submitMutation = useSubmitIpcMutation(project.id);
  const { user } = useAuth();
  const term = useTerm();
  // Phase 6: the claim is submitted for the user's own contractor. In multi-prime it may only
  // cover that contractor's items, and the one-open-IPC rule is per contractor.
  const ownContractor = project.contractors.find((c) => c.organizationId === user?.organizationId) ?? null;
  const multiPrime = project.contractorExecutionMode === "MULTI_PRIME_SEPARATE_IPC";

  const availableTranches = useMemo(
    () =>
      project.tranches.filter(
        (t) =>
          !t.isReleased &&
          !ipcs.some(
            (ipc) =>
              ipc.trancheId === t.id &&
              OPEN_IPC_STATUSES.includes(ipc.status) &&
              (!multiPrime || ipc.projectContractorId === ownContractor?.id),
          ),
      ),
    [project.tranches, ipcs, multiPrime, ownContractor?.id],
  );

  const [trancheId, setTrancheId] = useState(availableTranches[0]?.id ?? "");
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [coverNote, setCoverNote] = useState("");
  const today = toDateInput(new Date());
  const [periodStart, setPeriodStart] = useState(toDateInput(new Date(Date.now() - 30 * 86_400_000)));
  const [periodEnd, setPeriodEnd] = useState(today);
  const [files, setFiles] = useState<Array<{ file: File; mediaType: MediaType; title: string }>>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const trancheItems = boqItems.filter(
    (b) =>
      b.trancheId === trancheId &&
      b.cumulativeCertifiedPct < 100 &&
      (!multiPrime || (ownContractor && b.projectContractorId === ownContractor.id)),
  );

  const lines = trancheItems
    .filter((b) => (claims[b.id] ?? "").trim() !== "")
    .map((b) => ({ boq: b, pct: Number(claims[b.id]) }));
  const invalid = lines.filter((l) => !(l.pct > l.boq.cumulativeCertifiedPct) || l.pct > 100);
  const displayTotal = lines.reduce(
    (sum, l) => sum + Math.max(0, ((l.pct - l.boq.cumulativeCertifiedPct) / 100) * l.boq.budgetedCostNgn),
    0,
  );

  const trancheOptions: CustomSelectOption<string>[] = availableTranches.map((t) => ({
    value: t.id,
    label: `${term("tranche")} ${t.trancheNumber}: ${t.name}`,
    badge: formatNaira(t.allocatedAmountNgn - t.releasedAmountNgn),
    description: "Unreleased allocation",
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (lines.length === 0) return setFormError("Enter a claimed percentage for at least one BOQ item.");
    if (invalid.length > 0) {
      return setFormError(
        `Claimed percentages must be above the certified percentage and at most 100% (${invalid
          .map((l) => l.boq.wbsCode)
          .join(", ")}).`,
      );
    }
    if (periodEnd < periodStart) return setFormError("The period end must be after the start.");

    const start = new Date(`${periodStart}T00:00:00`);
    const endOfDay = new Date(`${periodEnd}T23:59:59`);
    const end = endOfDay.getTime() > Date.now() ? new Date() : endOfDay;
    if (end.getTime() <= start.getTime()) return setFormError("The period end must be after the start.");

    const supportingDocuments: Array<{ title: string; mediaType: MediaType; objectKey: string }> = [];
    try {
      setUploading(true);
      for (const f of files) {
        const objectKey = await uploadSupportingDocument({ projectId: project.id, file: f.file, mediaType: f.mediaType });
        supportingDocuments.push({ title: f.title.trim() || f.file.name, mediaType: f.mediaType, objectKey });
      }
    } catch (err) {
      setFormError((err as { message?: string })?.message || "A document upload failed.");
      return;
    } finally {
      setUploading(false);
    }

    try {
      const created = await submitMutation.mutateAsync({
        trancheId,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        contractorCoverNote: coverNote.trim() || undefined,
        lineItems: lines.map((l) => ({
          boqItemId: l.boq.id,
          claimedCumulativePct: l.pct,
          contractorRemarks: remarks[l.boq.id]?.trim() || undefined,
        })),
        supportingDocuments,
      });
      onSubmitted(created.id);
      onClose();
    } catch {
      // Toasted by the mutation hook; keep the form open so the contractor can correct it.
    }
  };

  return (
    <ModalShell title="Submit Interim Payment Certificate (IPC)" subtitle={`The ${term("ipc", { lower: true })} number and amounts are assigned by the server`} onClose={onClose} maxWidth="max-w-3xl">
      {availableTranches.length === 0 ? (
        <div className="p-5 space-y-3 text-xs text-slate-600">
          <p>
            No {term("tranche", { lower: true })} is open for a new claim. Each {term("tranche", { lower: true })} allows one open {term("ipc", { lower: true })} at a time, and released{" "}
            {term("tranche", { plural: true, lower: true })} take no claims.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 font-semibold">
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <CustomSelect label={term("tranche")} value={trancheId} onChange={setTrancheId} options={trancheOptions} />

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-700">
              Period start
              <input type="date" required value={periodStart} max={periodEnd} onChange={(e) => setPeriodStart(e.target.value)} className={`${inputClass} mt-1`} />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Period end
              <input type="date" required value={periodEnd} min={periodStart} max={today} onChange={(e) => setPeriodEnd(e.target.value)} className={`${inputClass} mt-1`} />
            </label>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1.5">BOQ items in this {term("tranche", { lower: true })}</div>
            {trancheItems.length === 0 ? (
              <p className="text-xs text-slate-500">No BOQ items mapped to this {term("tranche", { lower: true })} have work left to claim.</p>
            ) : (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {trancheItems.map((b) => {
                  const value = claims[b.id] ?? "";
                  const pct = Number(value);
                  const bad = value !== "" && (!(pct > b.cumulativeCertifiedPct) || pct > 100);
                  return (
                    <div key={b.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-xs items-start">
                      <div className="min-w-0">
                        <div className="truncate">
                          <span className="font-bold text-brand-primary mr-1.5">{b.wbsCode}</span>
                          <span className="text-slate-700">{b.description}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Certified to date {b.cumulativeCertifiedPct}% · Budget {formatNaira(b.budgetedCostNgn)}
                          {b.isHoldPoint ? ` · ${term("holdPoint")}` : ""}
                        </div>
                        {value !== "" && (
                          <input
                            value={remarks[b.id] ?? ""}
                            maxLength={600}
                            onChange={(e) => setRemarks((r) => ({ ...r, [b.id]: e.target.value }))}
                            placeholder="Remarks (optional)"
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          min={b.cumulativeCertifiedPct + 0.01}
                          max={100}
                          value={value}
                          onChange={(e) => setClaims((c) => ({ ...c, [b.id]: e.target.value }))}
                          placeholder="Claim %"
                          aria-invalid={bad}
                          className={`w-24 rounded-lg border px-2 py-1 text-right text-xs ${bad ? "border-rose-400" : "border-slate-300"}`}
                        />
                        <span className="text-slate-500">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <label className="block text-xs font-medium text-slate-700">
            Cover note
            <textarea rows={2} maxLength={1500} value={coverNote} onChange={(e) => setCoverNote(e.target.value)} className={`${inputClass} mt-1`} />
          </label>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700">Supporting documents</div>
            <input
              type="file"
              multiple
              accept="application/pdf,image/*"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((prev) => [...prev, ...picked.map((file) => ({ file, mediaType: "WAYBILL_DOCUMENT" as MediaType, title: file.name }))]);
                e.target.value = "";
              }}
              className="text-xs"
            />
            {files.map((f, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <input
                  value={f.title}
                  onChange={(e) => setFiles((prev) => prev.map((p, i) => (i === idx ? { ...p, title: e.target.value } : p)))}
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-1"
                />
                <select
                  value={f.mediaType}
                  onChange={(e) => setFiles((prev) => prev.map((p, i) => (i === idx ? { ...p, mediaType: e.target.value as MediaType } : p)))}
                  className="rounded-lg border border-slate-200 px-2 py-1"
                >
                  {DOC_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))} className="text-rose-700 font-semibold">
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
            <span className="text-slate-500">Estimated claim ({lines.length} line{lines.length === 1 ? "" : "s"}), computed by the server on submit</span>
            <span className="font-bold text-slate-900">{formatNaira(displayTotal)}</span>
          </div>

          {formError && <div className="text-xs text-rose-700 font-medium">{formError}</div>}

          <ModalActions
            onCancel={onClose}
            submitLabel={`Submit ${term("ipc")}`}
            pendingLabel={uploading ? "Uploading documents..." : "Submitting and reconciling..."}
            isPending={uploading || submitMutation.isPending}
            disabled={!trancheId || trancheItems.length === 0}
          />
        </form>
      )}
    </ModalShell>
  );
}
