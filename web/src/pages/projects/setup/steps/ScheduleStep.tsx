import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarRange, Sparkles, X } from "lucide-react";
import {
  countWorkdaysInclusive,
  ISO_WEEKDAY_SHORT,
  validateScheduleBaseline,
  type ProjectScheduleDto,
  type SaveScheduleBaselineRequest,
  type ScheduleIssue,
} from "@insite/shared";
import { useAuth } from "../../../../lib/auth-context";
import { useProjectScheduleQuery } from "../../../../queries/schedule/useScheduleQueries";
import {
  useProposeScheduleDatesMutation,
  useSaveScheduleBaselineMutation,
} from "../../../../mutations/schedule/useScheduleMutations";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { CustomSelect } from "../../../../components/common";
import Loader from "../../../../components/Loader";
import { extractErrors, FieldError, inputClass, labelClass, StepSection, useRegisterStep, type StepProps } from "../setupContext";

interface Draft {
  plannedStartDate: string;
  plannedEndDate: string;
  items: Record<string, { start: string; end: string }>;
  dependencies: Array<{ predecessorBoqItemId: string; successorBoqItemId: string; lagWorkdays: number }>;
}

function fromSchedule(s: ProjectScheduleDto): Draft {
  return {
    plannedStartDate: s.summary.plannedStartDate ?? "",
    plannedEndDate: s.summary.plannedEndDate ?? "",
    items: Object.fromEntries(s.items.map((i) => [i.id, { start: i.plannedStartDate ?? "", end: i.plannedEndDate ?? "" }])),
    dependencies: s.dependencies.map((d) => ({
      predecessorBoqItemId: d.predecessorBoqItemId,
      successorBoqItemId: d.successorBoqItemId,
      lagWorkdays: d.lagWorkdays,
    })),
  };
}

function issuesFromError(err: unknown): ScheduleIssue[] {
  const details = (err as { response?: { data?: { error?: { details?: { issues?: ScheduleIssue[] } } } } })?.response?.data?.error?.details;
  return details?.issues ?? [];
}

/**
 * Phase 9 setup step: project dates, item dates and finish-to-start dependencies. Optional for
 * activation. On a live project with a baseline, dated items are locked (they move only through
 * "Catch Project Up"); items without dates can still be dated and dependencies edited.
 */
export function ScheduleStep({ projectId, setup, readOnly, mode }: StepProps) {
  const { hasPermission } = useAuth();
  const scheduleQuery = useProjectScheduleQuery(projectId);
  const saveBaseline = useSaveScheduleBaselineMutation(projectId);
  const markReviewed = useSaveSetupStepMutation(projectId);
  const propose = useProposeScheduleDatesMutation(projectId);
  const schedule = scheduleQuery.data;

  const initial = useMemo(() => (schedule ? fromSchedule(schedule) : null), [schedule]);
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [serverIssues, setServerIssues] = useState<ScheduleIssue[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  useEffect(() => setDraft(initial), [initial]);

  const canEdit = !readOnly && hasPermission("projects:edit_baseline");
  const locked = schedule?.baselineLocked ?? false;
  const week = useMemo(() => schedule?.workWeekDays ?? [1, 2, 3, 4, 5, 6], [schedule]);
  const stepStatus = setup.steps.find((s) => s.stepId === "schedule");
  const changed = Boolean(draft && initial && JSON.stringify(draft) !== JSON.stringify(initial));
  const dirty = canEdit && (changed || Boolean(stepStatus && !stepStatus.saved && setup.status === "DRAFT"));

  const itemsById = useMemo(() => new Map((schedule?.items ?? []).map((i) => [i.id, i])), [schedule]);
  const sections = useMemo(() => {
    const out: Array<{ name: string; items: ProjectScheduleDto["items"] }> = [];
    for (const item of schedule?.items ?? []) {
      const s = out.find((x) => x.name === item.section);
      if (s) s.items.push(item);
      else out.push({ name: item.section, items: [item] });
    }
    return out;
  }, [schedule]);

  const toRequest = (d: Draft): SaveScheduleBaselineRequest => ({
    plannedStartDate: d.plannedStartDate,
    plannedEndDate: d.plannedEndDate,
    items: Object.entries(d.items).map(([boqItemId, v]) => ({
      boqItemId,
      plannedStartDate: v.start || null,
      plannedEndDate: v.end || null,
    })),
    dependencies: d.dependencies,
  });

  // Same rules as the server, shown while editing.
  const localIssues = useMemo<ScheduleIssue[]>(() => {
    if (!draft || !draft.plannedStartDate || !draft.plannedEndDate) return [];
    const end =
      locked && schedule?.summary.currentProjectedEndDate && schedule.summary.currentProjectedEndDate > draft.plannedEndDate
        ? schedule.summary.currentProjectedEndDate
        : draft.plannedEndDate;
    return validateScheduleBaseline({
      plannedStartDate: draft.plannedStartDate,
      plannedEndDate: end,
      items: Object.entries(draft.items).map(([id, v]) => ({
        id,
        label: `WBS ${itemsById.get(id)?.wbsCode ?? ""}`,
        plannedStartDate: v.start || null,
        plannedEndDate: v.end || null,
      })),
      dependencies: draft.dependencies.map((d) => ({
        predecessorId: d.predecessorBoqItemId,
        successorId: d.successorBoqItemId,
        lagWorkdays: d.lagWorkdays,
      })),
      workWeekDays: week,
    });
  }, [draft, itemsById, locked, schedule, week]);

  const issues = changed ? localIssues : serverIssues;
  const issuesByItem = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) if (i.boqItemId && !m.has(i.boqItemId)) m.set(i.boqItemId, i.message);
    return m;
  }, [issues]);

  useRegisterStep(dirty, async (opts) => {
    if (!dirty || !draft) return true;
    const nothingEntered = !draft.plannedStartDate && !draft.plannedEndDate && !changed;
    try {
      if (!changed || nothingEntered) {
        // Optional step: reviewing it without dates just marks it seen.
        await markReviewed.mutateAsync({ stepId: "schedule", body: {}, silent: opts?.silent });
        return true;
      }
      if (!draft.plannedStartDate || !draft.plannedEndDate) {
        setGeneralError("Enter the project start and end dates.");
        return false;
      }
      if (localIssues.length > 0) {
        setGeneralError(localIssues[0].message);
        return false;
      }
      await saveBaseline.mutateAsync({ body: toRequest(draft), silent: opts?.silent });
      setServerIssues([]);
      setGeneralError(null);
      return true;
    } catch (err) {
      setServerIssues(issuesFromError(err));
      setGeneralError(extractErrors(err).general);
      return false;
    }
  });

  if (scheduleQuery.isLoading || !draft || !schedule) {
    return (
      <StepSection title="Schedule" description="Project and item dates.">
        <Loader />
      </StepSection>
    );
  }

  const setItem = (id: string, key: "start" | "end", value: string) =>
    setDraft((d) => (d ? { ...d, items: { ...d.items, [id]: { ...d.items[id], [key]: value } } } : d));
  const itemLocked = (id: string) => locked && Boolean(itemsById.get(id)?.plannedStartDate);
  const preds = (id: string) => draft.dependencies.filter((d) => d.successorBoqItemId === id);
  const addPredecessor = (successor: string, predecessor: string) =>
    setDraft((d) =>
      d && !d.dependencies.some((x) => x.successorBoqItemId === successor && x.predecessorBoqItemId === predecessor)
        ? { ...d, dependencies: [...d.dependencies, { predecessorBoqItemId: predecessor, successorBoqItemId: successor, lagWorkdays: 0 }] }
        : d,
    );
  const removePredecessor = (successor: string, predecessor: string) =>
    setDraft((d) =>
      d ? { ...d, dependencies: d.dependencies.filter((x) => !(x.successorBoqItemId === successor && x.predecessorBoqItemId === predecessor)) } : d,
    );
  const setLag = (successor: string, predecessor: string, lag: number) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            dependencies: d.dependencies.map((x) =>
              x.successorBoqItemId === successor && x.predecessorBoqItemId === predecessor ? { ...x, lagWorkdays: Math.max(0, lag) } : x,
            ),
          }
        : d,
    );

  const suggest = async () => {
    if (!draft.plannedStartDate || !draft.plannedEndDate) {
      setGeneralError("Enter the project start and end dates first.");
      return;
    }
    const targets = schedule.items.filter((i) => !itemLocked(i.id)).map((i) => i.id);
    const result = await propose.mutateAsync({
      plannedStartDate: draft.plannedStartDate,
      plannedEndDate: draft.plannedEndDate,
      boqItemIds: targets,
    });
    setDraft((d) =>
      d
        ? {
            ...d,
            items: {
              ...d.items,
              ...Object.fromEntries(result.items.map((i) => [i.boqItemId, { start: i.plannedStartDate, end: i.plannedEndDate }])),
            },
          }
        : d,
    );
    setGeneralError(null);
  };

  const weekText = week.map((d) => ISO_WEEKDAY_SHORT[d]).join(", ");
  const projectIssue = issues.find((i) => i.code === "PROJECT_END_BEFORE_START")?.message;
  const generalIssues = issues.filter((i) => !i.boqItemId && i.code !== "PROJECT_END_BEFORE_START");

  return (
    <div className="space-y-4">
      <StepSection
        title="Schedule"
        description={`Optional. Planned dates drive briefs and the schedule variance. Working days: ${weekText} (set in the Reporting step).`}
        actions={
          mode === "settings" && hasPermission("schedule:view_variance") ? (
            <Link to={`/app/projects/${projectId}/schedule`} className="text-xs font-semibold text-brand-primary hover:underline">
              Open schedule
            </Link>
          ) : undefined
        }
      >
        {locked && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            This project is live, so its baseline is fixed. Move dated items with <strong>Catch Project Up</strong> on the Schedule
            page; you can still date new items and edit dependencies here.
          </div>
        )}
        {generalError && <p className="text-xs font-medium text-red-600">{generalError}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className={labelClass} htmlFor="sched-start">
              Project start
            </label>
            <input
              id="sched-start"
              type="date"
              className={inputClass(Boolean(projectIssue))}
              value={draft.plannedStartDate}
              disabled={!canEdit || locked}
              onChange={(e) => setDraft({ ...draft, plannedStartDate: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="sched-end">
              Project end
            </label>
            <input
              id="sched-end"
              type="date"
              className={inputClass(Boolean(projectIssue))}
              value={draft.plannedEndDate}
              disabled={!canEdit || locked}
              onChange={(e) => setDraft({ ...draft, plannedEndDate: e.target.value })}
            />
            <FieldError message={projectIssue} />
          </div>
          <div>
            {canEdit && (
              <button
                type="button"
                onClick={suggest}
                disabled={propose.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-brand-primary/30 bg-brand-primary/5 px-3 py-2 text-xs font-semibold text-brand-primary hover:bg-brand-primary/10 disabled:opacity-50"
                title="Sections in BOQ order, sized by budget; items by quantity and daily target. A starting point only."
              >
                <Sparkles className="w-3.5 h-3.5" />
                {propose.isPending ? "Suggesting…" : locked ? "Suggest dates for undated items" : "Suggest item dates"}
              </button>
            )}
          </div>
        </div>
        {generalIssues.length > 0 && (
          <ul className="list-disc pl-5 text-[11px] text-red-600">
            {generalIssues.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        )}
      </StepSection>

      <StepSection
        title="Item dates and dependencies"
        description="Each item runs from its start to its end, both inclusive. A predecessor must finish (plus any lag in working days) before the item starts."
      >
        {schedule.items.length === 0 ? (
          <p className="text-xs text-slate-500">Add BOQ items first.</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5">WBS</th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5">Start</th>
                  <th className="px-2 py-1.5">End</th>
                  <th className="px-2 py-1.5 text-right">Days</th>
                  <th className="px-2 py-1.5 min-w-[220px]">Predecessors</th>
                </tr>
              </thead>
              {sections.map((section) => (
                <tbody key={section.name}>
                  <tr>
                    <td colSpan={6} className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {section.name}
                    </td>
                  </tr>
                  {section.items.map((item) => {
                    const v = draft.items[item.id] ?? { start: "", end: "" };
                    const days = v.start && v.end ? countWorkdaysInclusive(v.start, v.end, week) : null;
                    const disabled = !canEdit || itemLocked(item.id);
                    const issue = issuesByItem.get(item.id);
                    const options = schedule.items
                      .filter((o) => o.id !== item.id && !preds(item.id).some((p) => p.predecessorBoqItemId === o.id))
                      .map((o) => ({ value: o.id, label: `WBS ${o.wbsCode}`, description: o.description }));
                    return (
                      <tr key={item.id} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-2 font-mono text-[11px] text-slate-700 whitespace-nowrap">{item.wbsCode}</td>
                        <td className="px-2 py-2 text-slate-700 max-w-[260px]">
                          <span className="line-clamp-2">{item.description}</span>
                          <FieldError message={issue} />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            aria-label={`Start of WBS ${item.wbsCode}`}
                            className={inputClass(Boolean(issue))}
                            value={v.start}
                            disabled={disabled}
                            onChange={(e) => setItem(item.id, "start", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            aria-label={`End of WBS ${item.wbsCode}`}
                            className={inputClass(Boolean(issue))}
                            value={v.end}
                            disabled={disabled}
                            onChange={(e) => setItem(item.id, "end", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">{days ?? "–"}</td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1 mb-1">
                            {preds(item.id).map((p) => (
                              <span
                                key={p.predecessorBoqItemId}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 pl-2 pr-1 py-0.5 text-[10px] text-slate-700"
                              >
                                {itemsById.get(p.predecessorBoqItemId)?.wbsCode}
                                <span className="text-slate-400">+</span>
                                <input
                                  type="number"
                                  min={0}
                                  aria-label="Lag in working days"
                                  title="Lag in working days"
                                  className="w-9 rounded border border-slate-200 bg-white px-1 text-[10px]"
                                  value={p.lagWorkdays}
                                  disabled={!canEdit}
                                  onChange={(e) => setLag(item.id, p.predecessorBoqItemId, Number(e.target.value) || 0)}
                                />
                                {canEdit && (
                                  <button
                                    type="button"
                                    aria-label={`Remove predecessor ${itemsById.get(p.predecessorBoqItemId)?.wbsCode}`}
                                    onClick={() => removePredecessor(item.id, p.predecessorBoqItemId)}
                                    className="rounded-full p-0.5 hover:bg-slate-200"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                          {canEdit && options.length > 0 && (
                            <CustomSelect
                              value=""
                              onChange={(value) => value && addPredecessor(item.id, value)}
                              options={options}
                              placeholder="Add predecessor…"
                              searchable
                              size="sm"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <CalendarRange className="w-3.5 h-3.5" />
          {schedule.summary.scheduledItemCount} of {schedule.items.length} item(s) dated on the saved baseline.
        </p>
      </StepSection>
    </div>
  );
}
