import React, { useMemo, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { CYCLE_DOCUMENT_KIND_META, type NeedsCycleDocumentDto, type NeedsCycleDto } from "@insite/shared";
import { StandardTable, TableBadge, type TableColumnDef } from "../../components/table";
import { primaryButton } from "../../components/contracts/contractUi";
import { NeedsDocumentDialog } from "../../components/needs/NeedsDocumentDialog";
import { formatBytes } from "../../components/needs/needsUi";
import { getCycleDocumentLink } from "../../api/needsPipeline";
import { useNeedsProposalsQuery } from "../../queries/needs/useNeedsQueries";
import { useOpenNeedsFileMutation } from "../../mutations/needs/useNeedsMutations";
import { formatDateTimeShort } from "../../lib/formatters";

/**
 * Needs pipeline wave 2 (C2): the documents that live once on the cycle (D-N.5): circular, reports,
 * minutes, memos … each may cover some proposed projects. A new version supersedes the earlier one,
 * which stays listed (muted). Adding needs `needs:manage_cycle` on an open cycle.
 */
export function CycleDocumentsTab({ cycle, canManage }: { cycle: NeedsCycleDto; canManage: boolean }) {
  const openFile = useOpenNeedsFileMutation();
  const proposalsQuery = useNeedsProposalsQuery(cycle.id, {});
  const proposals = useMemo(() => (proposalsQuery.data ?? []).map((p) => ({ id: p.id, reference: p.reference, title: p.title })), [proposalsQuery.data]);
  const referenceOf = useMemo(() => new Map(proposals.map((p) => [p.id, p.reference])), [proposals]);
  const [dialog, setDialog] = useState<{ supersedes: NeedsCycleDocumentDto | null } | null>(null);

  const supersededIds = useMemo(() => new Set(cycle.documents.map((d) => d.supersedesId).filter((id): id is string => Boolean(id))), [cycle.documents]);
  const rows = useMemo(
    () =>
      [...cycle.documents].sort(
        (a, b) => Number(supersededIds.has(a.id)) - Number(supersededIds.has(b.id)) || b.uploadedAt.localeCompare(a.uploadedAt)
      ),
    [cycle.documents, supersededIds]
  );
  const writable = canManage && cycle.status === "OPEN";

  const columns: TableColumnDef<NeedsCycleDocumentDto>[] = [
    {
      id: "kind",
      header: "Kind",
      cell: (d) => <span className={`whitespace-nowrap ${supersededIds.has(d.id) ? "text-slate-400" : "text-slate-800"}`}>{CYCLE_DOCUMENT_KIND_META[d.kind].label}</span>,
    },
    {
      id: "title",
      header: "Title",
      cell: (d) => {
        const old = supersededIds.has(d.id);
        const refs = d.proposalIds.map((id) => referenceOf.get(id) ?? "").filter(Boolean);
        return (
          <span className={old ? "text-slate-400" : "text-slate-900"}>
            <span className="font-semibold">{d.title}</span>
            {old && (
              <span className="ml-2">
                <TableBadge variant="neutral">Superseded</TableBadge>
              </span>
            )}
            <span className="block text-[11px] text-slate-500">
              {d.proposalIds.length === 0 ? "Whole cycle" : `Covers ${refs.length ? refs.join(", ") : `${d.proposalIds.length} proposed projects`}`}
            </span>
          </span>
        );
      },
    },
    {
      id: "file",
      header: "File",
      cell: (d) => (
        <span className={`block max-w-[14rem] truncate ${supersededIds.has(d.id) ? "text-slate-400" : "text-slate-700"}`} title={d.fileName}>
          {d.fileName} <span className="text-slate-400">· {formatBytes(d.byteSize)}</span>
        </span>
      ),
    },
    {
      id: "uploaded",
      header: "Uploaded",
      cell: (d) => (
        <span className={`whitespace-nowrap ${supersededIds.has(d.id) ? "text-slate-400" : "text-slate-700"}`}>
          {formatDateTimeShort(d.uploadedAt)}
          <span className="block text-[11px] text-slate-500">{d.uploadedByName}</span>
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (d) => (
        <span className="flex justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            className="text-xs font-semibold text-brand-primary hover:underline disabled:opacity-50"
            disabled={openFile.isPending}
            onClick={(e) => {
              e.stopPropagation();
              openFile.mutate(() => getCycleDocumentLink(cycle.id, d.id));
            }}
            aria-label={`Open ${d.title}`}
          >
            Open
          </button>
          {writable && !supersededIds.has(d.id) && !d.generated && (
            <button
              type="button"
              className="text-xs font-semibold text-slate-700 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setDialog({ supersedes: d });
              }}
              aria-label={`Upload a new version of ${d.title}`}
            >
              New version
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <StandardTable<NeedsCycleDocumentDto>
        title="Cycle documents"
        subtitle={`${cycle.documents.length - supersededIds.size} current · ${supersededIds.size} superseded`}
        headerActions={
          writable ? (
            <button type="button" className={primaryButton} onClick={() => setDialog({ supersedes: null })}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Add document
            </button>
          ) : undefined
        }
        columns={columns}
        data={rows}
        keyExtractor={(d) => d.id}
        minWidth="min-w-[820px]"
        emptyState={{
          title: "No cycle documents yet",
          description: writable
            ? "Add the circular, the preliminary needs report and the other papers of the cycle here."
            : "The circular, reports, minutes and memos of the cycle appear here once they are added.",
        }}
      />
      {dialog && (
        <NeedsDocumentDialog
          target="cycle"
          cycleId={cycle.id}
          proposals={proposals}
          supersedes={dialog.supersedes ? { id: dialog.supersedes.id, kind: dialog.supersedes.kind, title: dialog.supersedes.title, proposalIds: dialog.supersedes.proposalIds } : null}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
