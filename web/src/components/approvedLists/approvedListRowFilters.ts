import type { ApprovedListKind, ApprovedListRowDto, ApprovedListSummaryDto } from "@insite/shared";
import { formatProjectCode, lgaByCode } from "@insite/shared";

/**
 * Design refinement (2026-11-26): the Needs assessment table's filters over every row of a year
 * (pure). Kept in the URL as `kind`, `state`, `list`, `match` and `q` (with `year`).
 */

/** "Budget mismatch" covers a MISMATCH row and a row of several projects where one is outside the tolerance. */
export type MatchFilter = "LINKED" | "MISMATCH" | "MULTIPLE" | "NOT_LINKED";

export const MATCH_FILTERS: MatchFilter[] = ["LINKED", "MISMATCH", "MULTIPLE", "NOT_LINKED"];

export interface RowFilters {
  kind: ApprovedListKind | null;
  stateCode: string | null;
  listId: string | null;
  match: MatchFilter | null;
  q: string;
}

/** A row's State: its own, else its list's (a BEAP is per State); null when neither says. */
export function rowStateCode(row: ApprovedListRowDto, list: ApprovedListSummaryDto | undefined): string | null {
  return row.stateCode || list?.stateCode || null;
}

/** A budget outside the tolerance on this row (the row status, or any linked project the caller sees). */
export function rowHasBudgetMismatch(row: ApprovedListRowDto): boolean {
  return row.matchStatus === "MISMATCH" || row.linkedProjects.some((p) => p.mismatch?.flagged);
}

function matchesStatus(row: ApprovedListRowDto, match: MatchFilter): boolean {
  if (match === "MISMATCH") return rowHasBudgetMismatch(row);
  return row.matchStatus === match;
}

function matchesSearch(row: ApprovedListRowDto, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    row.rowRef,
    row.projectTitle,
    row.lotTitle ?? "",
    ...row.schoolNames,
    ...row.lgaCodes.map((c) => lgaByCode(c)?.name ?? c),
    ...row.linkedProjects.flatMap((p) => [formatProjectCode(p.codePrefix), p.codePrefix, p.name]),
  ];
  return haystack.some((t) => t.toLowerCase().includes(needle));
}

/** Rows within the scope filters (type, State, list, search): what the summary strip describes. */
export function rowsInScope(rows: ApprovedListRowDto[], lists: Map<string, ApprovedListSummaryDto>, f: RowFilters): ApprovedListRowDto[] {
  return rows.filter((row) => {
    const list = lists.get(row.listId);
    if (f.kind && list?.kind !== f.kind) return false;
    if (f.listId && row.listId !== f.listId) return false;
    if (f.stateCode) {
      // A row with no State at all (a DI row left blank) shows under every State.
      const state = rowStateCode(row, list);
      if (state && state !== f.stateCode) return false;
    }
    return matchesSearch(row, f.q);
  });
}

/** The table's rows: the scope plus the match status filter. */
export function filterRows(scope: ApprovedListRowDto[], match: MatchFilter | null): ApprovedListRowDto[] {
  return match ? scope.filter((row) => matchesStatus(row, match)) : scope;
}

export interface RowsSummary {
  rowCount: number;
  totalEstimateNgn: number;
  linkedCount: number;
  mismatchCount: number;
}

/** Rows, total estimate, rows linked (programme-level: links the caller cannot see count) and rows with a budget mismatch. */
export function summarizeRows(rows: ApprovedListRowDto[]): RowsSummary {
  return {
    rowCount: rows.length,
    totalEstimateNgn: rows.reduce((sum, r) => sum + r.costEstimateNgn, 0),
    linkedCount: rows.filter((r) => r.matchStatus !== "NOT_LINKED").length,
    mismatchCount: rows.filter(rowHasBudgetMismatch).length,
  };
}

/** States offered by the State filter: the BEAPs' States and the rows' own States. */
export function stateCodesOf(rows: ApprovedListRowDto[], lists: ApprovedListSummaryDto[]): string[] {
  const codes = new Set<string>();
  for (const l of lists) if (l.stateCode) codes.add(l.stateCode);
  for (const r of rows) if (r.stateCode) codes.add(r.stateCode);
  return [...codes];
}
