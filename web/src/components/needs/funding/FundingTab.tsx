import React, { useMemo, useState } from "react";
import { FileSpreadsheet, Plus } from "lucide-react";
import type { NeedsConvertedProposal, NeedsCycleDto, NeedsFundingRecordDto, NeedsSubmissionItemDto } from "@insite/shared";
import { StandardTable, type TableColumnDef } from "../../table";
import { primaryButton, secondaryButton } from "../../contracts/contractUi";
import { formatDateShort } from "../../../lib/formatters";
import { useNeedsFundingQuery } from "../../../queries/needs/useFundingQueries";
import { useDownloadAppropriationTemplateMutation } from "../../../mutations/needs/useFundingMutations";
import { cardCls, locationText, money, plural } from "../needsUi";
import { AppropriationImportDialog } from "./AppropriationImportDialog";
import { BeapWorkspace } from "./BeapWorkspace";
import { BudgetSubmissionDialog } from "./BudgetSubmissionDialog";
import { Figure, Notice, OpenDocumentButton, ProjectCodeLink, ProposalLink } from "./fundingUi";

/**
 * Needs pipeline wave 4 (C2, C3): the Funding tab of a cycle. A Matching Grants cycle (funding gate
 * BEAP_APPROVAL) shows the BEAP workspace; a Direct Intervention cycle shows the budget submission
 * records, the appropriated schedule import (Finance, `needs:record_funding` in the owning
 * organisation: `canRecord`), the proposed projects waiting for funding and the projects converted.
 */
export function FundingTab({ cycle }: { cycle: NeedsCycleDto }) {
  if (cycle.fundingGate === "BEAP_APPROVAL") return <BeapWorkspace cycle={cycle} />;
  return <DirectInterventionFunding cycle={cycle} />;
}

function DirectInterventionFunding({ cycle }: { cycle: NeedsCycleDto }) {
  const query = useNeedsFundingQuery(cycle.id);
  const template = useDownloadAppropriationTemplateMutation(cycle.id);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const funding = query.data;
  const budgetRecords = useMemo(
    () => (funding?.records ?? []).filter((r) => r.kind === "BUDGET_SUBMISSION").sort((a, b) => b.recordedOn.localeCompare(a.recordedOn)),
    [funding?.records]
  );
  const appropriation = useMemo(
    () => (funding?.records ?? []).filter((r) => r.kind === "APPROPRIATION").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    [funding?.records]
  );

  if (query.isLoading) {
    return (
      <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
        <span className="sr-only">Loading the funding…</span>
      </div>
    );
  }
  if (query.isError || !funding) {
    return (
      <p role="alert" className="text-xs font-medium text-rose-700">
        The funding of this cycle could not be loaded.
      </p>
    );
  }

  const awaitingTotal = funding.awaiting.reduce((sum, i) => sum + (i.amountNgn ?? 0), 0);
  const convertedTotal = funding.converted.reduce((sum, c) => sum + c.fundedAmountNgn, 0);
  const canImport = funding.canRecord && !appropriation && funding.awaiting.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Waiting for funding" value={String(funding.awaiting.length)} hint={money(awaitingTotal)} />
        <Figure label="Budget submissions" value={String(budgetRecords.length)} />
        <Figure label="Appropriation" value={appropriation ? formatDateShort(appropriation.recordedOn) : "Not recorded"} />
        <Figure label="Converted to projects" value={String(funding.converted.length)} hint={money(convertedTotal)} tone={funding.converted.length ? "good" : undefined} />
      </div>

      <BudgetSubmissions
        cycleId={cycle.id}
        records={budgetRecords}
        canRecord={funding.canRecord}
        onRecord={() => setBudgetOpen(true)}
      />

      <section className={`${cardCls} space-y-3`} aria-labelledby="appropriation-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="appropriation-heading" className="text-sm font-bold text-slate-900">
              Appropriated schedule
            </h3>
            <p className="text-xs text-slate-500">
              Importing the schedule funds the proposed projects it lists: each becomes a draft project. Those left out close as not funded.
            </p>
          </div>
          {canImport && (
            <span className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} disabled={template.isPending} onClick={() => template.mutate()}>
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download template"}
              </button>
              <button type="button" className={primaryButton} onClick={() => setImportOpen(true)}>
                Import schedule
              </button>
            </span>
          )}
        </div>
        {appropriation ? (
          <AppropriationRecord cycleId={cycle.id} record={appropriation} />
        ) : funding.awaiting.length === 0 ? (
          <p className="text-xs text-slate-500">No proposed project is waiting for funding yet: the portfolio must be approved first (Approvals tab).</p>
        ) : !funding.canRecord ? (
          <p className="text-xs text-slate-500">Not imported yet. Finance records the appropriation once the budget is passed.</p>
        ) : null}
        {canImport && funding.cannotConfirmReason && <Notice tone="warning">{funding.cannotConfirmReason} Another person must confirm the import.</Notice>}
      </section>

      <AwaitingTable items={funding.awaiting} />
      <ConvertedTable converted={funding.converted} />

      {budgetOpen && <BudgetSubmissionDialog cycleId={cycle.id} suggestedAmountNgn={awaitingTotal > 0 ? awaitingTotal : null} onClose={() => setBudgetOpen(false)} />}
      {importOpen && <AppropriationImportDialog cycleId={cycle.id} cannotConfirmReason={funding.cannotConfirmReason} onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function BudgetSubmissions({
  cycleId,
  records,
  canRecord,
  onRecord,
}: {
  cycleId: string;
  records: NeedsFundingRecordDto[];
  canRecord: boolean;
  onRecord: () => void;
}) {
  const columns: TableColumnDef<NeedsFundingRecordDto>[] = [
    { id: "date", header: "Submitted on", cell: (r) => <span className="whitespace-nowrap text-slate-900">{formatDateShort(r.recordedOn)}</span> },
    { id: "amount", header: "Amount", align: "right", cell: (r) => <span className="whitespace-nowrap tabular-nums text-slate-900">{money(r.amountNgn)}</span> },
    {
      id: "ack",
      header: "Acknowledgement",
      cell: (r) => (r.documentId ? <OpenDocumentButton cycleId={cycleId} documentId={r.documentId} /> : <span className="text-slate-400">None</span>),
    },
    { id: "note", header: "Note", cell: (r) => <span className="text-slate-700">{r.note || "–"}</span> },
    {
      id: "by",
      header: "Recorded by",
      cell: (r) => (
        <span className="whitespace-nowrap text-slate-700">
          {r.recordedByName}
          <span className="block text-[11px] text-slate-500">{formatDateShort(r.createdAt)}</span>
        </span>
      ),
    },
  ];
  return (
    <StandardTable<NeedsFundingRecordDto>
      title="Budget submissions"
      subtitle="The approved portfolio as submitted for the budget"
      headerActions={
        canRecord ? (
          <button type="button" className={primaryButton} onClick={onRecord}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Record budget submission
          </button>
        ) : undefined
      }
      columns={columns}
      data={records}
      keyExtractor={(r) => r.id}
      minWidth="min-w-[720px]"
      emptyState={{
        title: "No budget submission recorded",
        description: canRecord ? "Record the date and amount submitted, with the acknowledgement if you have it." : "Finance records the budget submission here.",
      }}
    />
  );
}

/** Counts the import stored on the record, when they are numbers (assumed keys of the preview's totals). */
const SUMMARY_LABELS: Array<[string, string]> = [
  ["matched", "funded"],
  ["partlyFunded", "partly funded"],
  ["outOfCycle", "out-of-cycle"],
  ["notFunded", "not funded"],
];

function AppropriationRecord({ cycleId, record }: { cycleId: string; record: NeedsFundingRecordDto }) {
  const counts = SUMMARY_LABELS.map(([key, label]) => {
    const n = record.summary[key];
    return typeof n === "number" ? `${n} ${label}` : null;
  }).filter(Boolean);
  return (
    <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
      <div>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Appropriated on</dt>
        <dd className="text-slate-900">{formatDateShort(record.recordedOn)}</dd>
      </div>
      <div>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Funded total</dt>
        <dd className="tabular-nums text-slate-900">{money(record.amountNgn)}</dd>
      </div>
      <div>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Schedule</dt>
        <dd className="text-slate-900">
          <span className="block truncate" title={record.fileName ?? undefined}>
            {record.fileName ?? "–"}
          </span>
          {record.documentId && <OpenDocumentButton cycleId={cycleId} documentId={record.documentId} />}
        </dd>
      </div>
      <div>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recorded by</dt>
        <dd className="text-slate-900">
          {record.recordedByName} · {formatDateShort(record.createdAt)}
        </dd>
      </div>
      {counts.length > 0 && <p className="text-slate-600 sm:col-span-4">Rows: {counts.join(", ")}.</p>}
      {record.note && <p className="text-slate-600 sm:col-span-4">{record.note}</p>}
    </dl>
  );
}

function AwaitingTable({ items }: { items: NeedsSubmissionItemDto[] }) {
  const columns: TableColumnDef<NeedsSubmissionItemDto>[] = [
    { id: "ref", header: "Reference", cell: (i) => <ProposalLink proposalId={i.proposalId} reference={i.reference} /> },
    { id: "title", header: "Proposed project", cell: (i) => <span className="text-slate-900">{i.title}</span> },
    { id: "where", header: "State · LGAs", cell: (i) => <span className="text-slate-700">{locationText(i.stateCode, i.lgaCodes)}</span> },
    { id: "sites", header: "Sites", align: "right", cell: (i) => <span className="tabular-nums text-slate-700">{i.siteCount}</span> },
    { id: "rank", header: "Rank", align: "right", cell: (i) => <span className="tabular-nums text-slate-700">{i.rank ?? "–"}</span> },
    { id: "amount", header: "Approved amount", align: "right", cell: (i) => <span className="whitespace-nowrap tabular-nums text-slate-900">{money(i.amountNgn)}</span> },
  ];
  return (
    <StandardTable<NeedsSubmissionItemDto>
      title="Waiting for funding"
      subtitle={items.length ? `${plural(items.length, "proposed project")} approved in the portfolio` : undefined}
      columns={columns}
      data={items}
      keyExtractor={(i) => i.proposalId}
      minWidth="min-w-[760px]"
      emptyState={{ title: "Nothing waiting", description: "Proposed projects appear here once the portfolio is approved, until the appropriation funds them." }}
    />
  );
}

function ConvertedTable({ converted }: { converted: NeedsConvertedProposal[] }) {
  const columns: TableColumnDef<NeedsConvertedProposal>[] = [
    { id: "ref", header: "Reference", cell: (c) => <ProposalLink proposalId={c.proposalId} reference={c.reference} /> },
    { id: "project", header: "Draft project", cell: (c) => <ProjectCodeLink projectId={c.projectId} code={c.projectCode} /> },
    { id: "amount", header: "Funded amount", align: "right", cell: (c) => <span className="whitespace-nowrap tabular-nums text-slate-900">{money(c.fundedAmountNgn)}</span> },
  ];
  return (
    <StandardTable<NeedsConvertedProposal>
      title="Converted to projects"
      subtitle={converted.length ? "Draft projects; lots and batches are given on the Procurement plan tab" : undefined}
      columns={columns}
      data={converted}
      keyExtractor={(c) => c.projectId}
      minWidth="min-w-[560px]"
      emptyState={{ title: "No project yet", description: "Funded proposed projects become draft projects when the appropriated schedule is imported." }}
    />
  );
}
