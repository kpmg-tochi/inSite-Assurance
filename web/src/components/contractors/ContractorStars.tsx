import React from "react";
import { Star } from "lucide-react";
import { CONTRACTOR_STATUS_LABELS, type ContractorReliabilityDto, type ContractorStatus } from "@insite/shared";

/**
 * Client demo updates F.3: a contractor's reliability as 0–5 stars to the half star, announced as
 * "3.5 of 5 stars". Not rated (fewer than the minimum accepted reports): "Not yet rated: n reports".
 */
export function StarRow({ stars, size = "h-3.5 w-3.5" }: { stars: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${stars} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = stars >= n ? 1 : stars >= n - 0.5 ? 0.5 : 0;
        return (
          <span key={n} className={`relative inline-block ${size}`} aria-hidden="true">
            <Star className={`absolute inset-0 ${size} text-slate-300`} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: fill === 1 ? "100%" : "50%" }}>
                <Star className={`${size} fill-amber-400 text-amber-400`} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

const reports = (n: number) => `${n} report${n === 1 ? "" : "s"}`;

/** Stars + score + "N reports", or the not-rated line. `compact` drops the project count. */
export function ContractorStars({ rating, compact = false }: { rating: ContractorReliabilityDto; compact?: boolean }) {
  if (!rating.rated || rating.stars === null || rating.score === null) {
    return <span className="text-[11px] text-slate-500">Not yet rated: {reports(rating.reportCount)}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
      <StarRow stars={rating.stars} />
      <span className="font-semibold text-slate-800">{rating.score.toFixed(1)}</span>
      <span>
        · {reports(rating.reportCount)}
        {!compact && ` on ${rating.projectCount} project${rating.projectCount === 1 ? "" : "s"}`}
      </span>
    </span>
  );
}

const STATUS_STYLE: Record<ContractorStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800 border-emerald-200",
  INACTIVE: "bg-amber-50 text-amber-800 border-amber-200",
  SUSPENDED: "bg-rose-50 text-rose-700 border-rose-200",
};

const STATUS_SHORT: Record<ContractorStatus, string> = { ACTIVE: "Active", INACTIVE: "Inactive", SUSPENDED: "Suspended" };

/** Status chip; the title carries the full label ("Inactive: contract not yet on file"). */
export function ContractorStatusChip({ status }: { status: ContractorStatus }) {
  return (
    <span
      title={CONTRACTOR_STATUS_LABELS[status]}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLE[status]}`}
    >
      {STATUS_SHORT[status]}
    </span>
  );
}
