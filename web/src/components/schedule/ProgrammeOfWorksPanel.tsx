import React, { useMemo, useState } from "react";
import { ClipboardList, X } from "lucide-react";
import type { ProgrammeOfWorksDto, ProjectScheduleDto, ProgrammeOfWorksStatus } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { formatDateTimeShort } from "../../lib/formatters";
import { useProjectBoqQuery } from "../../queries/boq/useBoqQueries";
import { useProgrammesOfWorksQuery } from "../../queries/contracts/useContractQueries";
import { useDecideProgrammeMutation, useSubmitProgrammeMutation } from "../../mutations/contracts/useContractMutations";
import Loader from "../Loader";
import { CustomSelect } from "../common";
import { primaryButton, secondaryButton, sectionClass, smallInput, StatusChip } from "../contracts/contractUi";

/**
 * Phase 13: the contractor proposes the programme of works (item start and end dates); the monitor
 * accepts it (it becomes the schedule baseline) or returns it with notes. Dated items on a live
 * project keep moving only through schedule revisions, so only undated items can be proposed.
 */

const STATUS_META: Record<ProgrammeOfWorksStatus, { label: string; cls: string }> = {
  PENDING: { label: "Awaiting acceptance", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  ACCEPTED: { label: "Accepted", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  RETURNED: { label: "Returned", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

export function ProgrammeOfWorksPanel({ project, schedule }: { project: ProjectSummaryDto; schedule: ProjectScheduleDto | null }) {
  const { user, hasPermission } = useAuth();
  const canPropose = hasPermission("schedule:propose_programme");
  const canDecide = hasPermission("projects:edit_baseline");
  const q = useProgrammesOfWorksQuery(project.id, canPropose || canDecide);
  // Item names: the schedule when the user can read it, else the BOQ (contractors).
  const boq = useProjectBoqQuery(project.id, (canPropose || canDecide) && !schedule && hasPermission("boq:view"));
  const itemNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const b of boq.data ?? []) names.set(b.id, `${b.wbsCode} ${b.description}`);
    for (const i of schedule?.items ?? []) names.set(i.id, `${i.wbsCode} ${i.description}`);
    return names;
  }, [boq.data, schedule]);
  const [proposing, setProposing] = useState(false);
  if (!canPropose && !canDecide) return null;

  const myContractorIds = project.contractors.filter((c) => c.organizationId === user?.organizationId).map((c) => c.id);
  const submissions = [...(q.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const myPending = submissions.some(
    (s) => s.status === "PENDING" && (s.submittedByUserId === user?.id || (s.projectContractorId && myContractorIds.includes(s.projectContractorId)))
  );

  return (
    <section className={sectionClass} aria-label="Programme of works">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-brand-primary" /> Programme of works
          </h2>
          <p className="text-[11px] text-slate-500">The contractor proposes item dates; once accepted they become the schedule baseline.</p>
        </div>
        {canPropose && !proposing && (
          <button
            type="button"
            className={primaryButton}
            disabled={myPending}
            title={myPending ? "Your last programme is still waiting for a decision" : undefined}
            onClick={() => setProposing(true)}
          >
            Propose programme
          </button>
        )}
      </div>
      {proposing && <ProposeForm project={project} schedule={schedule} myContractorIds={myContractorIds} onDone={() => setProposing(false)} />}
      {q.isLoading ? (
        <Loader />
      ) : q.isError ? (
        <p className="text-xs text-slate-500">Programmes could not be loaded.</p>
      ) : submissions.length === 0 ? (
        <p className="text-xs text-slate-500">No programme submitted yet.</p>
      ) : (
        <ul className="space-y-2">
          {submissions.map((s) => (
            <SubmissionRow key={s.id} projectId={project.id} s={s} canDecide={canDecide && s.submittedByUserId !== user?.id} itemNames={itemNames} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SubmissionRow({ projectId, s, canDecide, itemNames }: { projectId: string; s: ProgrammeOfWorksDto; canDecide: boolean; itemNames: Map<string, string> }) {
  const decide = useDecideProgrammeMutation(projectId);
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(s.status === "PENDING");
  const itemName = (id: string) => itemNames.get(id) ?? "Item not visible to you";
  const meta = STATUS_META[s.status];
  return (
    <li className="rounded-xl border border-slate-200 p-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-semibold text-slate-900">{s.contractorName ?? s.submittedByName ?? "Contractor"}</span>
          <span className="text-slate-500">
            {" "}
            · {s.itemCount} item(s) · submitted {formatDateTimeShort(s.createdAt)}
            {s.submittedByName ? ` by ${s.submittedByName}` : ""}
          </span>
        </span>
        <StatusChip label={meta.label} cls={meta.cls} />
      </div>
      {s.proposal.notes && <p className="text-slate-700">“{s.proposal.notes}”</p>}
      {s.decisionNotes && (
        <p className="text-slate-600">
          {s.status === "RETURNED" ? "Returned" : "Decided"} by {s.decidedByName ?? "the monitor"}
          {s.decidedAt ? ` on ${formatDateTimeShort(s.decidedAt)}` : ""}: {s.decisionNotes}
        </p>
      )}
      <button type="button" className="text-[11px] font-semibold text-brand-primary hover:underline" onClick={() => setExpanded((x) => !x)}>
        {expanded ? "Hide dates" : "Show dates"}
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Item</th>
                <th className="px-2 py-1 text-left font-semibold">Start</th>
                <th className="px-2 py-1 text-left font-semibold">End</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(s.proposal.plannedStartDate || s.proposal.plannedEndDate) && (
                <tr className="font-semibold">
                  <td className="px-2 py-1">Project</td>
                  <td className="px-2 py-1 tabular-nums">{s.proposal.plannedStartDate ?? "–"}</td>
                  <td className="px-2 py-1 tabular-nums">{s.proposal.plannedEndDate ?? "–"}</td>
                </tr>
              )}
              {s.proposal.items.map((i) => {
                const preds = s.proposal.dependencies.filter((d) => d.successorBoqItemId === i.boqItemId);
                return (
                  <tr key={i.boqItemId}>
                    <td className="px-2 py-1">
                      {itemName(i.boqItemId)}
                      {preds.length > 0 && (
                        <span className="block text-[10px] text-slate-500">
                          after {preds.map((d) => `${itemName(d.predecessorBoqItemId)}${d.lagWorkdays ? ` + ${d.lagWorkdays} working day(s)` : ""}`).join("; ")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 tabular-nums">{i.plannedStartDate}</td>
                    <td className="px-2 py-1 tabular-nums">{i.plannedEndDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {s.status === "PENDING" && canDecide && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input className={`${smallInput} flex-1 min-w-[12rem]`} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (required to return)" aria-label="Decision notes" />
          <button type="button" className={primaryButton} disabled={decide.isPending} onClick={() => decide.mutate({ submissionId: s.id, body: { decision: "ACCEPT", notes: notes.trim() || null } })}>
            Accept
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={decide.isPending || notes.trim().length < 5}
            onClick={() => decide.mutate({ submissionId: s.id, body: { decision: "RETURN", notes: notes.trim() } })}
          >
            Return
          </button>
        </div>
      )}
    </li>
  );
}

function ProposeForm({
  project,
  schedule,
  myContractorIds,
  onDone,
}: {
  project: ProjectSummaryDto;
  schedule: ProjectScheduleDto | null;
  myContractorIds: string[];
  onDone: () => void;
}) {
  const { hasPermission } = useAuth();
  const boq = useProjectBoqQuery(project.id, hasPermission("boq:view"));
  const submit = useSubmitProgrammeMutation(project.id);
  const hasBaseline = Boolean(schedule?.summary.hasBaseline);
  const [projectStart, setProjectStart] = useState(schedule?.summary.plannedStartDate ?? "");
  const [projectEnd, setProjectEnd] = useState(schedule?.summary.plannedEndDate ?? "");
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  /** Finish-to-start links: the successor is an item of this programme, the predecessor any item. */
  const [deps, setDeps] = useState<Array<{ predecessorBoqItemId: string; successorBoqItemId: string; lagWorkdays: number }>>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Items this contractor can date: its own package (or all, without packages), not dated yet. */
  const items = useMemo(() => {
    const dated = new Set((schedule?.items ?? []).filter((i) => i.plannedStartDate && i.plannedEndDate).map((i) => i.id));
    const source =
      boq.data?.map((b) => ({ id: b.id, wbsCode: b.wbsCode, description: b.description, contractorId: b.projectContractorId ?? null })) ??
      (schedule?.items ?? []).map((i) => ({ id: i.id, wbsCode: i.wbsCode, description: i.description, contractorId: null as string | null }));
    const mine = myContractorIds.length ? source.filter((i) => !i.contractorId || myContractorIds.includes(i.contractorId)) : source;
    return mine.filter((i) => !dated.has(i.id)).sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true }));
  }, [boq.data, schedule, myContractorIds]);

  const allItems = useMemo(
    () =>
      (boq.data?.map((b) => ({ id: b.id, wbsCode: b.wbsCode, description: b.description })) ??
        (schedule?.items ?? []).map((i) => ({ id: i.id, wbsCode: i.wbsCode, description: i.description }))
      ).sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true })),
    [boq.data, schedule]
  );
  const wbsOf = (id: string) => allItems.find((i) => i.id === id)?.wbsCode ?? id.slice(0, 8);
  const predsOf = (successor: string) => deps.filter((d) => d.successorBoqItemId === successor);
  const addPred = (successor: string, predecessor: string) =>
    setDeps((ds) =>
      ds.some((d) => d.successorBoqItemId === successor && d.predecessorBoqItemId === predecessor)
        ? ds
        : [...ds, { predecessorBoqItemId: predecessor, successorBoqItemId: successor, lagWorkdays: 0 }]
    );
  const removePred = (successor: string, predecessor: string) =>
    setDeps((ds) => ds.filter((d) => !(d.successorBoqItemId === successor && d.predecessorBoqItemId === predecessor)));
  const setLag = (successor: string, predecessor: string, lag: number) =>
    setDeps((ds) =>
      ds.map((d) => (d.successorBoqItemId === successor && d.predecessorBoqItemId === predecessor ? { ...d, lagWorkdays: Math.max(0, Math.min(365, lag)) } : d))
    );

  const send = () => {
    const rows = items
      .map((i) => ({ boqItemId: i.id, plannedStartDate: dates[i.id]?.start ?? "", plannedEndDate: dates[i.id]?.end ?? "" }))
      .filter((r) => r.plannedStartDate || r.plannedEndDate);
    if (rows.length === 0) return setError("Date at least one item.");
    const half = rows.find((r) => !r.plannedStartDate || !r.plannedEndDate);
    if (half) return setError("Give every dated item both a start and an end.");
    const backwards = rows.find((r) => r.plannedEndDate < r.plannedStartDate);
    if (backwards) return setError("An item ends before it starts.");
    if (!hasBaseline && projectStart && projectEnd && projectEnd < projectStart) return setError("The project ends before it starts.");
    setError(null);
    submit.mutate(
      {
        ...(!hasBaseline && projectStart ? { plannedStartDate: projectStart } : {}),
        ...(!hasBaseline && projectEnd ? { plannedEndDate: projectEnd } : {}),
        items: rows,
        // Links only for items in this programme (an item left empty drops its links).
        dependencies: deps.filter((d) => rows.some((r) => r.boqItemId === d.successorBoqItemId)),
        notes: notes.trim() || null,
      },
      { onSuccess: onDone }
    );
  };

  return (
    <div className="rounded-xl border border-brand-primary/25 bg-brand-primary/5 p-4 space-y-3">
      <p className="text-xs font-bold text-slate-900">Propose a programme</p>
      {!hasBaseline && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="pow-start">
              Project start
            </label>
            <input id="pow-start" type="date" className={smallInput} value={projectStart} onChange={(e) => setProjectStart(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="pow-end">
              Project end
            </label>
            <input id="pow-end" type="date" className={smallInput} value={projectEnd} onChange={(e) => setProjectEnd(e.target.value)} />
          </div>
        </div>
      )}
      {boq.isLoading ? (
        <Loader />
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">Every item you can date already has dates. Dated items move through schedule revisions.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Item</th>
                <th className="px-2 py-1.5 text-left font-semibold w-40">Start</th>
                <th className="px-2 py-1.5 text-left font-semibold w-40">End</th>
                <th className="px-2 py-1.5 text-left font-semibold w-56" title="Must finish (plus a lag in working days) before this item starts">
                  Starts after
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-2 py-1">
                    <span className="font-semibold text-slate-700">{i.wbsCode}</span> <span className="text-slate-600">{i.description}</span>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="date"
                      className={smallInput}
                      aria-label={`Start of ${i.wbsCode}`}
                      value={dates[i.id]?.start ?? ""}
                      onChange={(e) => setDates((d) => ({ ...d, [i.id]: { start: e.target.value, end: d[i.id]?.end ?? "" } }))}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="date"
                      className={smallInput}
                      aria-label={`End of ${i.wbsCode}`}
                      value={dates[i.id]?.end ?? ""}
                      onChange={(e) => setDates((d) => ({ ...d, [i.id]: { start: d[i.id]?.start ?? "", end: e.target.value } }))}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1 mb-1">
                      {predsOf(i.id).map((p) => (
                        <span
                          key={p.predecessorBoqItemId}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 pl-2 pr-1 py-0.5 text-[10px] text-slate-700"
                        >
                          {wbsOf(p.predecessorBoqItemId)}
                          <span className="text-slate-400">+</span>
                          <input
                            type="number"
                            min={0}
                            max={365}
                            aria-label={`Lag in working days after ${wbsOf(p.predecessorBoqItemId)}`}
                            title="Lag in working days"
                            className="w-9 rounded border border-slate-200 bg-white px-1 text-[10px]"
                            value={p.lagWorkdays}
                            onChange={(e) => setLag(i.id, p.predecessorBoqItemId, Number(e.target.value) || 0)}
                          />
                          <button
                            type="button"
                            aria-label={`Remove predecessor ${wbsOf(p.predecessorBoqItemId)}`}
                            onClick={() => removePred(i.id, p.predecessorBoqItemId)}
                            className="rounded-full p-0.5 hover:bg-slate-200"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <CustomSelect
                      value=""
                      onChange={(value) => value && addPred(i.id, value)}
                      options={allItems
                        .filter((o) => o.id !== i.id && !predsOf(i.id).some((p) => p.predecessorBoqItemId === o.id))
                        .map((o) => ({ value: o.id, label: `WBS ${o.wbsCode}`, description: o.description }))}
                      placeholder="Add predecessor…"
                      searchable
                      size="sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Leave an item empty to leave it out. "Starts after" links an item to the items that must finish first (any item of the project, with an optional lag in working days); the monitor checks the whole plan when accepting.
      </p>
      <input className={smallInput} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the monitor (optional)" aria-label="Notes" />
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onDone}>
          Cancel
        </button>
        <button type="button" className={primaryButton} disabled={submit.isPending || items.length === 0} onClick={send}>
          {submit.isPending ? "Sending…" : "Send for acceptance"}
        </button>
      </div>
    </div>
  );
}
