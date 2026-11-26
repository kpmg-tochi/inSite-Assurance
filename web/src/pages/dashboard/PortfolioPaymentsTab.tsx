import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Hash, Landmark, Receipt, Undo2, Wallet } from "lucide-react";
import {
  FUNDING_SOURCES,
  PAYMENT_EXCEPTION_LABELS,
  PAYMENT_KIND_LABELS,
  PaymentKindEnum,
  formatProjectCode,
  lgaByCode,
  stateByCode,
  zoneName,
  type NigeriaZoneCode,
  type PaymentKind,
  type PaymentsBreakdownBy,
  type PaymentsBreakdownRowDto,
  type PeriodSelection,
  type PortfolioPaymentsBreakdownQuery,
  type PortfolioPaymentRowDto,
  type PortfolioPaymentsQuery,
  type PortfolioPaymentsSummaryDto,
} from "@insite/shared";
import { useTerm } from "../../lib/auth-context";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { useGuardedNavigate } from "../../lib/navigationGuard";
import { CustomSelect, KpiCard } from "../../components/common";
import { lgaOptions, stateOptions, zoneOptions } from "../../components/common/AdminAreaSelect";
import { ExportExcelButton } from "../../components/common/ExportExcelButton";
import { PeriodFilter, browserToday, periodLabel, periodQuery, usePeriodUrlState } from "../../components/common/PeriodFilter";
import { PaidVsContractSumBar } from "../../components/payments/PaidVsContractSumBar";
import { BREAKDOWN_DRILL_NEXT, PaymentsBreakdownPanel } from "../../components/payments/PaymentsBreakdownPanel";
import {
  GROUP_ROW_CLASS,
  PaymentGroupingControl,
  groupPaymentRows,
  paymentListItemKey,
  withGroupRows,
  type PaymentListGrouping,
  type PaymentListItem,
} from "../../components/payments/paymentListGroups";
import { StandardTable, TableBadge, type TableColumnDef } from "../../components/table";
import { usePortfolioPaymentsBreakdownQuery, usePortfolioPaymentsQuery, usePortfolioPaymentsSummaryQuery } from "../../queries/payments/usePaymentsQueries";
import { useProjectTypesQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { useProjectRegisterOptionsQuery } from "../../queries/projects/useProjectsQueries";
import { useExportPortfolioPaymentsMutation } from "../../mutations/screenExports/useScreenExportMutations";

/**
 * Client demo updates G.2: every payment in the period across the projects the user can see (the
 * directory's rule: a SUBEB sees its own), with the period's totals and money against progress.
 * `payments:view` (the workspace home shows the tab only then). The period lives in the URL; the
 * other filters are local to the tab. Wave 4: the Breakdown table (drill zone → State → LGA → project,
 * contractor → project, quarter → month → project) sets the tab's own filters, so the cards, the list
 * and the export follow; the list can be grouped by month or quarter with subtotals from the server.
 */

const PAGE_SIZE = 25;
/** The current fiscal year by default (until approved lists say which year the needs assessment covers). */
const DEFAULT_PERIOD: PeriodSelection = { preset: "THIS_FISCAL_YEAR" };

interface TabFilters {
  zone: "" | NigeriaZoneCode;
  stateCode: string;
  lgaCode: string;
  projectTypeId: string;
  interventionYear: string;
  fundingSourceCode: string;
  contractorOrganizationId: string;
  kind: "" | PaymentKind;
  exceptionsOnly: boolean;
  includeVoided: boolean;
}

const NO_FILTERS: TabFilters = {
  zone: "",
  stateCode: "",
  lgaCode: "",
  projectTypeId: "",
  interventionYear: "",
  fundingSourceCode: "",
  contractorOrganizationId: "",
  kind: "",
  exceptionsOnly: false,
  includeVoided: false,
};

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function PortfolioPaymentsTab({ onOpenProject }: { onOpenProject?: (projectId: string) => void }) {
  const term = useTerm();
  const navigate = useGuardedNavigate();
  const [filters, setFilters] = useState<TabFilters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = usePeriodUrlState(DEFAULT_PERIOD);
  const [calendar, setCalendar] = useState({ today: browserToday(), fiscalYearStartMonth: 1 });
  const debouncedSearch = useDebounced(search.trim());
  const types = useProjectTypesQuery(true).data ?? [];
  const registerOptions = useProjectRegisterOptionsQuery().data;
  const exportPayments = useExportPortfolioPaymentsMutation();
  const [breakdownBy, setBreakdownBy] = useState<PaymentsBreakdownBy>("state");
  const [grouping, setGrouping] = useState<PaymentListGrouping>("none");
  /** Breakdown drills, newest last: what each drill changed, so "Back to <level>" can restore it (WEB-DEMO4-14). */
  const [drillStack, setDrillStack] = useState<Array<{ by: PaymentsBreakdownBy; filters: TabFilters; period: PeriodSelection }>>([]);

  const set = <K extends keyof TabFilters>(key: K, value: TabFilters[K]) => {
    // A filter chosen by hand starts a new path: there is nothing to go back to.
    setDrillStack([]);
    setFilters((f) => {
      const next = { ...f, [key]: value };
      // A zone narrows the states; a state the LGAs.
      if (key === "zone") {
        next.stateCode = "";
        next.lgaCode = "";
      }
      if (key === "stateCode") next.lgaCode = "";
      return next;
    });
  };

  /** The query of the summary and the export (no page, voided only for the list). */
  const query = useMemo<Partial<PortfolioPaymentsQuery>>(() => {
    const q: Partial<PortfolioPaymentsQuery> = {
      ...periodQuery(period, calendar.today, calendar.fiscalYearStartMonth),
      zone: filters.zone || undefined,
      stateCode: filters.stateCode || undefined,
      lgaCode: filters.lgaCode || undefined,
      projectTypeId: filters.projectTypeId || undefined,
      interventionYear: filters.interventionYear ? Number(filters.interventionYear) : undefined,
      fundingSourceCode: filters.fundingSourceCode || undefined,
      contractorOrganizationId: filters.contractorOrganizationId || undefined,
      kind: filters.kind || undefined,
      exceptionsOnly: filters.exceptionsOnly ? "true" : undefined,
      search: debouncedSearch || undefined,
    };
    (Object.keys(q) as Array<keyof PortfolioPaymentsQuery>).forEach((k) => q[k] === undefined && delete q[k]);
    return q;
  }, [period, calendar, filters, debouncedSearch]);
  const listQuery = useMemo(
    () => ({ ...query, ...(filters.includeVoided ? { includeVoided: "true" as const } : {}), page, pageSize: PAGE_SIZE }),
    [query, filters.includeVoided, page]
  );
  // Any change of filter starts from the first page.
  useEffect(() => setPage(1), [query, filters.includeVoided]);

  const summaryQ = usePortfolioPaymentsSummaryQuery(query);
  const listQ = usePortfolioPaymentsQuery(listQuery);
  const breakdownQuery = useMemo<Partial<PortfolioPaymentsBreakdownQuery>>(() => ({ ...query, by: breakdownBy }), [query, breakdownBy]);
  const groupingQuery = useMemo<Partial<PortfolioPaymentsBreakdownQuery>>(
    () => ({ ...query, by: grouping === "none" ? undefined : grouping }),
    [query, grouping]
  );
  const breakdownQ = usePortfolioPaymentsBreakdownQuery(breakdownQuery);
  const groupingQ = usePortfolioPaymentsBreakdownQuery(groupingQuery, grouping !== "none");
  const summary = summaryQ.data;
  const list = listQ.data;
  useEffect(() => {
    if (summary && (summary.today !== calendar.today || summary.fiscalYearStartMonth !== calendar.fiscalYearStartMonth)) {
      setCalendar({ today: summary.today, fiscalYearStartMonth: summary.fiscalYearStartMonth });
    }
  }, [summary, calendar]);

  /** The export: the list's filters and the Breakdown's grouping (sheet Breakdown). */
  const exportQuery: Partial<PortfolioPaymentsBreakdownQuery> = { ...listQuery, page: undefined, pageSize: undefined, by: breakdownBy };
  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const anyFilter = Object.keys(query).some((k) => k !== "from" && k !== "to") || filters.includeVoided;
  const openPayments = (projectId: string) => navigate(`/app/projects/${projectId}/payments`);

  /** Drill down: narrow the tab's own filters (or the period), then show the next level. */
  const drill = (row: PaymentsBreakdownRowDto) => {
    const by = breakdownQ.data?.by ?? breakdownBy;
    const next = BREAKDOWN_DRILL_NEXT[by];
    if (by !== "project") setDrillStack((s) => [...s, { by, filters, period }]);
    switch (by) {
      case "project":
        openPayments(row.key);
        return;
      case "zone":
        setFilters((f) => ({ ...f, zone: row.key as NigeriaZoneCode, stateCode: "", lgaCode: "" }));
        break;
      case "state":
        setFilters((f) => ({ ...f, zone: f.zone && f.zone !== stateZone(row.key) ? "" : f.zone, stateCode: row.key, lgaCode: "" }));
        break;
      case "lga": {
        const stateCode = lgaByCode(row.key)?.stateCode;
        if (!stateCode) return;
        setFilters((f) => ({ ...f, zone: f.zone && f.zone !== stateZone(stateCode) ? "" : f.zone, stateCode, lgaCode: row.key }));
        break;
      }
      case "contractor":
        setFilters((f) => ({ ...f, contractorOrganizationId: row.key }));
        break;
      case "quarter": {
        const m = /^(\d{4})-Q([1-4])$/.exec(row.key);
        if (!m) return;
        setPeriod({ preset: "QUARTER", fiscalYear: Number(m[1]), quarter: Number(m[2]) });
        break;
      }
      case "month": {
        const m = /^(\d{4})-(\d{2})$/.exec(row.key);
        if (!m) return;
        const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
        setPeriod({ preset: "CUSTOM", from: `${row.key}-01`, to: `${row.key}-${String(last).padStart(2, "0")}` });
        break;
      }
    }
    if (next) setBreakdownBy(next);
  };

  /** Back up one drill: the filters, period and grouping as they were before it. */
  const lastDrill = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;
  const drillBack = () => {
    if (!lastDrill) return;
    setFilters(lastDrill.filters);
    setPeriod(lastDrill.period);
    setBreakdownBy(lastDrill.by);
    setDrillStack((s) => s.slice(0, -1));
  };
  const chooseBreakdownBy = (by: PaymentsBreakdownBy) => {
    setDrillStack([]);
    setBreakdownBy(by);
  };

  const listItems = useMemo(
    () => groupPaymentRows(list?.rows ?? [], grouping, calendar.fiscalYearStartMonth, groupingQ.data),
    [list, grouping, calendar.fiscalYearStartMonth, groupingQ.data]
  );

  const paymentColumns: TableColumnDef<PortfolioPaymentRowDto>[] = [
    { id: "date", header: "Paid on", width: "w-28", cell: (p) => <span className="whitespace-nowrap text-xs tabular-nums">{formatDateShort(p.paidOn)}</span> },
    {
      id: "project",
      header: "Project",
      cell: (p) => (
        <div className={p.voided ? "text-slate-400" : undefined}>
          <p className="text-xs font-bold text-slate-900">
            {formatProjectCode(p.projectCode)}
            {p.interventionYear ? <span className="font-normal text-slate-500"> · {p.interventionYear}</span> : null}
          </p>
          {onOpenProject ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenProject(p.projectId);
              }}
              className="text-left text-[11px] text-slate-600 hover:text-brand-primary hover:underline"
              title="Open the project"
            >
              {p.projectName}
            </button>
          ) : (
            <p className="text-[11px] text-slate-600">{p.projectName}</p>
          )}
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      width: "w-32",
      cell: (p) => (
        <span className="text-xs text-slate-700">
          {p.stateName ?? "—"}
          {p.zone && <span className="block text-[11px] text-slate-500">{zoneName(p.zone)}</span>}
        </span>
      ),
    },
    { id: "contractor", header: term("contractor"), width: "w-40", cell: (p) => <span className="text-xs text-slate-700">{p.contractorName ?? "—"}</span> },
    {
      id: "what",
      header: "Payment",
      width: "w-40",
      cell: (p) => (
        <div>
          <p className={`text-xs font-semibold ${p.voided ? "text-slate-400 line-through" : "text-slate-900"}`}>{PAYMENT_KIND_LABELS[p.kind]}</p>
          <p className="text-[11px] text-slate-500">{p.reference}</p>
          {p.voided && <p className="text-[11px] text-rose-600">Voided</p>}
        </div>
      ),
    },
    {
      id: "gross",
      header: "Gross",
      width: "w-32",
      align: "right",
      cell: (p) => <span className="text-xs tabular-nums">{formatNaira(p.grossAmountNgn)}</span>,
    },
    {
      id: "held",
      header: term("retention"),
      width: "w-32",
      align: "right",
      cell: (p) => (
        <span className="text-xs tabular-nums text-slate-600">
          {p.kind === "RETENTION_RELEASE" ? `${formatNaira(p.grossAmountNgn)} released` : p.retentionHeldNgn ? formatNaira(p.retentionHeldNgn) : "—"}
        </span>
      ),
    },
    {
      id: "net",
      header: "Net",
      width: "w-32",
      align: "right",
      cell: (p) => <span className="text-xs font-semibold tabular-nums">{formatNaira(p.netAmountNgn)}</span>,
    },
    {
      id: "exceptions",
      header: "Checks",
      width: "w-44",
      cell: (p) =>
        p.exceptions.length === 0 ? (
          <TableBadge variant="success">No exceptions</TableBadge>
        ) : (
          <div className="space-y-1">
            {p.exceptions.map((e) => (
              <p key={e} className="flex items-start gap-1 text-[11px] text-amber-800">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {PAYMENT_EXCEPTION_LABELS[e]}
              </p>
            ))}
          </div>
        ),
    },
  ];

  const fundingOptions = [{ value: "", label: "All funding sources" }, ...FUNDING_SOURCES.map((f) => ({ value: f.code, label: f.label }))];
  const yearOptions = [{ value: "", label: "All intervention years" }, ...(registerOptions?.interventionYears ?? []).map((y) => ({ value: String(y), label: String(y) }))];
  const contractorOptions = [{ value: "", label: `All ${term("contractor", { lower: true })}s` }, ...(registerOptions?.contractors ?? []).map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div className="space-y-4">
      <section aria-label="Payment filters" className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
        <PeriodFilter value={period} onChange={setPeriod} today={calendar.today} fiscalYearStartMonth={calendar.fiscalYearStartMonth} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <CustomSelect ariaLabel="Zone" value={filters.zone} onChange={(v) => set("zone", v as TabFilters["zone"])} options={zoneOptions("All zones")} size="sm" />
          </div>
          <div className="w-40">
            <CustomSelect
              ariaLabel="State"
              value={filters.stateCode}
              onChange={(v) => set("stateCode", v)}
              options={stateOptions(filters.zone || null, "All states")}
              size="sm"
              searchable
            />
          </div>
          <div className="w-44">
            <CustomSelect
              ariaLabel="LGA"
              value={filters.lgaCode}
              onChange={(v) => set("lgaCode", v)}
              options={filters.stateCode ? lgaOptions(filters.stateCode, "All LGAs") : [{ value: "", label: "All LGAs (choose a state)" }]}
              size="sm"
              searchable
              disabled={!filters.stateCode}
            />
          </div>
          {types.length > 0 && (
            <div className="w-48">
              <CustomSelect
                ariaLabel="Delivery model"
                value={filters.projectTypeId}
                onChange={(v) => set("projectTypeId", v)}
                options={[{ value: "", label: "All delivery models" }, ...types.map((t) => ({ value: t.id, label: t.name }))]}
                size="sm"
              />
            </div>
          )}
          <div className="w-44">
            <CustomSelect ariaLabel="Intervention year" value={filters.interventionYear} onChange={(v) => set("interventionYear", v)} options={yearOptions} size="sm" />
          </div>
          <div className="w-52">
            <CustomSelect ariaLabel="Funding source" value={filters.fundingSourceCode} onChange={(v) => set("fundingSourceCode", v)} options={fundingOptions} size="sm" />
          </div>
          {contractorOptions.length > 1 && (
            <div className="w-52">
              <CustomSelect
                ariaLabel={term("contractor")}
                value={filters.contractorOrganizationId}
                onChange={(v) => set("contractorOrganizationId", v)}
                options={contractorOptions}
                size="sm"
                searchable={contractorOptions.length > 8}
              />
            </div>
          )}
          <div className="w-44">
            <CustomSelect
              ariaLabel="Payment type"
              value={filters.kind}
              onChange={(v) => set("kind", v as TabFilters["kind"])}
              options={[{ value: "", label: "All payment types" }, ...PaymentKindEnum.options.map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] }))]}
              size="sm"
            />
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={filters.exceptionsOnly} onChange={(e) => set("exceptionsOnly", e.target.checked)} /> Exceptions only
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={filters.includeVoided} onChange={(e) => set("includeVoided", e.target.checked)} /> Show voided
          </label>
          {anyFilter && (
            <button
              type="button"
              onClick={() => {
                setFilters(NO_FILTERS);
                setSearch("");
                // Back to the grouping the drills started from.
                if (drillStack.length > 0) setBreakdownBy(drillStack[0].by);
                setDrillStack([]);
              }}
              className="text-xs font-semibold text-brand-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {summaryQ.isError && <p className="text-sm text-rose-700">The payment totals could not be loaded.</p>}
      {summary && <SummaryCards s={summary} period={periodLabel(period, calendar.today, calendar.fiscalYearStartMonth)} />}
      {summary && <MoneyAgainstProgress s={summary} />}

      <PaymentsBreakdownPanel
        by={breakdownBy}
        onByChange={chooseBreakdownBy}
        data={breakdownQ.data}
        loading={breakdownQ.isFetching}
        error={breakdownQ.isError}
        onDrill={drill}
        backTo={lastDrill?.by ?? null}
        onBack={drillBack}
      />

      <StandardTable<PaymentListItem>
        title="Payments"
        subtitle={
          list
            ? `${list.total} payment(s)${filters.includeVoided ? " incl. voided" : ""} · newest first${
                grouping !== "none" ? " · subtotals cover every payment in the period, voided not counted" : ""
              }`
            : undefined
        }
        search={{ value: search, onChange: setSearch, placeholder: "Search references, projects" }}
        filters={<PaymentGroupingControl value={grouping} onChange={setGrouping} />}
        headerActions={<ExportExcelButton onDark pending={exportPayments.isPending} onClick={() => exportPayments.mutate(exportQuery)} />}
        columns={withGroupRows(paymentColumns, groupingQ.isFetching)}
        data={listItems}
        keyExtractor={paymentListItemKey}
        onRowClick={(item) => {
          if (item.type === "payment") openPayments(item.payment.projectId);
        }}
        rowClassName={(item) => (item.type === "group" ? GROUP_ROW_CLASS : item.payment.voided ? "opacity-70" : "")}
        loading={listQ.isLoading}
        pageSize={false}
        footer={
          list && list.total > list.pageSize ? (
            <nav aria-label="Payments pages" className="flex items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                {(list.page - 1) * list.pageSize + 1}–{Math.min(list.total, list.page * list.pageSize)} of {list.total}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((n) => Math.max(1, n - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="tabular-nums">
                  Page {page} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((n) => Math.min(pageCount, n + 1))}
                  disabled={page >= pageCount}
                  className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </nav>
          ) : undefined
        }
        emptyState={
          anyFilter
            ? { title: "No payments match", description: "Change the period or clear the filters." }
            : { title: "No payments in this period", description: "Payments recorded on the projects you can see appear here." }
        }
      />
    </div>
  );
}

function SummaryCards({ s, period }: { s: PortfolioPaymentsSummaryDto; period: string }) {
  const term = useTerm();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        title="Gross paid"
        value={formatNaira(s.grossPaidNgn)}
        subtitle={`${period} · interim and final payments`}
        icon={<Receipt className="h-4 w-4" />}
      />
      <KpiCard
        title={`${term("retention")} held`}
        value={formatNaira(s.retentionHeldNgn)}
        subtitle="Held from the period's payments"
        icon={<Landmark className="h-4 w-4" />}
        iconVariant="amber"
      />
      <KpiCard
        title={`${term("retention")} released`}
        value={formatNaira(s.retentionReleasedNgn)}
        subtitle="Releases paid in the period"
        icon={<Undo2 className="h-4 w-4" />}
        iconVariant="slate"
      />
      <KpiCard
        title={`Net paid to ${term("contractor", { lower: true })}s`}
        value={formatNaira(s.netPaidNgn)}
        subtitle={`After ${term("retention", { lower: true })}, releases included`}
        icon={<Wallet className="h-4 w-4" />}
        iconVariant="emerald"
      />
      <KpiCard
        title="Payments"
        value={s.paymentCount.toLocaleString("en-NG")}
        subtitle={`On ${s.projectCount} project(s) · voided not counted`}
        icon={<Hash className="h-4 w-4" />}
        iconVariant="slate"
      />
      <KpiCard
        title="Payments with exceptions"
        value={s.exceptionCount.toLocaleString("en-NG")}
        subtitle={s.exceptionCount > 0 ? "Recorded against a rule, not blocked" : "None in the period"}
        icon={<AlertTriangle className="h-4 w-4" />}
        iconVariant={s.exceptionCount > 0 ? "rose" : "emerald"}
      />
    </div>
  );
}

/** The IRL "money against progress" view: to date, over the projects matching the filters. */
function MoneyAgainstProgress({ s }: { s: PortfolioPaymentsSummaryDto }) {
  const m = s.moneyVsProgress;
  const gap = m.paidPct !== null && m.progressPct !== null ? Math.round((m.paidPct - m.progressPct) * 10) / 10 : null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section aria-labelledby="pp-paid-vs-sum" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 id="pp-paid-vs-sum" className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Paid against contract sum
        </h2>
        <PaidVsContractSumBar paidNgn={m.paidToDateNgn} contractSumNgn={m.contractSumNgn > 0 ? m.contractSumNgn : null} />
        <p className="mt-1.5 text-[11px] text-slate-500">
          Net paid to date on the {m.projectCount} project(s) matching the filters, whatever the period; voided entries not counted.
        </p>
      </section>
      <section aria-labelledby="pp-paid-vs-work" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 id="pp-paid-vs-work" className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Paid against work done
        </h2>
        {m.paidPct === null || m.progressPct === null ? (
          <p className="text-sm text-slate-600">No contract sums recorded on these projects, so payments cannot be set against work done.</p>
        ) : (
          <div className="space-y-2">
            <Meter label="Paid (share of contract sum)" pct={m.paidPct} tone={gap !== null && gap > 0 ? "warn" : "brand"} />
            <Meter label="Work done (% complete, weighted by contract sum)" pct={m.progressPct} tone="ok" />
            <p className={`text-[11px] ${gap !== null && gap > 0 ? "font-semibold text-amber-800" : "text-slate-500"}`}>
              {gap === null
                ? ""
                : gap > 0
                  ? `Paid ${gap} percentage points ahead of work done.`
                  : gap < 0
                    ? `Work done is ${Math.abs(gap)} percentage points ahead of payments.`
                    : "Payments and work done are level."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function Meter({ label, pct, tone }: { label: string; pct: number; tone: "brand" | "ok" | "warn" }) {
  const width = Math.min(100, Math.max(0, pct));
  const bar = tone === "warn" ? "bg-amber-500" : tone === "ok" ? "bg-emerald-600" : "bg-brand-primary";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-700">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{pct}%</span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/** The zone of a State code ("" when unknown), to keep a drilled zone filter consistent. */
function stateZone(stateCode: string): string {
  return stateByCode(stateCode)?.zone ?? "";
}

export default PortfolioPaymentsTab;
