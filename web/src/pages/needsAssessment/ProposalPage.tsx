import React, { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, FilePlus2, FileUp } from "lucide-react";
import {
  NEEDS_OPEN_PROPOSAL_STATUSES,
  NEEDS_VERSION_SOURCE_LABELS,
  OUT_OF_CYCLE_REASON_LABELS,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  SCHOOL_LEVEL_LABELS,
  type NeedsCycleDto,
  type NeedsProposalDetailDto,
  type NeedsProposalDocumentDto,
} from "@insite/shared";
import { Tabs, TabPanel, useUrlTab, type TabItem } from "../../components/common/Tabs";
import { StandardTable, TableBadge, type TableColumnDef } from "../../components/table";
import { primaryButton, secondaryButton } from "../../components/contracts/contractUi";
import { SitePinMap } from "../../components/sites/SitePinMap";
import { ProposalStageBar } from "../../components/needs/ProposalStageBar";
import { ProposalTaskList } from "../../components/needs/ProposalTaskList";
import { BreakdownPanel } from "../../components/needs/BreakdownPanel";
import { NeedsUploadDialog } from "../../components/needs/NeedsUploadDialog";
import { NeedsDocumentDialog } from "../../components/needs/NeedsDocumentDialog";
import { EmptyPanel, FlagChips, ProposalStatusTag, cardCls, formatBytes, locationText, money } from "../../components/needs/needsUi";
import { lgaNames, stateName } from "../../components/approvedLists/approvedListUi";
import { getProposalDocumentLink, getVersionFileLink } from "../../api/needsPipeline";
import { useNeedsCycleQuery, useNeedsProposalQuery } from "../../queries/needs/useNeedsQueries";
import { useFacilitiesQuery } from "../../queries/facilities/useFacilityQueries";
import { useDownloadProposalTemplateMutation, useOpenNeedsFileMutation } from "../../mutations/needs/useNeedsMutations";
import { useAuth } from "../../lib/auth-context";
import { formatDateTimeShort } from "../../lib/formatters";
import { stageLabel } from "./ProposedProjectsTab";

type TabId = "summary" | "sites" | "facilities" | "boq" | "versions" | "validation" | "scores" | "documents" | "history";
const TAB_IDS: readonly TabId[] = ["summary", "sites", "facilities", "boq", "versions", "validation", "scores", "documents", "history"];
const TAB_LABELS: Record<TabId, string> = {
  summary: "Summary",
  sites: "Sites",
  facilities: "Intervention & facilities",
  boq: "BoQ & costing",
  versions: "Versions",
  validation: "Validation",
  scores: "Scores",
  documents: "Documents",
  history: "History",
};
const TAB_PREFIX = "proposal";
/** Radius drawn round each site pin (display only). */
const SITE_PIN_RADIUS_M = 150;

/**
 * Needs pipeline wave 2 (C5): a proposed project (`/app/needs-assessment/proposals/:proposalId`).
 * Header with status and flags, the cycle's stages, the task list, and tabs: Summary, Sites (map),
 * Intervention & facilities, Versions, Documents, History; BoQ & costing, Validation and Scores are
 * filled by the later stages. "Upload new version" when the server offers UPLOAD_VERSION.
 */
export function ProposalPage() {
  const { proposalId } = useParams();
  const query = useNeedsProposalQuery(proposalId);
  const proposal = query.data;
  const cycleQuery = useNeedsCycleQuery(proposal?.cycleId);

  if (query.isLoading) {
    return (
      <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
        <span className="sr-only">Loading the proposed project…</span>
      </div>
    );
  }
  if (!proposal) {
    return (
      <div className="space-y-3">
        <BackLink cycleId={null} />
        <EmptyPanel title="This proposed project could not be found">It may be in a cycle you cannot see, or the link is wrong.</EmptyPanel>
      </div>
    );
  }
  return <ProposalView proposal={proposal} cycle={cycleQuery.data ?? null} />;
}

function BackLink({ cycleId }: { cycleId: string | null }) {
  return (
    <Link
      to={cycleId ? `/app/needs-assessment?cycle=${cycleId}&tab=proposals` : "/app/needs-assessment"}
      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Proposed projects
    </Link>
  );
}

function ProposalView({ proposal, cycle }: { proposal: NeedsProposalDetailDto; cycle: NeedsCycleDto | null }) {
  const { hasAnyPermission, user } = useAuth();
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const [uploadOpen, setUploadOpen] = useState(false);
  const template = useDownloadProposalTemplateMutation();
  const facilitiesQuery = useFacilitiesQuery(true);
  const facilityNames = useMemo(() => new Map((facilitiesQuery.data ?? []).map((f) => [f.code.toUpperCase(), f.name])), [facilitiesQuery.data]);
  const facilityName = (code: string) => facilityNames.get(code.toUpperCase()) ?? code;

  const cycleOpen = cycle?.status === "OPEN";
  // Writes on the cycle need its own organisation (wave 2 decision 1; the server checks too).
  const ownsCycle = Boolean(cycle && user && user.organizationId === cycle.owningOrganizationId);
  const canUploadVersion = cycleOpen && ownsCycle && proposal.allowedActions.includes("UPLOAD_VERSION");
  const canAddDocuments =
    cycleOpen && ownsCycle && NEEDS_OPEN_PROPOSAL_STATUSES.includes(proposal.status) && hasAnyPermission("needs:submit", "needs:validate", "needs:cost");
  const openFlags = proposal.flags.filter((f) => !f.resolved).map((f) => f.kind);

  const tabs: TabItem<TabId>[] = TAB_IDS.map((id) => ({
    id,
    label: TAB_LABELS[id],
    count: id === "sites" ? proposal.sites.length : id === "versions" ? proposal.versions.length : id === "documents" ? proposal.documents.length : null,
  }));

  return (
    <div className="space-y-4">
      <BackLink cycleId={proposal.cycleId} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500">
            {proposal.reference}
            {cycle ? ` · ${cycle.projectTypeName} ${cycle.interventionYear}` : ""}
          </p>
          <h2 className="text-lg font-bold text-slate-900">{proposal.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ProposalStatusTag status={proposal.status} label={proposal.statusLabel} />
            <FlagChips kinds={openFlags} empty="" />
          </div>
          {proposal.nextActor && <p className="mt-1 text-xs text-slate-600">Next: {proposal.nextActor}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} disabled={template.isPending} onClick={() => template.mutate(proposal.id)}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download pre-filled template"}
          </button>
          {canUploadVersion && (
            <button type="button" className={primaryButton} onClick={() => setUploadOpen(true)}>
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload new version
            </button>
          )}
        </div>
      </header>

      <ProposalStageBar stages={cycle?.config.stages ?? []} current={proposal.stage} status={proposal.status} />
      <ProposalTaskList tasks={proposal.tasks} />

      <Tabs tabs={tabs} active={tab ?? "summary"} onChange={setTab} label="Proposed project" idPrefix={TAB_PREFIX} />
      <TabPanel idPrefix={TAB_PREFIX} id={tab ?? "summary"}>
        {(tab ?? "summary") === "summary" && <SummaryTab proposal={proposal} cycle={cycle} />}
        {tab === "sites" && <SitesTab proposal={proposal} />}
        {tab === "facilities" && (
          <BreakdownPanel
            rows={proposal.breakdownRows}
            sites={proposal.sites}
            essentialGroups={cycle?.config.essentialFacilityGroups ?? []}
            facilityName={facilityName}
            flags={proposal.flags}
          />
        )}
        {tab === "boq" && (
          <EmptyPanel title="Costing comes at the Costing stage">
            {proposal.boqLines.length > 0
              ? `The current version has ${proposal.boqLines.length} BoQ line${proposal.boqLines.length === 1 ? "" : "s"}. `
              : "The current version has no BoQ lines. "}
            The quantity surveyor's costed version, the rates compared with the costing standard and the supervision and monitoring line will be shown here.
          </EmptyPanel>
        )}
        {tab === "versions" && <VersionsTab proposal={proposal} />}
        {tab === "validation" && (
          <EmptyPanel title="Not validated yet">
            The desk review, the site verification and how any possible duplicate was resolved will be recorded here at the{" "}
            {cycle ? stageLabel(cycle, "VALIDATION") : "Validation"} stage.
          </EmptyPanel>
        )}
        {tab === "scores" && (
          <EmptyPanel title="Not scored yet">The committee's score sheets, the total score and the rank will be shown here at Prioritisation.</EmptyPanel>
        )}
        {tab === "documents" && <DocumentsTab proposal={proposal} canAdd={canAddDocuments} />}
        {tab === "history" && <HistoryTab proposal={proposal} />}
      </TabPanel>

      {uploadOpen && (
        <NeedsUploadDialog
          cycleId={proposal.cycleId}
          fixedProposal={{ id: proposal.id, reference: proposal.reference, title: proposal.title }}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryTab({ proposal, cycle }: { proposal: NeedsProposalDetailDto; cycle: NeedsCycleDto | null }) {
  const p = proposal.project;
  const current = proposal.versions.find((v) => v.isCurrent);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <section className={`${cardCls} lg:col-span-2`} aria-labelledby="proposal-project">
        <h3 id="proposal-project" className="text-sm font-bold text-slate-900">
          Project
        </h3>
        <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Location" value={locationText(proposal.stateCode, proposal.lgaCodes)} />
          <Field label="Intervention year" value={p?.interventionYear ? String(p.interventionYear) : cycle ? String(cycle.interventionYear) : "–"} />
          <Field label="Estimated duration" value={p?.estimatedDurationMonths ? `${p.estimatedDurationMonths} months` : "–"} />
          <Field label="Beneficiaries" value={p?.beneficiaries ?? "–"} />
          <Field label="Justification" value={p?.justification ?? "–"} wide />
          <Field label="Assumptions" value={p?.assumptions ?? "–"} wide />
        </dl>
      </section>

      <section className={cardCls} aria-labelledby="proposal-amounts">
        <h3 id="proposal-amounts" className="text-sm font-bold text-slate-900">
          Amounts
        </h3>
        <dl className="mt-2 space-y-2">
          <Field label="Preliminary cost" value={money(proposal.preliminaryCostNgn)} />
          <Field label="Costed amount" value={money(proposal.costedAmountNgn)} />
          <Field label="Approved amount" value={money(proposal.approvedAmountNgn)} />
          <Field label="Funded amount" value={money(proposal.fundedAmountNgn)} />
        </dl>
      </section>

      <section className={cardCls} aria-labelledby="proposal-route">
        <h3 id="proposal-route" className="text-sm font-bold text-slate-900">
          Route
        </h3>
        <dl className="mt-2 space-y-2">
          <Field
            label="Route"
            value={
              proposal.route === "OUT_OF_CYCLE"
                ? `Outside the annual cycle${proposal.outOfCycleReason ? `: ${OUT_OF_CYCLE_REASON_LABELS[proposal.outOfCycleReason]}` : ""}`
                : "Annual cycle"
            }
          />
          <Field
            label="Carried from"
            value={
              proposal.carriedFromId ? (
                <Link className="font-semibold text-brand-primary hover:underline" to={`/app/needs-assessment/proposals/${proposal.carriedFromId}`}>
                  {proposal.carriedFromReference ?? "Earlier proposed project"}
                </Link>
              ) : (
                "–"
              )
            }
          />
          {proposal.mergedIntoId && (
            <Field
              label="Merged into"
              value={
                <Link className="font-semibold text-brand-primary hover:underline" to={`/app/needs-assessment/proposals/${proposal.mergedIntoId}`}>
                  {proposal.mergedIntoReference ?? "Another proposed project"}
                </Link>
              }
            />
          )}
          {proposal.projectId && (
            <Field
              label="Project"
              value={
                <Link className="font-semibold text-brand-primary hover:underline" to={`/app/projects/${proposal.projectId}/dashboard`}>
                  Open the project
                </Link>
              }
            />
          )}
          <Field label="Created" value={`${formatDateTimeShort(proposal.createdAt)} by ${proposal.createdByName}`} />
          <Field label="Current version" value={current ? `Version ${current.number} (${NEEDS_VERSION_SOURCE_LABELS[current.source]})` : "–"} />
        </dl>
      </section>

      <section className={`${cardCls} lg:col-span-2`} aria-labelledby="proposal-flags">
        <h3 id="proposal-flags" className="text-sm font-bold text-slate-900">
          Flags
        </h3>
        {proposal.flags.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No flags.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {proposal.flags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-xs">
                <span className={f.resolved ? "text-slate-500" : "font-semibold text-slate-900"}>
                  {f.label}
                  {f.raisedOnVersion !== null && <span className="font-normal text-slate-500"> · version {f.raisedOnVersion}</span>}
                </span>
                <span className="text-[11px] text-slate-600">
                  {f.resolved
                    ? `Resolved${f.resolvedByName ? ` by ${f.resolvedByName}` : ""}${f.resolutionReason ? `: ${f.resolutionReason}` : ""}`
                    : `Open since ${formatDateTimeShort(f.raisedAt)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="whitespace-pre-line text-xs text-slate-900">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

function SitesTab({ proposal }: { proposal: NeedsProposalDetailDto }) {
  const pins = proposal.sites
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .map((s) => ({ key: String(s.siteNumber), latitude: s.latitude!, longitude: s.longitude!, label: `Site ${s.siteNumber} · ${s.schoolName}` }));
  if (proposal.sites.length === 0) return <EmptyPanel title="No sites">The current version lists no school sites.</EmptyPanel>;
  return (
    <div className="space-y-3">
      {pins.length > 0 ? (
        <SitePinMap pins={pins} radiusMeters={SITE_PIN_RADIUS_M} className="h-72" />
      ) : (
        <p className="text-xs text-slate-500">No site has GPS coordinates yet, so there is nothing to show on the map.</p>
      )}
      {pins.length > 0 && pins.length < proposal.sites.length && (
        <p className="text-xs text-amber-800">
          {proposal.sites.length - pins.length} of {proposal.sites.length} sites have no GPS coordinates and are not on the map.
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white" tabIndex={0} role="region" aria-label="Sites">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-slate-50">
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-3 py-2">Site</th>
              <th scope="col" className="px-3 py-2">School</th>
              <th scope="col" className="px-3 py-2">Level</th>
              <th scope="col" className="px-3 py-2">LGA</th>
              <th scope="col" className="px-3 py-2">Address</th>
              <th scope="col" className="px-3 py-2">GPS</th>
              <th scope="col" className="px-3 py-2 text-right">Enrolment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {proposal.sites.map((s) => (
              <tr key={s.siteNumber}>
                <td className="px-3 py-2 tabular-nums text-slate-700">{s.siteNumber}</td>
                <td className="px-3 py-2 font-medium text-slate-900">{s.schoolName}</td>
                <td className="px-3 py-2 text-slate-700">{SCHOOL_LEVEL_LABELS[s.schoolLevel]}</td>
                <td className="px-3 py-2 text-slate-700">{lgaNames([s.lgaCode])}</td>
                <td className="px-3 py-2 text-slate-700">{s.address ?? "–"}</td>
                <td className="px-3 py-2 tabular-nums text-slate-700">
                  {s.latitude !== null && s.longitude !== null ? `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}` : "Not located"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{s.enrolment ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {proposal.stateCode && <p className="text-[11px] text-slate-500">State: {stateName(proposal.stateCode)}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

function VersionsTab({ proposal }: { proposal: NeedsProposalDetailDto }) {
  const openFile = useOpenNeedsFileMutation();
  const versions = [...proposal.versions].sort((a, b) => b.number - a.number);
  if (versions.length === 0) return <EmptyPanel title="No versions">No needs assessment file has been saved for this proposed project.</EmptyPanel>;
  return (
    <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
      {versions.map((v) => (
        <li key={v.id} className={`${cardCls} relative`}>
          <span
            className={`absolute -left-[1.4rem] top-5 h-3 w-3 rounded-full border-2 border-white ${v.isCurrent ? "bg-brand-primary" : "bg-slate-300"}`}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">
                Version {v.number}
                <span className="ml-2 align-middle">
                  <TableBadge variant={v.isCurrent ? "info" : "neutral"}>{v.isCurrent ? "Current" : NEEDS_VERSION_SOURCE_LABELS[v.source]}</TableBadge>
                </span>
              </p>
              <p className="text-[11px] text-slate-600">
                {NEEDS_VERSION_SOURCE_LABELS[v.source]} {formatDateTimeShort(v.uploadedAt)} by {v.uploadedByName}
              </p>
            </div>
            <button
              type="button"
              className={secondaryButton}
              disabled={openFile.isPending}
              onClick={() => openFile.mutate(() => getVersionFileLink(proposal.id, v.number))}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download file
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
            <Field label="File" value={`${v.fileName} · ${formatBytes(v.byteSize)}`} wide />
            <Field label="Template" value={v.templateVersion} />
            <Field label="Costing standard" value={v.costingStandardVersion ? `Version ${v.costingStandardVersion}` : "–"} />
            <Field label="Sites" value={String(v.siteCount)} />
            <Field label="Breakdown rows" value={String(v.breakdownRowCount)} />
            <Field label="BoQ lines" value={String(v.boqLineCount)} />
            <Field label={v.costedTotalNgn !== null ? "Costed total" : "Preliminary cost"} value={money(v.costedTotalNgn ?? v.preliminaryCostNgn)} />
          </dl>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function DocumentsTab({ proposal, canAdd }: { proposal: NeedsProposalDetailDto; canAdd: boolean }) {
  const openFile = useOpenNeedsFileMutation();
  const [dialog, setDialog] = useState<{ supersedes: NeedsProposalDocumentDto | null } | null>(null);
  const supersededIds = useMemo(() => new Set(proposal.documents.map((d) => d.supersedesId).filter((id): id is string => Boolean(id))), [proposal.documents]);
  const rows = useMemo(
    () => [...proposal.documents].sort((a, b) => Number(supersededIds.has(a.id)) - Number(supersededIds.has(b.id)) || b.uploadedAt.localeCompare(a.uploadedAt)),
    [proposal.documents, supersededIds]
  );
  const muted = (d: NeedsProposalDocumentDto) => (supersededIds.has(d.id) ? "text-slate-400" : "text-slate-800");

  const columns: TableColumnDef<NeedsProposalDocumentDto>[] = [
    { id: "kind", header: "Kind", cell: (d) => <span className={`whitespace-nowrap ${muted(d)}`}>{PROPOSAL_DOCUMENT_KIND_LABELS[d.kind]}</span> },
    {
      id: "title",
      header: "Title",
      cell: (d) => (
        <span className={muted(d)}>
          <span className="font-semibold">{d.title}</span>
          {supersededIds.has(d.id) && (
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
        <span className={`block max-w-[14rem] truncate ${muted(d)}`} title={d.fileName}>
          {d.fileName} <span className="text-slate-400">· {formatBytes(d.byteSize)}</span>
        </span>
      ),
    },
    {
      id: "uploaded",
      header: "Uploaded",
      cell: (d) => (
        <span className={`whitespace-nowrap ${muted(d)}`}>
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
            onClick={() => openFile.mutate(() => getProposalDocumentLink(proposal.id, d.id))}
            aria-label={`Open ${d.title}`}
          >
            Open
          </button>
          {canAdd && !supersededIds.has(d.id) && (
            <button type="button" className="text-xs font-semibold text-slate-700 hover:underline" onClick={() => setDialog({ supersedes: d })} aria-label={`Upload a new version of ${d.title}`}>
              New version
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <StandardTable<NeedsProposalDocumentDto>
        title="Documents"
        subtitle="Drawings, specifications, photos and site reports of this proposed project"
        headerActions={
          canAdd ? (
            <button type="button" className={primaryButton} onClick={() => setDialog({ supersedes: null })}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Add document
            </button>
          ) : undefined
        }
        columns={columns}
        data={rows}
        keyExtractor={(d) => d.id}
        minWidth="min-w-[760px]"
        emptyState={{ title: "No documents yet", description: canAdd ? "Add the drawings, photos and site reports here." : undefined }}
      />
      {dialog && (
        <NeedsDocumentDialog
          target="proposal"
          cycleId={proposal.cycleId}
          proposalId={proposal.id}
          supersedes={dialog.supersedes ? { id: dialog.supersedes.id, kind: dialog.supersedes.kind, title: dialog.supersedes.title } : null}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryTab({ proposal }: { proposal: NeedsProposalDetailDto }) {
  const entries = [...proposal.history].sort((a, b) => b.at.localeCompare(a.at));
  if (entries.length === 0) return <EmptyPanel title="No history yet" />;
  return (
    <ol className={`${cardCls} divide-y divide-slate-100`}>
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-xs">
          <span className="text-slate-900">{e.summary}</span>
          <span className="whitespace-nowrap text-[11px] text-slate-500">
            {formatDateTimeShort(e.at)} · {e.actorName}
          </span>
        </li>
      ))}
    </ol>
  );
}
