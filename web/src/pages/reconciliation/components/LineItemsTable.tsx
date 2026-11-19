import type { IpcClaimDto, IpcLineItemDto } from "@insite/shared";
import {
  StandardTable,
  TableActionButton,
  TableBadge,
  type TableColumnDef,
} from "../../../components/table";
import { EvidenceBadge, ratingTone } from "../../../components/EvidenceBadge";
import { QUERY_STATUS_CHIP } from "../../../components/EvidenceOverlayDrawer";
import { displayCurrencySymbol, formatCompactNaira, formatDateShort } from "../../../lib/formatters";

export function LineItemsTable({
  ipc,
  selectedLineId,
  onSelectLine,
  showHoldPoints = true,
}: {
  ipc: IpcClaimDto;
  selectedLineId: string | null;
  onSelectLine: (line: IpcLineItemDto) => void;
  /** False when the project turned hold points off (Phase 7). */
  showHoldPoints?: boolean;
}) {
  const columns: TableColumnDef<IpcLineItemDto>[] = [
    {
      id: "wbsCode",
      header: "WBS ID",
      tooltip: "Work Breakdown Structure reference from the baseline Bill of Quantities",
      width: "w-32",
      cell: (li) => {
        const latestQuery = li.queries[0];
        return (
          <div className="space-y-1">
            <span className="font-bold text-slate-900 text-xs">{li.boqItem.wbsCode}</span>
            <div className="flex flex-col gap-1 items-start">
              {showHoldPoints && li.boqItem.isHoldPoint && (
                <TableBadge variant={li.missingHoldPointFlag ? "danger" : "warning"}>
                  {li.missingHoldPointFlag ? "Hold point unmet" : "Hold point"}
                </TableBadge>
              )}
              {latestQuery && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${QUERY_STATUS_CHIP[latestQuery.status]}`}>
                  Query {latestQuery.status.toLowerCase()}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: "description",
      header: "Work Item",
      tooltip: "Baseline work item description and bill section",
      width: "w-80",
      cell: (li) => (
        <div className="max-w-xs">
          <div className="text-slate-800 font-medium leading-snug line-clamp-2">{li.boqItem.description}</div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {li.boqItem.section} · {li.boqItem.totalQuantity.toLocaleString()} {li.boqItem.unit}
          </div>
        </div>
      ),
    },
    {
      id: "budget",
      header: `Budget (${displayCurrencySymbol()})`,
      tooltip: "Baseline budgeted cost of this BOQ line",
      align: "right",
      cell: (li) => <span className="text-slate-600 font-medium">{formatCompactNaira(li.boqItem.budgetedCostNgn)}</span>,
    },
    {
      id: "claim",
      header: "Contractor Claim",
      tooltip: "Cumulative percentage claimed and the amount computed by the server",
      align: "right",
      cell: (li) => (
        <div>
          <div className="font-bold text-slate-900">{li.contractorClaimedPct}%</div>
          <div className="text-[11px] text-slate-500">{formatCompactNaira(li.contractorClaimedNgn)}</div>
        </div>
      ),
    },
    {
      id: "evidenceRating",
      header: "Evidence Rating",
      tooltip: "Evidence strength rating, with the reconciliation rules enforced",
      cell: (li) => (
        <div className="space-y-0.5">
          <EvidenceBadge rating={li.aiEvidenceRating} />
          {li.evidenceCoveragePct !== null && (
            <div className="text-[10px] text-slate-400">Coverage {li.evidenceCoveragePct}%</div>
          )}
        </div>
      ),
    },
    {
      id: "corroborationTier",
      header: "Corroboration Role",
      tooltip: "Highest assurance-weight role among the evidence considered",
      cell: (li) => {
        const weight = li.highestCorroboratingWeight ?? 0;
        return (
          <div>
            <TableBadge variant={weight >= 0.9 ? "info" : weight >= 0.7 ? "success" : "neutral"}>
              {li.highestCorroboratingRoleName || "No evidence"}
            </TableBadge>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {li.corroboratingEvidenceLogIds.length} corroborating log{li.corroboratingEvidenceLogIds.length === 1 ? "" : "s"}
            </div>
          </div>
        );
      },
    },
    {
      id: "monitorValuation",
      header: "Monitor Valuation",
      tooltip: "Cumulative percentage and amount certified by the monitor",
      align: "right",
      cell: (li) =>
        li.monitorCertifiedPct === null ? (
          <span className="text-[11px] text-slate-400">Not certified</span>
        ) : (
          <div>
            <div className={`font-bold ${li.monitorCertifiedPct < li.contractorClaimedPct ? "text-amber-700" : "text-emerald-700"}`}>
              {li.monitorCertifiedPct}%
            </div>
            <div className="text-[11px] text-slate-500">{formatCompactNaira(li.monitorCertifiedNgn ?? 0)}</div>
          </div>
        ),
    },
    {
      id: "actions",
      header: "Evidence",
      tooltip: "Open the evidence and query thread for this line",
      align: "right",
      width: "w-28",
      cell: (li) => {
        const needsAttention = li.queries.some((q) => q.status === "OPEN" || q.status === "RESPONDED");
        return (
          <TableActionButton onClick={() => onSelectLine(li)} variant={needsAttention ? "primary" : "default"}>
            {needsAttention ? "Review query" : "Inspect"}
          </TableActionButton>
        );
      },
    },
  ];

  return (
    <StandardTable<IpcLineItemDto>
      title={`IPC #${String(ipc.ipcNumber).padStart(2, "0")}: Claim vs. Field Evidence`}
      subtitle={`${formatDateShort(ipc.periodStart)} to ${formatDateShort(ipc.periodEnd)}`}
      minWidth="min-w-[980px]"
      columns={columns}
      data={ipc.lineItems}
      keyExtractor={(li) => li.id}
      selectedId={selectedLineId ?? undefined}
      onRowClick={onSelectLine}
      rowClassName={(li) => (showHoldPoints && li.missingHoldPointFlag ? ratingTone("CONTRADICTED").row : ratingTone(li.aiEvidenceRating).row)}
    />
  );
}
