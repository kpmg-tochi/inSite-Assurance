import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileUp } from "lucide-react";
import {
  ApprovedListKindEnum,
  type ApprovedListImportResultDto,
  type ApprovedListKind,
  type ApprovedListRowDto,
  type ApprovedListSummaryDto,
} from "@insite/shared";
import { StandardTable, type TableColumnDef } from "../../components/table";
import { CustomSelect } from "../../components/common/CustomSelect";
import {
  APPROVED_LIST_KIND_ABBR,
  APPROVED_LIST_PROJECT_TYPE,
  MatchStatusChip,
  listProvenance,
  projectLabel,
  stateName,
} from "../../components/approvedLists/approvedListUi";
import {
  MATCH_FILTERS,
  filterRows,
  rowStateCode,
  rowsInScope,
  stateCodesOf,
  summarizeRows,
  type MatchFilter,
} from "../../components/approvedLists/approvedListRowFilters";
import { ApprovedListRowDrawer } from "../../components/approvedLists/ApprovedListRowDrawer";
import { ApprovedListUploadDialog } from "../../components/approvedLists/ApprovedListUploadDialog";
import { primaryButton } from "../../components/contracts/contractUi";
import { useApprovedListYearRowsQuery } from "../../queries/approvedLists";
import { useAuth } from "../../lib/auth-context";
import { formatCompactNaira, formatNaira } from "../../lib/formatters";

type FilterKey = "year" | "kind" | "state" | "list" | "match" | "q";

const MATCH_FILTER_LABELS: Record<MatchFilter, string> = {
  LINKED: "Linked",
  MISMATCH: "Budget mismatch",
  MULTIPLE: "Linked to several projects",
  NOT_LINKED: "Not linked",
};

const ALL = "";

/**
 * Client demo updates E3 (wave 3, read-only; wave 4, upload), redesigned 2026-11-26: the Needs
 * assessment page (`/app/needs-assessment`, `approved_lists:view`). One table of every approved list
 * row of an intervention year (GET /approved-lists/rows), filtered by project type (DI schedule or
 * BEAP), State, approved list, match status and a search, all kept in the URL (`?year=&kind=&state=
 * &list=&match=&q=`). A summary strip counts the rows in scope (the mismatch count filters to them);
 * with one list chosen it shows the list's provenance. A row opens a drawer with its full detail.
 * Holders of `approved_lists:manage` upload a list from the template; the saved list is then chosen.
 */
export function NeedsAssessmentPage() {
  const [params, setParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("approved_lists:manage");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const yearParam = Number(params.get("year")) || null;
  const query = useApprovedListYearRowsQuery(yearParam);
  const data = query.data;
  const lists = useMemo(() => data?.lists ?? [], [data]);
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);

  // Filters from the URL; values that do not fit this year's data are ignored.
  const kindParam = params.get("kind");
  const kind = ApprovedListKindEnum.safeParse(kindParam).success ? (kindParam as ApprovedListKind) : null;
  const listParam = params.get("list");
  const listId = listParam && listById.has(listParam) ? listParam : null;
  const stateCode = params.get("state") || null;
  const matchParam = params.get("match");
  const match = MATCH_FILTERS.includes(matchParam as MatchFilter) ? (matchParam as MatchFilter) : null;
  const q = params.get("q") ?? "";

  const scope = useMemo(() => rowsInScope(allRows, listById, { kind, stateCode, listId, match: null, q }), [allRows, listById, kind, stateCode, listId, q]);
  const rows = useMemo(() => filterRows(scope, match), [scope, match]);
  const summary = useMemo(() => summarizeRows(scope), [scope]);
  const selectedList = listId ? listById.get(listId) : undefined;
  const openRow = openRowId ? allRows.find((r) => r.id === openRowId) : undefined;

  const setFilter = (key: FilterKey, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "year") next.delete("list");
    // Keep the chosen list consistent with the type and State.
    const chosen = listId ? listById.get(listId) : undefined;
    if (chosen && key === "kind" && value && chosen.kind !== value) next.delete("list");
    if (chosen && key === "state" && value && chosen.stateCode && chosen.stateCode !== value) next.delete("list");
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    const year = params.get("year");
    if (year) next.set("year", year);
    setParams(next, { replace: true });
  };

  // Wave 4: after an upload, show the saved list (its year and the list itself).
  const onImported = (result: ApprovedListImportResultDto) => {
    setUploadOpen(false);
    const next = new URLSearchParams();
    next.set("year", String(result.list.interventionYear));
    next.set("list", result.list.id);
    setParams(next, { replace: true });
  };

  const yearOptions = (data?.years ?? []).map((y) => ({ value: String(y), label: `Intervention year ${y}` }));
  const kindOptions = [
    { value: ALL, label: "All project types" },
    ...ApprovedListKindEnum.options.map((k) => ({ value: k, label: APPROVED_LIST_PROJECT_TYPE[k], description: k === "MG_BEAP" ? "Approved BEAPs" : "Approved schedule" })),
  ];
  const stateOptions = useMemo(
    () => [
      { value: ALL, label: "All States" },
      ...stateCodesOf(allRows, lists)
        .map((c) => ({ value: c, label: stateName(c) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [allRows, lists],
  );
  const listOptions = [
    { value: ALL, label: "All approved lists" },
    ...lists
      .filter((l) => !kind || l.kind === kind)
      .filter((l) => !stateCode || !l.stateCode || l.stateCode === stateCode)
      .map((l) => ({ value: l.id, label: l.title, description: `${APPROVED_LIST_KIND_ABBR[l.kind]}${l.stateCode ? ` · ${stateName(l.stateCode)}` : ""}` })),
  ];
  const matchOptions = [{ value: ALL, label: "Any match status" }, ...MATCH_FILTERS.map((m) => ({ value: m, label: MATCH_FILTER_LABELS[m] }))];
  const anyFilter = Boolean(kind || stateCode || listId || match || q);
  const year = data?.interventionYear ?? null;
  const tolerancePct = data?.tolerancePct ?? 10;

  const columns: TableColumnDef<ApprovedListRowDto>[] = [
    { id: "ref", header: "Ref", cell: (r) => <span className="whitespace-nowrap font-semibold text-slate-900">{r.rowRef}</span> },
    {
      id: "project",
      header: "Project",
      cell: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenRowId(r.id);
          }}
          title={r.projectTitle}
          aria-label={`${r.rowRef}: ${r.projectTitle}. Open details`}
          className="block max-w-[16rem] xl:max-w-[20rem] truncate rounded text-left font-medium text-slate-900 hover:text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          {r.projectTitle}
        </button>
      ),
    },
    {
      id: "list",
      header: "List / State",
      cell: (r) => {
        const list = listById.get(r.listId);
        const state = rowStateCode(r, list);
        return (
          <span className="whitespace-nowrap text-slate-700" title={list?.title}>
            {list ? APPROVED_LIST_KIND_ABBR[list.kind] : "–"}
            {state ? ` · ${stateName(state)}` : ""}
          </span>
        );
      },
    },
    {
      id: "estimate",
      header: "Estimate",
      align: "right",
      cell: (r) => <span className="whitespace-nowrap tabular-nums text-slate-900">{formatNaira(r.costEstimateNgn)}</span>,
    },
    {
      id: "linked",
      header: "Linked project",
      cell: (r) => {
        if (r.linkedProjects.length === 0) {
          return <span className="whitespace-nowrap text-slate-500">{r.matchStatus === "NOT_LINKED" ? "Not linked" : "Not visible to you"}</span>;
        }
        const [first, ...more] = r.linkedProjects;
        return (
          <span className="whitespace-nowrap text-slate-800" title={r.linkedProjects.map((p) => `${projectLabel(p)} · ${p.name}`).join("\n")}>
            {projectLabel(first)}
            {more.length > 0 && <span className="text-slate-500"> +{more.length} more</span>}
          </span>
        );
      },
    },
    { id: "match", header: "Match", cell: (r) => <MatchStatusChip status={r.matchStatus} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">Needs assessment</h2>
          <p className="text-xs text-slate-500">
            Each year's approved projects. Every project should link to its row; a budget more than ±{tolerancePct}% from the approved estimate is flagged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {yearOptions.length > 0 && (
            <div className="w-52">
              <CustomSelect ariaLabel="Intervention year" value={String(year ?? "")} onChange={(v) => setFilter("year", v)} options={yearOptions} size="sm" />
            </div>
          )}
          {canManage && (
            <button type="button" className={primaryButton} onClick={() => setUploadOpen(true)}>
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload approved list
            </button>
          )}
        </div>
      </div>

      {uploadOpen && <ApprovedListUploadDialog onClose={() => setUploadOpen(false)} onImported={onImported} />}

      {query.isLoading && <div role="status" className="h-24 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none"><span className="sr-only">Loading the approved lists…</span></div>}
      {query.isError && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          The approved lists could not be loaded.
        </p>
      )}

      {data && (data.years.length === 0 || lists.length === 0) && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-slate-800">{data.years.length === 0 ? "No approved lists yet" : `No approved lists for ${year}`}</p>
          <p className="mt-1 text-xs text-slate-500">
            {canManage
              ? "Upload the Direct Intervention schedule or a State's approved BEAP to see its rows here."
              : "Rows appear here once the year's approved lists are uploaded."}
          </p>
          {canManage && (
            <button type="button" className={`${primaryButton} mt-3`} onClick={() => setUploadOpen(true)}>
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload approved list
            </button>
          )}
        </div>
      )}

      {data && lists.length > 0 && (
        <>
          <SummaryStrip
            summary={summary}
            tolerancePct={tolerancePct}
            mismatchActive={match === "MISMATCH"}
            onToggleMismatch={() => setFilter("match", match === "MISMATCH" ? null : "MISMATCH")}
            selectedList={selectedList}
          />

          <StandardTable<ApprovedListRowDto>
            title={selectedList ? selectedList.title : `Approved projects ${year}`}
            subtitle={
              rows.length === allRows.length
                ? `${allRows.length} row${allRows.length === 1 ? "" : "s"} on ${lists.length} approved list${lists.length === 1 ? "" : "s"}`
                : `${rows.length} of ${allRows.length} rows`
            }
            search={{ value: q, onChange: (v) => setFilter("q", v || null), placeholder: "Search ref, project, school or LGA" }}
            filters={
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-44">
                  <CustomSelect ariaLabel="Project type" value={kind ?? ALL} onChange={(v) => setFilter("kind", v || null)} options={kindOptions} size="sm" />
                </div>
                <div className="w-40">
                  <CustomSelect ariaLabel="State" value={stateCode ?? ALL} onChange={(v) => setFilter("state", v || null)} options={stateOptions} size="sm" searchable />
                </div>
                <div className="w-56">
                  <CustomSelect ariaLabel="Approved list" value={listId ?? ALL} onChange={(v) => setFilter("list", v || null)} options={listOptions} size="sm" searchable />
                </div>
                <div className="w-48">
                  <CustomSelect ariaLabel="Match status" value={match ?? ALL} onChange={(v) => setFilter("match", v || null)} options={matchOptions} size="sm" />
                </div>
                {anyFilter && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-primary hover:bg-brand-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            }
            columns={columns}
            data={rows}
            keyExtractor={(r) => r.id}
            onRowClick={(r) => setOpenRowId(r.id)}
            selectedId={openRowId}
            minWidth="min-w-[860px]"
            emptyState={{
              title: "No rows match these filters",
              description: "Try another State, list or match status, or clear the search.",
              action: (
                <button type="button" onClick={clearFilters} className="text-xs font-semibold text-brand-primary hover:underline">
                  Clear filters
                </button>
              ),
            }}
          />
        </>
      )}

      {openRow && (
        <ApprovedListRowDrawer row={openRow} list={listById.get(openRow.listId)} tolerancePct={tolerancePct} onClose={() => setOpenRowId(null)} />
      )}
    </div>
  );
}

/** Rows, total estimate, linked and mismatches for the rows in scope; with one list chosen, its provenance. */
function SummaryStrip({
  summary,
  tolerancePct,
  mismatchActive,
  onToggleMismatch,
  selectedList,
}: {
  summary: ReturnType<typeof summarizeRows>;
  tolerancePct: number;
  mismatchActive: boolean;
  onToggleMismatch: () => void;
  selectedList: ApprovedListSummaryDto | undefined;
}) {
  const { rowCount, totalEstimateNgn, linkedCount, mismatchCount } = summary;
  return (
    <section aria-label="Summary" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <Figure label="Rows" value={String(rowCount)} />
        <Figure label="Total estimate" value={formatCompactNaira(totalEstimateNgn)} title={formatNaira(totalEstimateNgn)} />
        <Figure label="Linked" value={`${linkedCount} / ${rowCount}`} />
        <div className="flex items-center">
          <dt className="sr-only">Budget mismatches</dt>
          <dd>
            {mismatchCount > 0 ? (
              <button
                type="button"
                onClick={onToggleMismatch}
                aria-pressed={mismatchActive}
                title={mismatchActive ? "Show every match status" : `Show only rows with a budget more than ±${tolerancePct}% from the estimate`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 ${
                  mismatchActive ? "border-rose-700 bg-rose-700 text-white" : "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {mismatchCount} budget mismatch{mismatchCount === 1 ? "" : "es"}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                No budget mismatches
              </span>
            )}
          </dd>
        </div>
      </dl>
      {selectedList && (
        <p className="mt-2 truncate border-t border-slate-100 pt-2 text-[11px] text-slate-500" title={listProvenance(selectedList)}>
          {listProvenance(selectedList)}
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-sm font-bold tabular-nums text-slate-900" title={title}>
        {value}
      </dd>
    </div>
  );
}
