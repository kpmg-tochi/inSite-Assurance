import { formatNaira } from "../../lib/formatters";

/**
 * Redesign R6 (D-R6.23): paid to date against the contract sum, used on Payments and the Overview.
 * Pass `ProjectPaymentsSummaryDto.paidGrossNgn` (gross of interim and final payments, the figure the
 * PAID_ABOVE_CONTRACT_SUM exception uses). The figure is always written out; the bar only illustrates it.
 */
export function PaidVsContractSumBar({ paidNgn, contractSumNgn }: { paidNgn: number; contractSumNgn: number | null }) {
  if (!contractSumNgn || contractSumNgn <= 0) {
    return <p className="text-sm text-slate-600">Paid to date {formatNaira(paidNgn)} · no contract sum recorded</p>;
  }
  const pct = Math.round((paidNgn / contractSumNgn) * 1000) / 10;
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-800">
          {formatNaira(paidNgn)} paid of {formatNaira(contractSumNgn)}
        </span>
        <span className={pct > 100 ? "font-semibold text-red-700" : "text-slate-600"}>{pct}%</span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Paid against contract sum"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
      >
        <div className={`h-full rounded-full ${pct > 100 ? "bg-red-600" : "bg-brand-primary"}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
