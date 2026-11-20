import { describeCompletionRule, TRANCHE_PAYMENT_BASIS_META, type MilestonePaymentTerms } from "@insite/shared";
import { formatNaira } from "../../lib/formatters";

/** Phase 12: a fixed payment milestone's criteria and where it stands against them. */
export function PaymentTermsBox({ terms, title = "Payment basis" }: { terms: MilestonePaymentTerms; title?: string }) {
  if (terms.paymentBasis !== "FIXED_ON_COMPLETION") return null;
  const met = terms.completionMet === true;
  return (
    <div className={`rounded-xl border p-3 text-xs ${met ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="font-semibold text-slate-900 mt-0.5">
        {TRANCHE_PAYMENT_BASIS_META.FIXED_ON_COMPLETION.label}: {formatNaira(terms.fixedReleaseAmountNgn ?? 0)}
        {terms.alreadyReleasedNgn > 0 && <span className="font-normal text-slate-600"> ({formatNaira(terms.alreadyReleasedNgn)} already released)</span>}
      </div>
      <div className="text-slate-700 mt-0.5">
        Completion criteria: {describeCompletionRule(terms.completionRule, terms.completionRequiredItemPct, terms.targetCompletionPct)}
        {terms.weightedProgressPct !== null && <> · weighted progress {terms.weightedProgressPct}%</>}
      </div>
      <div className={`mt-1 font-semibold ${met ? "text-emerald-800" : "text-amber-800"}`}>{met ? "Criteria met." : "Criteria not met yet."}</div>
      {!met && terms.unmetReasons.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-amber-800">
          {terms.unmetReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

