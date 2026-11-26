import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import type { OverviewMoney } from "@insite/shared";
import { formatCompactNaira } from "../../../lib/formatters";
import { useTerm } from "../../../lib/auth-context";
import { useProjectPaymentsQuery } from "../../../queries/payments/usePaymentsQueries";
import { CHART_COLORS, GRID_LINE, chartOptions, tooltipHtml, usePrefersReducedMotion } from "./chartTheme";
import { ChartPanel } from "./ChartPanel";
import { LazyChart } from "./LazyChart";
import { fmtQuarter } from "../overviewFormat";

/**
 * "Money": the contract sum (else the budget) as one segmented bar (paid net, retention held,
 * remaining) with each part's figure listed beside its swatch, then gross paid per quarter when
 * payments span more than one quarter.
 */
export function MoneyPanel({ money, projectId, className }: { money: OverviewMoney; projectId: string; className?: string }) {
  const term = useTerm();
  const reducedMotion = usePrefersReducedMotion();
  const payments = useProjectPaymentsQuery(projectId, true);
  const exceptionCount = payments.data?.exceptionCount ?? 0;
  const basisLabel = money.contractSumNgn !== null ? "Contract sum" : "Budget";
  const whole = money.contractSumNgn ?? money.budgetNgn;
  const retentionLabel = `${term("retention")} held`;

  const parts = [
    { key: "paid", label: "Paid (net)", value: Math.max(0, money.paidNetNgn), color: CHART_COLORS.green },
    { key: "retention", label: retentionLabel, value: Math.max(0, money.retentionHeldNgn), color: CHART_COLORS.amber },
    { key: "remaining", label: "Remaining", value: Math.max(0, money.remainingNgn), color: CHART_COLORS.neutral },
  ];
  const partsTotal = parts.reduce((s, p) => s + p.value, 0);
  const share = (v: number) => (partsTotal > 0 ? (v / partsTotal) * 100 : 0);
  const pctOf = (v: number) => (whole > 0 ? `${Math.round((v / whole) * 100)}%` : "–");

  const showQuarters = money.byQuarter.length > 1;
  const quarterChart = useMemo(() => {
    const series = [{ name: "Gross paid", data: money.byQuarter.map((q) => q.paidGrossNgn) }];
    const options = chartOptions(reducedMotion, {
      chart: { type: "bar" },
      colors: [CHART_COLORS.green],
      plotOptions: { bar: { columnWidth: "22px", borderRadius: 4, borderRadiusApplication: "end" } },
      grid: { xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
      xaxis: {
        categories: money.byQuarter.map((q) => fmtQuarter(q.quarter)),
        labels: { style: { fontSize: "11px" }, rotate: 0, hideOverlappingLabels: true },
        axisBorder: { show: true, color: GRID_LINE },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: { min: 0, tickAmount: 3, forceNiceScale: true, labels: { formatter: (v: number) => formatCompactNaira(v), style: { fontSize: "11px" } } },
      states: { hover: { filter: { type: "lighten" } } },
      tooltip: {
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const q = money.byQuarter[dataPointIndex];
          return q ? tooltipHtml(fmtQuarter(q.quarter), [{ color: CHART_COLORS.green, value: formatCompactNaira(q.paidGrossNgn), label: "gross paid" }]) : "";
        },
      },
    });
    return { series, options };
  }, [money.byQuarter, reducedMotion]);

  return (
    <ChartPanel
      className={className}
      title="Money"
      subtitle={`The ${basisLabel.toLowerCase()} split into what is paid, ${term("retention").toLowerCase()} held and what remains.`}
      table={{
        caption: "Money",
        columns: ["Item", "Amount", `% of ${basisLabel.toLowerCase()}`],
        rows: [
          [basisLabel, formatCompactNaira(whole), "100%"],
          ["Gross paid", formatCompactNaira(money.paidGrossNgn), pctOf(money.paidGrossNgn)],
          ...parts.map((p) => [p.label, formatCompactNaira(p.value), pctOf(p.value)]),
          ...(money.retentionReleasedNgn > 0 ? [[`${term("retention")} released`, formatCompactNaira(money.retentionReleasedNgn), pctOf(money.retentionReleasedNgn)]] : []),
          ...money.byQuarter.map((q) => [`Gross paid ${fmtQuarter(q.quarter)}`, formatCompactNaira(q.paidGrossNgn), pctOf(q.paidGrossNgn)]),
        ],
      }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {exceptionCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              {exceptionCount} payment exception{exceptionCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span />
          )}
          <Link
            to={`/app/projects/${projectId}/payments`}
            className="rounded font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            Payments
          </Link>
        </div>
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">{basisLabel}</span> {formatCompactNaira(whole)}
          {money.contractSumNgn !== null && <span className="text-slate-500"> · budget {formatCompactNaira(money.budgetNgn)}</span>}
        </p>
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">{formatCompactNaira(money.paidGrossNgn)}</span> gross paid ({pctOf(money.paidGrossNgn)})
        </p>
      </div>

      {/* One whole, split into parts: blocks in a 28px bar separated by 2px of surface. */}
      <div
        className="mt-2 flex h-7 w-full gap-[2px] overflow-hidden rounded"
        role="img"
        aria-label={`${basisLabel} ${formatCompactNaira(whole)}: ${parts.map((p) => `${p.label.toLowerCase()} ${formatCompactNaira(p.value)}`).join(", ")}.`}
      >
        {partsTotal > 0 ? (
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <div
                key={p.key}
                className="h-full min-w-[3px] rounded"
                style={{ flexGrow: share(p.value), flexBasis: 0, background: p.color }}
                title={`${p.label}: ${formatCompactNaira(p.value)}`}
              />
            ))
        ) : (
          <div className="h-full w-full rounded bg-slate-100" />
        )}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
        {parts.map((p) => (
          <div key={p.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
              {p.label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-slate-900">
              {formatCompactNaira(p.value)} <span className="text-xs font-normal text-slate-500">{pctOf(p.value)}</span>
            </dd>
          </div>
        ))}
      </dl>
      {money.retentionReleasedNgn > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          {formatCompactNaira(money.retentionReleasedNgn)} {term("retention").toLowerCase()} released
        </p>
      )}

      {showQuarters && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="text-xs font-semibold text-slate-700">Paid per quarter</h3>
          <p className="text-xs text-slate-500">Gross paid (before {term("retention").toLowerCase()}) in each quarter.</p>
          <div className="mt-1">
            <LazyChart
              type="bar"
              series={quarterChart.series}
              options={quarterChart.options}
              height={190}
              summary={`Column chart of gross paid per quarter: ${money.byQuarter.map((q) => `${fmtQuarter(q.quarter)} ${formatCompactNaira(q.paidGrossNgn)}`).join(", ")}.`}
            />
          </div>
        </div>
      )}
    </ChartPanel>
  );
}
