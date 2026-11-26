import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  NOT_RECORDED_KEY,
  PAYMENTS_BREAKDOWN_BY_LABELS,
  PaymentsBreakdownByEnum,
  type PaymentsBreakdownBy,
  type PaymentsBreakdownDto,
  type PaymentsBreakdownRowDto,
  type PaymentsBreakdownTotals,
} from "@insite/shared";
import { useTerm } from "../../lib/auth-context";
import { formatNaira } from "../../lib/formatters";
import { TAB_LIST_CLASS, tabItemClass } from "../common/Tabs";

/**
 * Client demo updates wave 4 (G.2): the portfolio Payments tab's Breakdown. The period's payments
 * (voided never counted) grouped by zone, State, LGA, contractor, project, month or quarter, with a
 * totals row that counts each payment once. A row the parent can drill into is a button: the parent
 * decides what a drill does (set a filter and change the grouping, or open the project).
 */

const BY_OPTIONS = PaymentsBreakdownByEnum.options;

/** What the next grouping is after a drill from `by` (null = the row opens something or cannot drill). */
export const BREAKDOWN_DRILL_NEXT: Partial<Record<PaymentsBreakdownBy, PaymentsBreakdownBy>> = {
  zone: "state",
  state: "lga",
  lga: "project",
  contractor: "project",
  quarter: "month",
  month: "project",
};

const CONTEXT_HEADER: Partial<Record<PaymentsBreakdownBy, string>> = { state: "Zone", lga: "State", project: "State" };

const DRILL_HINT: Record<PaymentsBreakdownBy, string> = {
  zone: "Show this zone's States",
  state: "Show this State's LGAs",
  lga: "Show this LGA's projects",
  contractor: "Show this contractor's projects",
  project: "Open the project's payments",
  quarter: "Show this quarter by month",
  month: "Show this month by project",
};

export function PaymentsBreakdownPanel({
  by,
  onByChange,
  data,
  loading,
  error,
  onDrill,
  backTo = null,
  onBack,
}: {
  by: PaymentsBreakdownBy;
  onByChange: (by: PaymentsBreakdownBy) => void;
  data: PaymentsBreakdownDto | undefined;
  loading: boolean;
  error: boolean;
  onDrill: (row: PaymentsBreakdownRowDto) => void;
  /** The grouping before the last drill (WEB-DEMO4-14): shows "Back to <level>", which undoes that drill. */
  backTo?: PaymentsBreakdownBy | null;
  onBack?: () => void;
}) {
  const term = useTerm();
  const labelOf = (b: PaymentsBreakdownBy) => (b === "contractor" ? term("contractor") : PAYMENTS_BREAKDOWN_BY_LABELS[b]);
  // The previous grouping stays on screen (dimmed) while the next one loads: label it by what it is.
  const shownBy = data?.by ?? by;
  const stale = data !== undefined && data.by !== by;
  const contextHeader = CONTEXT_HEADER[shownBy];
  const rows = data?.rows ?? [];
  const canDrill = (r: PaymentsBreakdownRowDto) => !stale && r.key !== NOT_RECORDED_KEY && !r.key.startsWith("text:");
  const showShared = shownBy === "lga" && Boolean(data?.hasSharedGroups);

  return (
    <section aria-labelledby="pp-breakdown" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="pp-breakdown" className="text-sm font-bold text-slate-900">
            Breakdown
          </h2>
          <p className="text-[11px] text-slate-500">Each row has the period's totals; select a row to drill down.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {backTo && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-primary hover:underline"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to {labelOf(backTo)}
            </button>
          )}
          <div role="group" aria-label="Breakdown by" className={TAB_LIST_CLASS}>
            {BY_OPTIONS.map((b) => (
              <button key={b} type="button" aria-pressed={by === b} onClick={() => onByChange(b)} className={tabItemClass(by === b)}>
                {labelOf(b)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <p className="px-4 py-6 text-sm text-rose-700">The breakdown could not be loaded.</p>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${stale ? "opacity-50" : ""}`} aria-busy={stale || loading}>
          <table className="w-full min-w-[860px] border-collapse text-left text-xs">
            <thead>
              <tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-4 py-2.5">
                  {labelOf(shownBy)}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">Gross paid</th>
                <th scope="col" className="px-3 py-2.5 text-right">{term("retention")} held</th>
                <th scope="col" className="px-3 py-2.5 text-right">Released</th>
                <th scope="col" className="px-3 py-2.5 text-right">Net paid</th>
                <th scope="col" className="px-3 py-2.5 text-right">Payments</th>
                <th scope="col" className="px-3 py-2.5 text-right">Exceptions</th>
                <th scope="col" className="px-3 py-2.5 text-right">Projects</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60">
              {loading && !data ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Loading the breakdown...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No payments match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const drill = canDrill(r);
                  return (
                    <tr
                      key={r.key}
                      onClick={drill ? () => onDrill(r) : undefined}
                      className={drill ? "cursor-pointer hover:bg-slate-50/70" : undefined}
                    >
                      <td className="px-4 py-2">
                        {drill ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDrill(r);
                            }}
                            title={DRILL_HINT[shownBy]}
                            className="group inline-flex items-center gap-1 text-left font-semibold text-slate-900 hover:text-brand-primary"
                          >
                            {r.label}
                            <ChevronRight className="h-3 w-3 shrink-0 text-slate-400 group-hover:text-brand-primary" aria-hidden="true" />
                          </button>
                        ) : (
                          <span className="font-semibold text-slate-600">{r.label}</span>
                        )}
                        {contextHeader && r.context && <span className="ml-1.5 text-[11px] text-slate-500">{r.context}</span>}
                        {r.sharedAcrossGroups && (
                          <span
                            className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                            title="Includes a project with sites in several LGAs, counted in full under each"
                          >
                            shared across LGAs
                          </span>
                        )}
                      </td>
                      <TotalsCells t={r} />
                    </tr>
                  );
                })
              )}
            </tbody>
            {data && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-brand-primary/40 bg-slate-50 font-semibold text-slate-900">
                  <th scope="row" className="px-4 py-2.5 text-left">
                    Total
                    <span className="ml-1.5 text-[11px] font-normal text-slate-500">each payment once</span>
                  </th>
                  <TotalsCells t={data.totals} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {showShared && (
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Payments are recorded per project, not per site: a project with sites in several LGAs is counted in full under each of them, so the
          LGA rows add up to more than the total.
        </p>
      )}
    </section>
  );
}

function TotalsCells({ t }: { t: PaymentsBreakdownTotals }) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{formatNaira(t.grossPaidNgn)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNaira(t.retentionHeldNgn)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{t.retentionReleasedNgn ? formatNaira(t.retentionReleasedNgn) : "—"}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatNaira(t.netPaidNgn)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.paymentCount.toLocaleString("en-NG")}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${t.exceptionCount > 0 ? "font-semibold text-amber-800" : "text-slate-500"}`}>
        {t.exceptionCount.toLocaleString("en-NG")}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{t.projectCount.toLocaleString("en-NG")}</td>
    </>
  );
}
