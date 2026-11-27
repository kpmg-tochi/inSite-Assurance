import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { NeedsCycleDto, NeedsCycleSummaryDto } from "@insite/shared";
import { CustomSelect } from "../../components/common/CustomSelect";
import { Tabs, TabPanel, type TabItem } from "../../components/common/Tabs";
import { primaryButton } from "../../components/contracts/contractUi";
import { DeadlineStrip } from "../../components/needs/DeadlineStrip";
import { OpenCycleDialog } from "../../components/needs/OpenCycleDialog";
import { NeedsUploadDialog } from "../../components/needs/NeedsUploadDialog";
import { EmptyPanel, money } from "../../components/needs/needsUi";
import { stateName } from "../../components/approvedLists/approvedListUi";
import { useNeedsCycleQuery, useNeedsCyclesQuery, useNeedsOptionsQuery } from "../../queries/needs/useNeedsQueries";
import { useAuth } from "../../lib/auth-context";
import { ApprovedListsTab } from "./ApprovedListsTab";
import { ProposedProjectsTab } from "./ProposedProjectsTab";
import { CycleDocumentsTab } from "./CycleDocumentsTab";

type TabId = "proposals" | "prioritisation" | "approvals" | "procurement" | "documents" | "approved-lists";

const TAB_LABELS: Record<TabId, string> = {
  proposals: "Proposed projects",
  prioritisation: "Prioritisation",
  approvals: "Approvals",
  procurement: "Procurement plan",
  documents: "Cycle documents",
  "approved-lists": "Approved lists",
};

const CYCLE_TABS: readonly TabId[] = ["proposals", "prioritisation", "approvals", "procurement", "documents"];
const TAB_PREFIX = "needs-assessment";
/** Parameters of the Approved lists tab: an old link that carries them opens that tab. */
const APPROVED_LIST_PARAMS = ["year", "list", "kind", "state", "match", "q"];

/**
 * Needs pipeline wave 2 (C2): the Needs assessment page (`/app/needs-assessment`). Holders of
 * `needs:view` pick a cycle (year, programme, State; `?cycle=`), see its deadlines and work in tabs:
 * Proposed projects, Prioritisation, Approvals, Procurement plan, Cycle documents, and Approved lists
 * (the E3 table, moved here unchanged, for `approved_lists:view`). Users with only
 * `approved_lists:view` see just the approved lists.
 */
export function NeedsAssessmentPage() {
  const { hasPermission } = useAuth();
  if (!hasPermission("needs:view")) {
    return (
      <div className="space-y-4">
        <PageHeading />
        <ApprovedListsTab />
      </div>
    );
  }
  return <PipelinePage canLists={hasPermission("approved_lists:view")} />;
}

function PageHeading({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-slate-900">Needs assessment</h2>
        {children ?? <p className="text-xs text-slate-500">Each year's proposed and approved school projects.</p>}
      </div>
      {actions}
    </div>
  );
}

const byCycleOrder = (a: NeedsCycleSummaryDto, b: NeedsCycleSummaryDto) =>
  b.interventionYear - a.interventionYear ||
  a.projectTypeName.localeCompare(b.projectTypeName) ||
  stateName(a.stateCode).localeCompare(stateName(b.stateCode));

function PipelinePage({ canLists }: { canLists: boolean }) {
  const { hasPermission, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const optionsQuery = useNeedsOptionsQuery();
  const cyclesQuery = useNeedsCyclesQuery();
  const [openDialog, setOpenDialog] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const cycles = useMemo(() => [...(cyclesQuery.data ?? [])].sort(byCycleOrder), [cyclesQuery.data]);
  const requested = params.get("cycle");
  const selected =
    cycles.find((c) => c.id === requested) ??
    cycles.find((c) => c.status === "OPEN") ??
    cycles[0] ??
    null;
  const cycleQuery = useNeedsCycleQuery(selected?.id);
  const cycle = cycleQuery.data && cycleQuery.data.id === selected?.id ? cycleQuery.data : null;

  const canOpen = hasPermission("needs:manage_cycle") && (optionsQuery.data?.programmes.some((p) => p.canOpen) ?? false);
  // Writes need the permission and the cycle's own organisation (wave 2 decision 1; the server checks too).
  const ownsCycle = Boolean(cycle && user && user.organizationId === cycle.owningOrganizationId);
  const canUpload = ownsCycle && hasPermission("needs:submit") && cycle?.status === "OPEN";
  const canManageCycle = ownsCycle && hasPermission("needs:manage_cycle");

  // Tabs: the cycle tabs once a cycle exists, and the approved lists for their readers.
  const visible: TabId[] = [...(selected ? CYCLE_TABS : []), ...(canLists ? (["approved-lists"] as TabId[]) : [])];
  const tabParam = params.get("tab") as TabId | null;
  const legacyListLink = !tabParam && APPROVED_LIST_PARAMS.some((k) => params.has(k));
  const active: TabId | null =
    tabParam && visible.includes(tabParam) ? tabParam : legacyListLink && visible.includes("approved-lists") ? "approved-lists" : (visible[0] ?? null);

  const setTab = (id: TabId) => {
    const next = new URLSearchParams();
    const c = params.get("cycle");
    if (c) next.set("cycle", c);
    next.set("tab", id);
    setParams(next, { replace: true });
  };

  const selectCycle = (id: string) => {
    const next = new URLSearchParams();
    next.set("cycle", id);
    if (active && active !== "approved-lists") next.set("tab", active);
    setParams(next, { replace: true });
  };

  const tabs: TabItem<TabId>[] = visible.map((id) => ({
    id,
    label: TAB_LABELS[id],
    count: id === "proposals" && cycle ? cycle.proposalCount : id === "documents" && cycle ? cycle.documents.length : null,
  }));

  return (
    <div className="space-y-4">
      <PageHeading
        actions={
          canOpen ? (
            <button type="button" className={primaryButton} onClick={() => setOpenDialog(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Open a cycle
            </button>
          ) : undefined
        }
      >
        <p className="text-xs text-slate-500">
          The annual cycle: proposed projects are uploaded, validated, costed, prioritised and approved before they become projects.
        </p>
      </PageHeading>

      {cyclesQuery.isLoading && (
        <div role="status" className="h-24 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
          <span className="sr-only">Loading the cycles…</span>
        </div>
      )}
      {cyclesQuery.isError && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          The needs assessment cycles could not be loaded.
        </p>
      )}

      {cyclesQuery.data && cycles.length === 0 && (
        <EmptyPanel
          title="No needs assessment cycle yet"
          action={
            canOpen ? (
              <button type="button" className={primaryButton} onClick={() => setOpenDialog(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Open a cycle
              </button>
            ) : undefined
          }
        >
          {canOpen
            ? "Open the cycle for the coming intervention year to start collecting proposed projects."
            : "A cycle is opened by the Director, Physical Planning (Direct Intervention) or the State's SUBEB (Matching Grants). It appears here once it is open."}
        </EmptyPanel>
      )}

      {selected && <CyclePicker cycles={cycles} selected={selected} onSelect={selectCycle} />}
      {selected && cycleQuery.isError && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          This cycle could not be loaded.
        </p>
      )}
      {cycle && <CycleFacts cycle={cycle} />}
      {cycle && <DeadlineStrip cycle={cycle} />}

      {active && (
        <>
          <Tabs tabs={tabs} active={active} onChange={setTab} label="Needs assessment" idPrefix={TAB_PREFIX} />
          <TabPanel idPrefix={TAB_PREFIX} id={active}>
            {active === "approved-lists" && <ApprovedListsTab />}
            {active !== "approved-lists" && !cycle && selected && (
              <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
                <span className="sr-only">Loading the cycle…</span>
              </div>
            )}
            {cycle && active === "proposals" && <ProposedProjectsTab cycle={cycle} canUpload={canUpload} onUpload={() => setUploadOpen(true)} />}
            {cycle && active === "prioritisation" && (
              <EmptyPanel title="Nothing to prioritise yet">
                Proposed projects come here once they are validated and costed. The committee's score sheets, the ranking and the funding line against the
                indicative ceiling ({money(cycle.indicativeCeilingNgn)}) will be shown in this tab.
              </EmptyPanel>
            )}
            {cycle && active === "approvals" && (
              <EmptyPanel title="Nothing to approve yet">
                {cycle.fundingGate === "BEAP_APPROVAL"
                  ? "The prioritised list goes to the State's approval, then the BEAP goes to UBEC. Each submission and its approval steps will be shown here."
                  : "The prioritised portfolio goes through management review to the Executive Secretary. The submission and its approval steps will be shown here."}
              </EmptyPanel>
            )}
            {cycle && active === "procurement" && (
              <EmptyPanel title="No procurement plan yet">
                {cycle.fundingGate === "BEAP_APPROVAL"
                  ? "Lots and procurement methods are set in the BEAP once the State's list is approved."
                  : "Funded proposed projects become draft projects at appropriation; they are grouped into lots and batches here."}
              </EmptyPanel>
            )}
            {cycle && active === "documents" && <CycleDocumentsTab cycle={cycle} canManage={canManageCycle} />}
          </TabPanel>
        </>
      )}

      {openDialog && optionsQuery.data && (
        <OpenCycleDialog
          options={optionsQuery.data}
          onClose={() => setOpenDialog(false)}
          onOpened={(id) => {
            setOpenDialog(false);
            const next = new URLSearchParams();
            next.set("cycle", id);
            setParams(next, { replace: true });
          }}
        />
      )}
      {uploadOpen && cycle && <NeedsUploadDialog cycleId={cycle.id} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

/** Year, programme and (for State-level programmes) State; each choice lands on an existing cycle. */
function CyclePicker({ cycles, selected, onSelect }: { cycles: NeedsCycleSummaryDto[]; selected: NeedsCycleSummaryDto; onSelect: (id: string) => void }) {
  const years = [...new Set(cycles.map((c) => c.interventionYear))];
  const inYear = cycles.filter((c) => c.interventionYear === selected.interventionYear);
  const programmes = [...new Map(inYear.map((c) => [c.projectTypeId, c.projectTypeName])).entries()];
  const inProgramme = inYear.filter((c) => c.projectTypeId === selected.projectTypeId);
  const states = inProgramme.filter((c) => c.stateCode);

  const pick = (match: (c: NeedsCycleSummaryDto) => boolean, prefer?: (c: NeedsCycleSummaryDto) => boolean) => {
    const pool = cycles.filter(match);
    const chosen = (prefer && pool.find(prefer)) ?? pool.find((c) => c.status === "OPEN") ?? pool[0];
    if (chosen) onSelect(chosen.id);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cycle">
      <div className="w-48">
        <CustomSelect
          ariaLabel="Intervention year"
          value={String(selected.interventionYear)}
          onChange={(v) => pick((c) => c.interventionYear === Number(v), (c) => c.projectTypeId === selected.projectTypeId)}
          options={years.map((y) => ({ value: String(y), label: `Intervention year ${y}` }))}
          size="sm"
        />
      </div>
      <div className="w-52">
        <CustomSelect
          ariaLabel="Programme"
          value={selected.projectTypeId}
          onChange={(v) => pick((c) => c.interventionYear === selected.interventionYear && c.projectTypeId === v)}
          options={programmes.map(([id, name]) => ({ value: id, label: name }))}
          size="sm"
        />
      </div>
      {states.length > 0 && (
        <div className="w-44">
          <CustomSelect
            ariaLabel="State"
            value={selected.id}
            onChange={(v) => onSelect(v)}
            options={states.map((c) => ({ value: c.id, label: stateName(c.stateCode), description: c.status === "OPEN" ? "Open" : "Closed" }))}
            size="sm"
            searchable={states.length > 8}
          />
        </div>
      )}
    </div>
  );
}

const CYCLE_STATUS_TEXT: Record<NeedsCycleDto["status"], string> = { DRAFT: "Draft", OPEN: "Open", CLOSED: "Closed" };

function CycleFacts({ cycle }: { cycle: NeedsCycleDto }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <Fact label="Status" value={CYCLE_STATUS_TEXT[cycle.status]} />
      <Fact label="Owner" value={cycle.owningOrganizationName} />
      <Fact label="Proposed projects" value={String(cycle.proposalCount)} />
      <Fact label="Indicative ceiling" value={money(cycle.indicativeCeilingNgn)} />
      <Fact label="Costing standard" value={cycle.costingStandardVersion ? `Version ${cycle.costingStandardVersion}` : "–"} />
      <Fact label="Template" value={cycle.templateVersion} />
    </dl>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
