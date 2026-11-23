import React, { useState } from "react";
import { TRADE_CODE_REGEX, type OrganizationRef } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { OrganizationInput } from "../organizations/OrganizationInput";
import { useReplaceContractorMutation } from "../../mutations/contracts/useContractMutations";
import { parseNumberInput } from "../../pages/projects/setup/setupContext";
import { primaryButton, secondaryButton, smallInput } from "./contractUi";

/**
 * Phase 13: appoints a replacement for a terminated contractor. Uncertified items can move to the
 * new contractor (certified progress stays with the old one); mobilisation milestones and join codes
 * are created for it.
 */
export function ReplaceContractorDialog({
  projectId,
  terminated,
  onClose,
}: {
  projectId: string;
  terminated: { projectContractorId: string; organizationName: string; tradeCategory?: string | null; tradeCode: string };
  onClose: () => void;
}) {
  const replace = useReplaceContractorMutation(projectId);
  const [organization, setOrganization] = useState<OrganizationRef | null>(null);
  const [tradeCategory, setTradeCategory] = useState(terminated.tradeCategory ?? "");
  const [tradeCode, setTradeCode] = useState("");
  const [budget, setBudget] = useState("");
  const [allowFieldReporting, setAllowFieldReporting] = useState(true);
  const [moveUncertifiedItems, setMoveUncertifiedItems] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return setError("Choose or enter the replacement contractor.");
    if (tradeCategory.trim().length < 2) return setError("Enter the trade.");
    if (!TRADE_CODE_REGEX.test(tradeCode.trim().toUpperCase())) return setError("Trade code: 2 to 6 letters or digits.");
    const amount = budget.trim() ? parseNumberInput(budget) : null;
    if (budget.trim() && (amount === null || amount < 0)) return setError("Enter a package budget, or leave it empty.");
    setError(null);
    replace.mutate(
      {
        projectContractorId: terminated.projectContractorId,
        body: {
          organization,
          tradeCategory: tradeCategory.trim(),
          tradeCode: tradeCode.trim().toUpperCase(),
          allocatedBudgetNgn: amount,
          allowFieldReporting,
          moveUncertifiedItems,
        },
      },
      { onSuccess: onClose }
    );
  };

  return (
    <ModalShell title="Appoint a replacement" subtitle={`Replaces ${terminated.organizationName} (${terminated.tradeCode})`} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} className="p-5 space-y-4">
        <OrganizationInput label="Replacement contractor" tag="CONTRACTOR" value={organization} onChange={setOrganization} disabled={replace.isPending} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="rep-trade">
              Trade
            </label>
            <input id="rep-trade" className={smallInput} value={tradeCategory} maxLength={80} onChange={(e) => setTradeCategory(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="rep-code">
              Trade code
            </label>
            <input
              id="rep-code"
              className={`${smallInput} uppercase font-semibold`}
              value={tradeCode}
              maxLength={6}
              placeholder="GEN2"
              onChange={(e) => setTradeCode(e.target.value.toUpperCase())}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="rep-budget">
            Package budget (optional)
          </label>
          <input id="rep-budget" inputMode="decimal" className={smallInput} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={moveUncertifiedItems} onChange={(e) => setMoveUncertifiedItems(e.target.checked)} />
          <span>
            <span className="font-semibold">Move items that are not fully certified</span>
            <span className="block text-[11px] text-slate-500">
              Certified progress, claims and history stay with {terminated.organizationName}.
            </span>
          </span>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={allowFieldReporting} onChange={(e) => setAllowFieldReporting(e.target.checked)} /> Field reporting
        </label>
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={replace.isPending}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={replace.isPending}>
            {replace.isPending ? "Appointing…" : "Appoint replacement"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
