import React, { useMemo, useState } from "react";
import { Download, FileUp, Lock, LockOpen } from "lucide-react";
import {
  INTERVENTION_ACTION_LABELS,
  NIGERIA_ZONES,
  type CostingStandardRate,
  type CostingStandardVersionDto,
  type CostingStandardVersionSummaryDto,
} from "@insite/shared";
import { StandardTable, type TableColumnDef } from "../table";
import { CustomSelect } from "../common/CustomSelect";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { EmptyPanel, cardCls, money } from "../needs/needsUi";
import { useCostingStandardVersionQuery } from "../../queries/needs/useStandardsQueries";
import { useDownloadCostingTemplateMutation } from "../../mutations/needs/useStandardsMutations";
import { formatDateTimeShort } from "../../lib/formatters";
import { CostingUploadDialog } from "./CostingUploadDialog";

/**
 * Needs pipeline wave 2 (C1): the Costing tab of the Standards page. The latest version (or an
 * earlier one picked from the list): rates, zone factors, supervision and monitoring %, contingency %
 * and ceilings; the versions list with locked state; template download and upload for
 * `standards:manage`.
 */

function LockTag({ locked }: { locked: boolean }) {
  const Icon = locked ? Lock : LockOpen;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        locked ? "border-slate-300 bg-slate-100 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
      title={locked ? "A cycle or a needs assessment uses it: a change saves a new version" : "Not used yet: an upload edits it in place"}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {locked ? "Locked" : "Editable"}
    </span>
  );
}

export function CostingStandardPanel({
  current,
  versions,
  canManage,
  facilityName,
}: {
  current: CostingStandardVersionDto | null;
  versions: CostingStandardVersionSummaryDto[];
  canManage: boolean;
  facilityName: (code: string) => string;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const template = useDownloadCostingTemplateMutation();
  const earlier = useCostingStandardVersionQuery(viewId && viewId !== current?.id ? viewId : null);
  const shown = viewId && viewId !== current?.id ? earlier.data ?? null : current;

  const actions = canManage ? (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={secondaryButton} disabled={template.isPending} onClick={() => template.mutate()}>
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download template"}
      </button>
      <button type="button" className={primaryButton} onClick={() => setUploadOpen(true)}>
        <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload costing standard
      </button>
    </div>
  ) : null;

  if (!current) {
    return (
      <>
        <EmptyPanel title="No costing standard yet" action={actions}>
          {canManage
            ? "Download the template, fill the rates and upload it. Needs assessments are costed against it."
            : "The costing standard appears here once it is uploaded."}
        </EmptyPanel>
        {uploadOpen && <CostingUploadDialog onClose={() => setUploadOpen(false)} />}
      </>
    );
  }

  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const versionOptions = sorted.map((v) => ({ value: v.id, label: `Version ${v.version}${v.isLatest ? " (latest)" : ""}`, description: v.note ?? undefined }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <CustomSelect ariaLabel="Costing standard version" value={shown?.id ?? current.id} onChange={(v) => setViewId(v)} options={versionOptions} size="sm" />
          </div>
          {shown && <LockTag locked={shown.isLocked} />}
          {shown && (
            <span className="text-[11px] text-slate-500">
              Saved {formatDateTimeShort(shown.savedAt)} by {shown.savedByName}
              {shown.note ? ` · ${shown.note}` : ""}
            </span>
          )}
        </div>
        {actions}
      </div>

      {!shown && earlier.isLoading && (
        <div role="status" className="h-24 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
          <span className="sr-only">Loading the version…</span>
        </div>
      )}
      {shown && <VersionContent version={shown} facilityName={facilityName} />}

      <VersionsTable versions={sorted} onView={(id) => setViewId(id)} />

      {uploadOpen && <CostingUploadDialog onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

function VersionContent({ version, facilityName }: { version: CostingStandardVersionDto; facilityName: (code: string) => string }) {
  const s = version.standard;
  const [q, setQ] = useState("");
  const rates = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return s.rates;
    return s.rates.filter((r) => [r.itemCode, r.description, r.facilityCode ? facilityName(r.facilityCode) : ""].some((t) => t.toLowerCase().includes(term)));
  }, [s.rates, q, facilityName]);

  const columns: TableColumnDef<CostingStandardRate>[] = [
    { id: "code", header: "Item code", cell: (r) => <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-slate-900">{r.itemCode}</span> },
    { id: "description", header: "Description", cell: (r) => <span className="text-slate-800">{r.description}</span> },
    { id: "facility", header: "Facility", cell: (r) => <span className="whitespace-nowrap text-slate-700">{r.facilityCode ? facilityName(r.facilityCode) : "Any facility"}</span> },
    { id: "unit", header: "Unit", cell: (r) => <span className="text-slate-700">{r.unitOfMeasure}</span> },
    { id: "rate", header: "Base rate", align: "right", cell: (r) => <span className="whitespace-nowrap tabular-nums text-slate-900">{money(r.rateNgn)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className={cardCls} aria-labelledby="costing-percentages">
          <h3 id="costing-percentages" className="text-sm font-bold text-slate-900">
            Added to the works subtotal
          </h3>
          <dl className="mt-2 space-y-1 text-xs">
            <Row label="Supervision and monitoring" value={`${s.supervisionMonitoringPct}%`} />
            <Row label="Contingency" value={`${s.contingencyPct}%`} />
          </dl>
        </section>
        <section className={cardCls} aria-labelledby="costing-zones">
          <h3 id="costing-zones" className="text-sm font-bold text-slate-900">
            Zone factors
          </h3>
          <p className="text-[11px] text-slate-500">Each base rate is multiplied by its zone's factor.</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {NIGERIA_ZONES.map((z) => (
              <Row key={z.code} label={z.name} value={`× ${s.zoneFactors[z.code]}`} />
            ))}
          </dl>
        </section>
        <section className={cardCls} aria-labelledby="costing-ceilings">
          <h3 id="costing-ceilings" className="text-sm font-bold text-slate-900">
            Ceilings per unit
          </h3>
          {s.ceilings.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">No ceilings.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {s.ceilings.map((c) => (
                <li key={`${c.facilityCode}-${c.interventionAction ?? "any"}`} className="flex flex-wrap justify-between gap-2">
                  <span className="text-slate-700">
                    {facilityName(c.facilityCode)} · {c.interventionAction ? INTERVENTION_ACTION_LABELS[c.interventionAction] : "Any action"}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">{money(c.maxNgnPerUnit)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <StandardTable<CostingStandardRate>
        title={`Rates · version ${version.version}`}
        subtitle={`${s.rates.length} rated item${s.rates.length === 1 ? "" : "s"}`}
        search={{ value: q, onChange: setQ, placeholder: "Search item code, description or facility" }}
        columns={columns}
        data={rates}
        keyExtractor={(r) => r.itemCode}
        minWidth="min-w-[720px]"
        emptyState={{ title: q ? "No rate matches the search" : "No rates in this version" }}
      />
    </div>
  );
}

function VersionsTable({ versions, onView }: { versions: CostingStandardVersionSummaryDto[]; onView: (id: string) => void }) {
  const columns: TableColumnDef<CostingStandardVersionSummaryDto>[] = [
    {
      id: "version",
      header: "Version",
      cell: (v) => (
        <span className="whitespace-nowrap font-semibold text-slate-900">
          {v.version}
          {v.isLatest && <span className="ml-1 text-[11px] font-normal text-slate-500">(latest)</span>}
        </span>
      ),
    },
    {
      id: "saved",
      header: "Saved",
      cell: (v) => (
        <span className="whitespace-nowrap text-slate-700">
          {formatDateTimeShort(v.savedAt)}
          <span className="block text-[11px] text-slate-500">{v.savedByName}</span>
        </span>
      ),
    },
    { id: "note", header: "Note", cell: (v) => <span className="text-slate-700">{v.note ?? "–"}</span> },
    { id: "rates", header: "Rates", align: "right", cell: (v) => <span className="tabular-nums text-slate-700">{v.rateCount}</span> },
    { id: "cycles", header: "Cycles using it", align: "right", cell: (v) => <span className="tabular-nums text-slate-700">{v.cycleCount}</span> },
    { id: "locked", header: "State", cell: (v) => <LockTag locked={v.isLocked} /> },
  ];
  return (
    <StandardTable<CostingStandardVersionSummaryDto>
      title="Versions"
      subtitle="A version a cycle or a needs assessment uses is locked; a change to it saves the next version"
      columns={columns}
      data={versions}
      keyExtractor={(v) => v.id}
      onRowClick={(v) => onView(v.id)}
      minWidth="min-w-[720px]"
      pageSize={10}
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
