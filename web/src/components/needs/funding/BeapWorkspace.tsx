import React, { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, Undo2 } from "lucide-react";
import {
  NEEDS_OPEN_PROPOSAL_STATUSES,
  PROCUREMENT_METHOD_LABELS,
  type NeedsCycleDto,
  type NeedsSubmissionDto,
  type NeedsSubmissionItemDto,
} from "@insite/shared";
import { StandardTable, TableBadge, type TableColumnDef } from "../../table";
import { primaryButton } from "../../contracts/contractUi";
import { useAuth } from "../../../lib/auth-context";
import { formatDateShort, formatDateTimeShort } from "../../../lib/formatters";
import { useBeapQuery } from "../../../queries/needs/useFundingQueries";
import { useNeedsProposalsQuery } from "../../../queries/needs/useNeedsQueries";
import { EmptyPanel, cardCls, locationText, money, plural } from "../needsUi";
import { BeapEditor, beapEditorRows } from "./BeapEditor";
import { BeapReviewPanel } from "./BeapReviewPanel";
import { CounterpartDialog } from "./CounterpartDialog";
import {
  ActionHistory,
  ApprovalSteps,
  DocumentRef,
  Figure,
  Notice,
  ProjectCodeLink,
  ProposalLink,
  ReviewOutcomeTag,
  SubmissionStatusTag,
  plannedText,
} from "./fundingUi";

/**
 * Needs pipeline wave 4 (C2): the BEAP workspace (the Funding tab of a Matching Grants cycle).
 * - The SUBEB (`needs:prepare_beap`, the cycle's owning organisation) builds the BEAP from the
 *   proposed projects at Funding while it is a draft or returned, and submits it.
 * - UBEC reviewers see the cycle but cannot edit the BEAP; whoever may act on the current step
 *   (`canAct`) reviews each item and approves or returns it.
 * - Everyone else, and everyone after approval, sees it read-only: status, steps, items (with the
 *   projects created, their lots and batches), narrative and counterpart, history.
 * Counterpart evidence can be recorded after approval; until then no project of the BEAP can be
 * activated (A5).
 */
export function BeapWorkspace({ cycle }: { cycle: NeedsCycleDto }) {
  const { user, hasPermission } = useAuth();
  const beapQuery = useBeapQuery(cycle.id);
  const proposalsQuery = useNeedsProposalsQuery(cycle.id, { stage: "FUNDING" });
  const [counterpartOpen, setCounterpartOpen] = useState(false);

  const beap = beapQuery.data ?? null;
  const canPrepare = Boolean(user && user.organizationId === cycle.owningOrganizationId && hasPermission("needs:prepare_beap"));
  const editable = canPrepare && (!beap || beap.status === "DRAFT" || beap.status === "RETURNED");
  const atFunding = useMemo(
    () => (proposalsQuery.data ?? []).filter((p) => p.stage === "FUNDING" && NEEDS_OPEN_PROPOSAL_STATUSES.includes(p.status)),
    [proposalsQuery.data]
  );
  const editorRows = useMemo(() => beapEditorRows(beap, editable ? atFunding : []), [beap, atFunding, editable]);

  if (beapQuery.isLoading || (editable && proposalsQuery.isLoading)) {
    return (
      <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
        <span className="sr-only">Loading the BEAP…</span>
      </div>
    );
  }
  if (beapQuery.isError) {
    return (
      <p role="alert" className="text-xs font-medium text-rose-700">
        The BEAP could not be loaded.
      </p>
    );
  }

  if (!beap && !editable) {
    return (
      <EmptyPanel title="No BEAP yet">
        The State's SUBEB prepares its Basic Education Action Plan from the proposed projects of the approved State portfolio
        {atFunding.length ? ` (${plural(atFunding.length, "proposed project")} at Funding)` : ""}. It appears here once the SUBEB saves it.
      </EmptyPanel>
    );
  }

  return (
    <div className="space-y-4">
      {beap ? (
        <BeapHeader beap={beap} />
      ) : (
        <Notice tone="info">
          Build the State's Basic Education Action Plan from the {plural(atFunding.length, "proposed project")} at Funding, then submit it to UBEC for review and approval.
        </Notice>
      )}
      {beap?.status === "RETURNED" && <ReturnedNotice beap={beap} canRevise={editable} />}

      {editable ? (
        <BeapEditor key={`${beap?.id ?? "new"}:${beap?.status ?? "none"}`} cycle={cycle} beap={beap} rows={editorRows} />
      ) : beap ? (
        <>
          {beap.canAct && beap.status === "IN_REVIEW" ? (
            <BeapReviewPanel key={`${beap.id}:${beap.currentStepOrder ?? "done"}`} cycle={cycle} beap={beap} />
          ) : (
            <BeapItemsTable beap={beap} />
          )}
          <CounterpartCard cycle={cycle} beap={beap} canRecord={canPrepare} onRecord={() => setCounterpartOpen(true)} />
        </>
      ) : null}

      {beap && (
        <section className={cardCls}>
          <ActionHistory submission={beap} />
        </section>
      )}

      {counterpartOpen && beap && <CounterpartDialog cycleId={cycle.id} beap={beap} interventionYear={cycle.interventionYear} onClose={() => setCounterpartOpen(false)} />}
    </div>
  );
}

function BeapHeader({ beap }: { beap: NeedsSubmissionDto }) {
  const converted = beap.items.filter((i) => i.projectId).length;
  return (
    <section className={`${cardCls} space-y-3`} aria-labelledby="beap-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="beap-heading" className="text-sm font-bold text-slate-900">
            Basic Education Action Plan (BEAP)
          </h3>
          <p className="text-xs text-slate-500">
            {beap.submittedAt
              ? `Submitted ${formatDateTimeShort(beap.submittedAt)}${beap.submittedByName ? ` by ${beap.submittedByName}` : ""}`
              : "Not submitted yet"}
            {beap.decidedAt ? ` · approved ${formatDateShort(beap.decidedAt)}` : ""}
          </p>
        </div>
        <SubmissionStatusTag status={beap.status} label={beap.statusLabel} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Projects included" value={String(beap.includedCount)} />
        <Figure label="Total" value={money(beap.totalNgn)} />
        <Figure label="Counterpart declared" value={money(beap.counterpartDeclaredNgn)} />
        <Figure label="Projects created" value={String(converted)} tone={converted ? "good" : undefined} />
      </div>
      <ApprovalSteps submission={beap} />
      {beap.status === "IN_REVIEW" && !beap.canAct && beap.cannotActReason && <p className="text-[11px] text-slate-500">{beap.cannotActReason}</p>}
    </section>
  );
}

function ReturnedNotice({ beap, canRevise }: { beap: NeedsSubmissionDto; canRevise: boolean }) {
  const lastReturn = [...beap.actions].filter((a) => a.decision === "RETURN").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
      <p className="flex items-center gap-1.5 font-bold">
        <Undo2 className="h-4 w-4" aria-hidden="true" /> Returned for revision
        {lastReturn ? ` by ${lastReturn.actorName} (${lastReturn.stepLabel}), ${formatDateShort(lastReturn.createdAt)}` : ""}
      </p>
      {lastReturn?.notes && <p className="mt-1 whitespace-pre-line">{lastReturn.notes}</p>}
      {canRevise && (
        <p className="mt-1">
          UBEC's comments are on each project below. Upload a revised needs assessment where asked, change the BEAP and resubmit it.
        </p>
      )}
    </div>
  );
}

function BeapItemsTable({ beap }: { beap: NeedsSubmissionDto }) {
  const approved = beap.status === "APPROVED";
  const rows = [...beap.items].sort((a, b) => Number(b.included) - Number(a.included) || (a.lotNumber ?? 0) - (b.lotNumber ?? 0) || (a.batchNumber ?? 0) - (b.batchNumber ?? 0));
  const columns: TableColumnDef<NeedsSubmissionItemDto>[] = [
    {
      id: "proposal",
      header: "Proposed project",
      cell: (i) => (
        <span>
          <ProposalLink proposalId={i.proposalId} reference={i.reference} />
          <span className="block text-[11px] text-slate-700">{i.title}</span>
          <span className="block text-[11px] text-slate-500">{locationText(i.stateCode, i.lgaCodes)}</span>
        </span>
      ),
    },
    { id: "amount", header: "Amount", align: "right", cell: (i) => <span className="whitespace-nowrap tabular-nums text-slate-900">{money(i.amountNgn)}</span> },
    {
      id: "included",
      header: "In the BEAP",
      cell: (i) =>
        i.included ? (
          <TableBadge variant="success">Included</TableBadge>
        ) : (
          <span>
            <TableBadge variant="neutral">Left out</TableBadge>
            {i.exclusionReason && <span className="mt-0.5 block text-[11px] text-slate-600">{i.exclusionReason}</span>}
          </span>
        ),
    },
    {
      id: "lot",
      header: "Lot",
      cell: (i) =>
        i.included ? (
          <span className="text-slate-800">
            {i.lotNumber !== null ? <span className="font-semibold">Lot {i.lotNumber}{i.batchNumber !== null ? ` · Batch ${i.batchNumber}` : ""}</span> : null}
            <span className="block text-[11px] text-slate-600">{i.lotTitle ?? "–"}</span>
          </span>
        ) : (
          <span className="text-slate-400">–</span>
        ),
    },
    {
      id: "method",
      header: "Method and dates",
      cell: (i) =>
        i.included ? (
          <span className="text-slate-700">
            {i.procurementMethod ? PROCUREMENT_METHOD_LABELS[i.procurementMethod] : "–"}
            <span className="block whitespace-nowrap text-[11px] text-slate-500">{plannedText(i.plannedStartDate, i.plannedEndDate)}</span>
          </span>
        ) : (
          <span className="text-slate-400">–</span>
        ),
    },
    {
      id: "review",
      header: "UBEC review",
      cell: (i) =>
        i.reviewOutcome ? (
          <span>
            <ReviewOutcomeTag outcome={i.reviewOutcome} />
            {i.reviewComment && <span className="mt-0.5 block max-w-[16rem] whitespace-pre-line text-[11px] text-slate-600">{i.reviewComment}</span>}
          </span>
        ) : (
          <span className="text-slate-400">–</span>
        ),
    },
    ...(approved
      ? [
          {
            id: "project",
            header: "Draft project",
            cell: (i: NeedsSubmissionItemDto) => (i.projectId ? <ProjectCodeLink projectId={i.projectId} code={i.projectCode} /> : <span className="text-slate-400">–</span>),
          } satisfies TableColumnDef<NeedsSubmissionItemDto>,
        ]
      : []),
  ];
  return (
    <StandardTable<NeedsSubmissionItemDto>
      title={approved ? "Projects in the approved BEAP" : "Projects in the BEAP"}
      subtitle={`${plural(beap.includedCount, "project")} included · ${money(beap.totalNgn)}`}
      columns={columns}
      data={rows}
      keyExtractor={(i) => i.proposalId}
      minWidth="min-w-[980px]"
      emptyState={{ title: "No project in the BEAP" }}
    />
  );
}

function CounterpartCard({ cycle, beap, canRecord, onRecord }: { cycle: NeedsCycleDto; beap: NeedsSubmissionDto; canRecord: boolean; onRecord: () => void }) {
  const hasEvidence = Boolean(beap.counterpartEvidenceDocumentId);
  return (
    <section className={`${cardCls} space-y-3`} aria-labelledby="beap-counterpart-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="beap-counterpart-heading" className="text-sm font-bold text-slate-900">
          Narrative and counterpart funding
        </h3>
        {canRecord && beap.status !== "DRAFT" && beap.status !== "RETURNED" && (
          <button type="button" className={primaryButton} onClick={onRecord}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {hasEvidence ? "Update counterpart" : "Record counterpart evidence"}
          </button>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">BEAP narrative</dt>
          <dd>
            <DocumentRef cycleId={cycle.id} documentId={beap.narrativeDocumentId} documents={cycle.documents} />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Counterpart declared</dt>
          <dd className="tabular-nums text-slate-900">{money(beap.counterpartDeclaredNgn)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Counterpart evidence</dt>
          <dd>
            <DocumentRef cycleId={cycle.id} documentId={beap.counterpartEvidenceDocumentId} documents={cycle.documents} />
            {beap.counterpartRecordedAt && (
              <span className="block text-[11px] text-slate-500">
                Recorded {formatDateShort(beap.counterpartRecordedAt)}
                {beap.counterpartRecordedByName ? ` by ${beap.counterpartRecordedByName}` : ""}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {!hasEvidence && (
        <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {beap.status === "APPROVED"
            ? "No counterpart evidence yet: the projects of this BEAP cannot be activated until the SUBEB records it."
            : "No counterpart evidence yet. UBEC may approve the BEAP without it, but its projects cannot be activated until it is recorded."}
        </p>
      )}
    </section>
  );
}
