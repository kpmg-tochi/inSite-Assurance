import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { addDays, VISIT_KIND_META, VisitKindEnum, type PlannerDto, type PlannerVisitsExportQuery, type VisitDto } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import Loader from "../../components/Loader";
import { CustomSelect } from "../../components/common";
import { usePlannerQuery } from "../../queries/visits/useVisitQueries";
import { useRegionsQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { EditVisitDialog, ProposalDecisionForm } from "../../components/visits/VisitDialogs";
import { ExportExcelButton } from "../../components/common/ExportExcelButton";
import { useExportPlannerVisitsMutation } from "../../mutations/screenExports/useScreenExportMutations";
import { TAB_LIST_CLASS, tabItemClass } from "../../components/common/Tabs";
import { primaryButton, secondaryButton, visitKindLabel, VisitStatusChip, WarningsList } from "../../components/visits/visitUi";

/**
 * Redesign R4b: the visit planner (spec 8.1). Officers × days for a week or a month, filtered by
 * region, project, officer and visit kind. Drag a visit to another day to move it (the manager is
 * asked for a note); proposals and declines wait in the side panel. Warnings never block.
 */

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(date, 1 - iso);
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** `embedded`: shown as the home page's Visits tab (UBEC rebrand), so the tab names it, not a heading. */
export function VisitPlannerPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { hasPermission } = useAuth();
  const canPlan = hasPermission("visits:plan");
  const [span, setSpan] = useState<"week" | "month">("week");
  const [start, setStart] = useState(() => mondayOf(todayIso()));
  const [regionId, setRegionId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [officerId, setOfficerId] = useState("");
  const [visitKind, setVisitKind] = useState("");
  const [moving, setMoving] = useState<{ visit: VisitDto; date: string } | null>(null);
  const days = span === "week" ? 7 : 28;
  const end = addDays(start, days - 1);
  const regions = useRegionsQuery();
  const exportVisits = useExportPlannerVisitsMutation();
  const q = usePlannerQuery({ from: start, to: end, regionId: regionId || undefined, projectId: projectId || undefined, officerId: officerId || undefined, visitKind: visitKind || undefined });
  const data: PlannerDto | undefined = q.data;
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(start, i)), [start, days]);
  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of data?.visits ?? []) map.set(v.projectId, `${v.projectCode} · ${v.projectName}`);
    return [...map.entries()];
  }, [data]);
  const rows = useMemo(() => {
    const officers = data?.officers ?? [];
    const unassigned = (data?.visits ?? []).filter((v) => v.assignees.length === 0);
    return [
      ...officers.map((o) => ({ key: o.userId, label: o.fullName, meta: `${o.visitCount} visit(s) · moved ${o.rescheduleCount}×`, visits: (data?.visits ?? []).filter((v) => v.assignees.some((a) => a.userId === o.userId)) })),
      ...(unassigned.length ? [{ key: "none", label: "No officer", meta: `${unassigned.length} visit(s)`, visits: unassigned }] : []),
    ];
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {!embedded && <h1 className="text-lg font-bold text-slate-900">Visit planner</h1>}
          <p className={embedded ? "text-sm text-slate-600" : "text-xs text-slate-500"}>
            Every visit across your projects by officer and day.{canPlan ? " Drag a visit to another day to move it." : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setStart(addDays(start, -days))} aria-label="Earlier">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button type="button" className={secondaryButton} onClick={() => setStart(mondayOf(todayIso()))}>
            Today
          </button>
          <button type="button" className={secondaryButton} onClick={() => setStart(addDays(start, days))} aria-label="Later">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <div role="group" aria-label="Period" className={TAB_LIST_CLASS}>
            {(["week", "month"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSpan(s)} aria-pressed={span === s} className={tabItemClass(span === s)}>
                {s === "week" ? "Week" : "4 weeks"}
              </button>
            ))}
          </div>
          <ExportExcelButton
            pending={exportVisits.isPending}
            onClick={() =>
              exportVisits.mutate({
                from: start,
                to: end,
                regionId: regionId || undefined,
                projectId: projectId || undefined,
                officerId: officerId || undefined,
                visitKind: (visitKind || undefined) as PlannerVisitsExportQuery["visitKind"],
              })
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="w-48">
          <CustomSelect
            value={regionId}
            onChange={(v) => setRegionId(String(v))}
            options={[{ value: "", label: "All regions" }, ...(regions.data ?? []).filter((r) => !r.isArchived).map((r) => ({ value: r.id, label: r.parentRegionName ? `${r.parentRegionName} · ${r.name}` : r.name }))]}
          />
        </div>
        <div className="w-56">
          <CustomSelect value={projectId} onChange={(v) => setProjectId(String(v))} options={[{ value: "", label: "All projects" }, ...projects.map(([id, label]) => ({ value: id, label }))]} />
        </div>
        <div className="w-48">
          <CustomSelect value={officerId} onChange={(v) => setOfficerId(String(v))} options={[{ value: "", label: "All officers" }, ...(data?.officers ?? []).map((o) => ({ value: o.userId, label: o.fullName }))]} />
        </div>
        <div className="w-44">
          <CustomSelect value={visitKind} onChange={(v) => setVisitKind(String(v))} options={[{ value: "", label: "All kinds" }, ...VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))]} />
        </div>
      </div>

      {data && <WarningsList warnings={data.warnings} />}

      <div className="grid grid-cols-1 2xl:grid-cols-4 gap-4">
        <section className="2xl:col-span-3 bg-white rounded-2xl border border-slate-200/80 p-3 shadow-sm overflow-x-auto">
          {q.isLoading ? (
            <Loader />
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No visits from {start} to {end}.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white text-left p-2 w-40 font-semibold text-slate-500">Officer</th>
                  {dates.map((d, i) => (
                    <th key={d} className={`p-1 text-center font-semibold ${d === todayIso() ? "text-brand-primary" : "text-slate-500"}`}>
                      {WEEKDAY[i % 7]} {d.slice(8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-slate-100 align-top">
                    <td className="sticky left-0 bg-white p-2">
                      <p className="font-semibold text-slate-800">{r.label}</p>
                      <p className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                        <Repeat className="w-3 h-3" /> {r.meta}
                      </p>
                    </td>
                    {dates.map((d) => (
                      <td
                        key={d}
                        className="p-1 min-w-[6.5rem]"
                        onDragOver={(e) => {
                          if (canPlan) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          const id = e.dataTransfer.getData("text/visit-id");
                          const visit = data?.visits.find((v) => v.id === id);
                          if (visit && visit.plannedDate !== d) setMoving({ visit, date: d });
                        }}
                      >
                        {r.visits
                          .filter((v) => v.plannedDate === d)
                          .map((v) => (
                            <div
                              key={v.id}
                              draggable={canPlan && (v.status === "PLANNED" || v.status === "PROPOSED") && !v.checkInAt}
                              onDragStart={(e) => e.dataTransfer.setData("text/visit-id", v.id)}
                              className="mb-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1 hover:border-brand-primary cursor-grab"
                            >
                              <Link to={`/app/projects/${v.projectId}/visits?visitId=${v.id}`} className="block">
                                <p className="font-semibold text-slate-800 truncate">{v.projectCode}</p>
                                <p className="text-[10px] text-slate-600 truncate">{visitKindLabel(v.visitKind)}</p>
                              </Link>
                              <div className="mt-0.5 flex items-center gap-1">
                                <VisitStatusChip status={v.status} />
                                {v.confirmation === "DECLINED" && <span className="text-[10px] font-semibold text-red-700">declined</span>}
                                {v.pendingProposal && <span className="text-[10px] font-semibold text-sky-700">proposal</span>}
                              </div>
                            </div>
                          ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <aside className="space-y-3">
          <ProposalsPanel data={data} canPlan={canPlan} />
        </aside>
      </div>

      {moving && <EditVisitDialog projectId={moving.visit.projectId} visit={moving.visit} defaultDate={moving.date} onClose={() => setMoving(null)} />}
    </div>
  );
}

function ProposalItem({ item, canPlan }: { item: PlannerDto["pendingProposals"][number]; canPlan: boolean }) {
  return (
    <li className="rounded-xl border border-slate-200 p-2 text-xs space-y-1">
      <p className="font-semibold text-slate-900">
        {item.visit.projectCode} · {visitKindLabel(item.visit.visitKind)}
      </p>
      <p className="text-slate-600">
        {item.change.byName}: {item.change.fromDate} → {item.change.toDate}. {item.change.comment}
      </p>
      {canPlan && (
        <ProposalDecisionForm
          projectId={item.visit.projectId}
          visitId={item.visit.id}
          changeId={item.change.id}
          acceptLabel="Accept"
          placeholder="Why not"
          className="flex flex-wrap items-start gap-1"
          inputClassName="rounded-xl border border-slate-300 px-2 py-1 text-xs"
          acceptClassName={primaryButton}
          rejectClassName={secondaryButton}
        />
      )}
    </li>
  );
}

function ProposalsPanel({ data, canPlan }: { data: PlannerDto | undefined; canPlan: boolean }) {
  const proposals = data?.pendingProposals ?? [];
  const declines = data?.declines ?? [];
  return (
    <>
      <section className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-sm space-y-2">
        <h2 className="text-xs font-bold text-slate-900">Date proposals ({proposals.length})</h2>
        {proposals.length === 0 ? (
          <p className="text-[11px] text-slate-400">None waiting.</p>
        ) : (
          <ul className="space-y-2">
            {proposals.map((p) => (
              <ProposalItem key={p.change.id} item={p} canPlan={canPlan} />
            ))}
          </ul>
        )}
      </section>
      <section className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-sm space-y-2">
        <h2 className="text-xs font-bold text-slate-900">Declined visits ({declines.length})</h2>
        {declines.length === 0 ? (
          <p className="text-[11px] text-slate-400">None.</p>
        ) : (
          <ul className="space-y-2">
            {declines.map((d) => (
              <li key={d.visit.id} className="rounded-xl border border-red-100 bg-red-50/40 p-2 text-xs">
                <Link to={`/app/projects/${d.visit.projectId}/visits?visitId=${d.visit.id}`} className="font-semibold text-slate-900 hover:underline">
                  {d.visit.projectCode} · {visitKindLabel(d.visit.visitKind)} · {d.visit.plannedDate}
                </Link>
                <p className="text-slate-600">
                  {d.byName}: {d.comment}
                </p>
                <p className="text-[11px] text-slate-500">Reassign, move or cancel it from the visit.</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
