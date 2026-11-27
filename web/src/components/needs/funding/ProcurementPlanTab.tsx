import React, { useMemo, useState } from "react";
import { FilePlus2, Layers } from "lucide-react";
import type { NeedsCycleDocumentDto, NeedsCycleDto, NeedsProcurementPlanRow } from "@insite/shared";
import { StandardTable, TableBadge, type TableColumnDef } from "../../table";
import { primaryButton } from "../../contracts/contractUi";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useProcurementPlanQuery } from "../../../queries/needs/useFundingQueries";
import { EmptyPanel, formatBytes, money, plural } from "../needsUi";
import { stateName } from "../../approvedLists/approvedListUi";
import { AssignLotsDialog } from "./AssignLotsDialog";
import { FundingDocumentDialog, OpenDocumentButton, ProjectCodeLink, ProposalLink } from "./fundingUi";

/**
 * Needs pipeline wave 4 (C3): the Procurement plan tab. Direct Intervention: the drafts converted at
 * the appropriation, each given a lot and batch here (`procurement:plan_lots`: `canPlan`); only drafts
 * without a lot can be assigned. The approved plan document is uploaded beside them. Matching Grants
 * projects take their lots from the BEAP, so the tab only says so.
 */
export function ProcurementPlanTab({ cycle }: { cycle: NeedsCycleDto }) {
  if (cycle.fundingGate === "BEAP_APPROVAL") {
    return (
      <EmptyPanel title="Lots come from the BEAP">
        In Matching Grants the State's BEAP gives every project its lot and procurement method. The projects get their lot and batch numbers when UBEC approves the
        BEAP (BEAP tab).
      </EmptyPanel>
    );
  }
  return <DirectInterventionPlan cycle={cycle} />;
}

const assignable = (r: NeedsProcurementPlanRow) => r.lotId === null && r.projectStatus === "DRAFT";

function DirectInterventionPlan({ cycle }: { cycle: NeedsCycleDto }) {
  const query = useProcurementPlanQuery(cycle.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const plan = query.data;

  const rows = useMemo(
    () =>
      [...(plan?.rows ?? [])].sort(
        (a, b) =>
          Number(a.lotId !== null) - Number(b.lotId !== null) ||
          (a.lotNumber ?? 0) - (b.lotNumber ?? 0) ||
          (a.batchNumber ?? 0) - (b.batchNumber ?? 0) ||
          a.reference.localeCompare(b.reference)
      ),
    [plan?.rows]
  );
  const open = rows.filter(assignable);
  const chosenRows = rows.filter((r) => selected.includes(r.projectId) && assignable(r));
  const canPlan = Boolean(plan?.canPlan);

  if (query.isLoading) {
    return (
      <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
        <span className="sr-only">Loading the procurement plan…</span>
      </div>
    );
  }
  if (query.isError || !plan) {
    return (
      <p role="alert" className="text-xs font-medium text-rose-700">
        The procurement plan could not be loaded.
      </p>
    );
  }

  const allChosen = open.length > 0 && open.every((r) => selected.includes(r.projectId));
  const toggleAll = () => setSelected(allChosen ? [] : open.map((r) => r.projectId));
  const toggle = (id: string, on: boolean) => setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const columns: TableColumnDef<NeedsProcurementPlanRow>[] = [
    ...(canPlan
      ? [
          {
            id: "select",
            header: (
              <input
                type="checkbox"
                aria-label={allChosen ? "Clear the selection" : "Select every project without a lot"}
                checked={allChosen}
                disabled={open.length === 0}
                onChange={toggleAll}
              />
            ),
            width: "w-8",
            cell: (r: NeedsProcurementPlanRow) =>
              assignable(r) ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.reference}`}
                  checked={selected.includes(r.projectId)}
                  onChange={(e) => toggle(r.projectId, e.target.checked)}
                />
              ) : null,
          } satisfies TableColumnDef<NeedsProcurementPlanRow>,
        ]
      : []),
    {
      id: "project",
      header: "Project",
      cell: (r) => (
        <span>
          <ProjectCodeLink projectId={r.projectId} code={r.projectCode} status={r.projectStatus} />
          <span className="block text-[11px] text-slate-600">{r.title}</span>
        </span>
      ),
    },
    { id: "ref", header: "Proposal", cell: (r) => <ProposalLink proposalId={r.proposalId} reference={r.reference} /> },
    { id: "state", header: "State", cell: (r) => <span className="text-slate-700">{r.stateCode ? stateName(r.stateCode) : "–"}</span> },
    { id: "budget", header: "Budget", align: "right", cell: (r) => <span className="whitespace-nowrap tabular-nums text-slate-900">{money(r.budgetNgn)}</span> },
    {
      id: "lot",
      header: "Lot",
      cell: (r) =>
        r.lotNumber !== null ? (
          <span className="text-slate-900">
            <span className="font-semibold">Lot {r.lotNumber}</span>
            {r.lotTitle && <span className="block text-[11px] text-slate-600">{r.lotTitle}</span>}
          </span>
        ) : (
          <TableBadge variant="warning">No lot yet</TableBadge>
        ),
    },
    { id: "batch", header: "Batch", align: "right", cell: (r) => <span className="tabular-nums text-slate-700">{r.batchNumber ?? "–"}</span> },
  ];

  return (
    <div className="space-y-4">
      <StandardTable<NeedsProcurementPlanRow>
        title="Converted projects"
        subtitle={`${plural(rows.length, "draft project")} · ${open.length} without a lot`}
        headerActions={
          canPlan ? (
            <button type="button" className={primaryButton} disabled={chosenRows.length === 0} onClick={() => setAssignOpen(true)}>
              <Layers className="h-3.5 w-3.5" aria-hidden="true" /> Assign to a lot{chosenRows.length ? ` (${chosenRows.length})` : ""}
            </button>
          ) : undefined
        }
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.projectId}
        minWidth="min-w-[820px]"
        emptyState={{
          title: "No converted project yet",
          description: "Funded proposed projects appear here once the appropriated schedule is imported (Funding tab).",
        }}
      />
      {canPlan && open.length > 0 && chosenRows.length === 0 && (
        <p className="text-[11px] text-slate-500">Select the projects that go in one lot, then choose Assign to a lot. Projects that already have a lot keep it.</p>
      )}

      <PlanDocuments cycleId={cycle.id} documents={plan.planDocuments} canPlan={canPlan} onAdd={() => setDocOpen(true)} />

      {assignOpen && chosenRows.length > 0 && (
        <AssignLotsDialog cycleId={cycle.id} plan={plan} rows={chosenRows} onClose={() => setAssignOpen(false)} onAssigned={() => setSelected([])} />
      )}
      {docOpen && (
        <FundingDocumentDialog
          cycleId={cycle.id}
          area="procurement-plan"
          kind="PROCUREMENT_PLAN"
          defaultTitle={`Procurement plan ${plan.interventionYear}`}
          dialogTitle="Upload the approved procurement plan"
          intro="The signed or approved procurement plan for the converted projects."
          onClose={() => setDocOpen(false)}
        />
      )}
    </div>
  );
}

function PlanDocuments({ cycleId, documents, canPlan, onAdd }: { cycleId: string; documents: NeedsCycleDocumentDto[]; canPlan: boolean; onAdd: () => void }) {
  const superseded = new Set(documents.map((d) => d.supersedesId).filter(Boolean));
  const sorted = [...documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const columns: TableColumnDef<NeedsCycleDocumentDto>[] = [
    {
      id: "title",
      header: "Title",
      cell: (d) => (
        <span className={superseded.has(d.id) ? "text-slate-400" : "font-semibold text-slate-900"}>
          {d.title}
          {superseded.has(d.id) && (
            <span className="ml-2">
              <TableBadge variant="neutral">Superseded</TableBadge>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "file",
      header: "File",
      cell: (d) => (
        <span className="block max-w-[14rem] truncate text-slate-700" title={d.fileName}>
          {d.fileName} <span className="text-slate-400">· {formatBytes(d.byteSize)}</span>
        </span>
      ),
    },
    {
      id: "uploaded",
      header: "Uploaded",
      cell: (d) => (
        <span className="whitespace-nowrap text-slate-700">
          {formatDateTimeShort(d.uploadedAt)}
          <span className="block text-[11px] text-slate-500">{d.uploadedByName}</span>
        </span>
      ),
    },
    { id: "open", header: <span className="sr-only">Open</span>, align: "right", cell: (d) => <OpenDocumentButton cycleId={cycleId} documentId={d.id} /> },
  ];
  return (
    <StandardTable<NeedsCycleDocumentDto>
      title="Approved procurement plan"
      headerActions={
        canPlan ? (
          <button type="button" className={primaryButton} onClick={onAdd}>
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Upload plan
          </button>
        ) : undefined
      }
      columns={columns}
      data={sorted}
      keyExtractor={(d) => d.id}
      minWidth="min-w-[640px]"
      emptyState={{
        title: "No plan uploaded",
        description: canPlan ? "Upload the approved procurement plan once the lots are set." : "Procurement uploads the approved plan here.",
      }}
    />
  );
}
