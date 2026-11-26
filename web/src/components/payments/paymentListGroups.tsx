import { AlertTriangle } from "lucide-react";
import {
  paymentPeriodGroup,
  type PaymentsBreakdownDto,
  type PaymentsBreakdownRowDto,
  type PortfolioPaymentRowDto,
} from "@insite/shared";
import { formatNaira } from "../../lib/formatters";
import type { TableColumnDef } from "../table";
import { TAB_LIST_CLASS, tabItemClass } from "../common/Tabs";

/**
 * Client demo updates wave 4 (G.1, decision W4.5): "Group by month / quarter" on the portfolio
 * payments list. The list stays paged on the server; on each page a subtotal row is put before the
 * first payment of each month or quarter. The subtotals come from the breakdown endpoint (same
 * filters, `by=month|quarter`), so they cover every matching payment, not only the page; voided
 * payments are never counted.
 */

export type PaymentListGrouping = "none" | "month" | "quarter";

export type PaymentListItem =
  | { type: "payment"; payment: PortfolioPaymentRowDto }
  | { type: "group"; key: string; label: string; subtotal: PaymentsBreakdownRowDto | null };

export function groupPaymentRows(
  rows: PortfolioPaymentRowDto[],
  grouping: PaymentListGrouping,
  fiscalYearStartMonth: number,
  breakdown: PaymentsBreakdownDto | undefined
): PaymentListItem[] {
  if (grouping === "none") return rows.map((payment) => ({ type: "payment", payment }));
  const subtotals = new Map((breakdown?.by === grouping ? breakdown.rows : []).map((r) => [r.key, r]));
  const out: PaymentListItem[] = [];
  let current: string | null = null;
  for (const payment of rows) {
    const g = paymentPeriodGroup(payment.paidOn, grouping, fiscalYearStartMonth);
    if (g.key !== current) {
      current = g.key;
      out.push({ type: "group", key: g.key, label: g.label, subtotal: subtotals.get(g.key) ?? null });
    }
    out.push({ type: "payment", payment });
  }
  return out;
}

export const paymentListItemKey = (item: PaymentListItem) => (item.type === "payment" ? item.payment.id : `group:${item.key}`);

/** The payment columns, with a subtotal cell per column for group rows (by column id). */
export function withGroupRows(columns: TableColumnDef<PortfolioPaymentRowDto>[], loadingSubtotals: boolean): TableColumnDef<PaymentListItem>[] {
  return columns.map((col) => ({
    ...col,
    cell: (item: PaymentListItem, index: number) => (item.type === "payment" ? col.cell(item.payment, index) : groupCell(col.id, item, loadingSubtotals)),
  }));
}

function groupCell(columnId: string, g: Extract<PaymentListItem, { type: "group" }>, loading: boolean) {
  const s = g.subtotal;
  switch (columnId) {
    case "date":
      return <span className="text-xs font-bold text-slate-900">{g.label}</span>;
    case "project":
      return (
        <span className="text-[11px] font-semibold text-slate-700">
          {s
            ? `Subtotal · ${s.paymentCount} payment(s) on ${s.projectCount} project(s)`
            : loading
              ? "Subtotal loading..."
              : "Subtotal · no counted payments"}
        </span>
      );
    case "gross":
      return s ? <span className="text-xs font-semibold tabular-nums">{formatNaira(s.grossPaidNgn)}</span> : null;
    case "held":
      return s ? (
        <span className="text-xs font-semibold tabular-nums text-slate-700">
          {formatNaira(s.retentionHeldNgn)}
          {s.retentionReleasedNgn > 0 && <span className="block text-[11px] font-normal">{formatNaira(s.retentionReleasedNgn)} released</span>}
        </span>
      ) : null;
    case "net":
      return s ? <span className="text-xs font-bold tabular-nums">{formatNaira(s.netPaidNgn)}</span> : null;
    case "exceptions":
      return s && s.exceptionCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {s.exceptionCount} with exceptions
        </span>
      ) : null;
    default:
      return null;
  }
}

export const GROUP_ROW_CLASS = "bg-brand-primary/[0.06] border-t-2 border-brand-primary/30";

const GROUPING_LABELS: Record<PaymentListGrouping, string> = { none: "None", month: "Month", quarter: "Quarter" };

export function PaymentGroupingControl({ value, onChange }: { value: PaymentListGrouping; onChange: (v: PaymentListGrouping) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-slate-600">Group by</span>
      <div role="group" aria-label="Group payments by" className={TAB_LIST_CLASS}>
        {(Object.keys(GROUPING_LABELS) as PaymentListGrouping[]).map((g) => (
          <button key={g} type="button" aria-pressed={value === g} onClick={() => onChange(g)} className={tabItemClass(value === g)}>
            {GROUPING_LABELS[g]}
          </button>
        ))}
      </div>
    </div>
  );
}
