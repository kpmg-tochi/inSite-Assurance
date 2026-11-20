import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  INSPECTION_VISIT_TYPE_LABELS,
  InspectionVisitTypeEnum,
  REPORTING_STREAM_KIND_LABELS,
  ReportingCadenceEnum,
  type ProjectSetupDto,
  type ReportingStreamDto,
  type ReportingStreamInputRaw,
} from "@insite/shared";
import { useReportingStreamsQuery } from "../../queries/inspections/useInspectionQueries";
import { useSaveReportingStreamsMutation } from "../../mutations/inspections/useInspectionMutations";
import { inputClass, labelClass, StepSection } from "../../pages/projects/setup/setupContext";

/**
 * Phase 14: reporting streams on the Reporting step. With no streams the project reports on the
 * cadence above (shown as "Default"). Each stream has its own cadence and the roles that owe it:
 * item reports per BOQ item per period, or one site inspection per period. On a live project a
 * change to a stream's periods takes effect when its current period ends; a removed stream is
 * deactivated (its history stays).
 */

const CADENCE_LABEL: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BI_WEEKLY: "Every two weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  CUSTOM_INTERVAL: "Custom period",
  INSPECTION_ONLY: "No periods",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Draft = ReportingStreamInputRaw & { roleIds: string[] };

function toDraft(s: ReportingStreamDto): Draft {
  return {
    id: s.id,
    key: s.key,
    label: s.label,
    kind: s.kind,
    roleIds: s.roleIds,
    projectContractorId: s.projectContractorId,
    reportingCadence: s.reportingCadence,
    workWeekDays: s.workWeekDays,
    periodStartDayOfWeek: s.periodStartDayOfWeek,
    customIntervalDays: s.customIntervalDays,
    quarterAnchorMonth: s.quarterAnchorMonth,
    reportDueTime: s.reportDueTime,
    reportGraceMinutes: s.reportGraceMinutes,
    cadenceAnchorDate: s.cadenceAnchorDate,
    visitType: s.visitType,
    submissionDeadlineDays: s.submissionDeadlineDays,
    isActive: s.isActive,
    sortOrder: s.sortOrder,
  };
}

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "stream";

export function ReportingStreamsEditor({ projectId, setup, readOnly }: { projectId: string; setup: ProjectSetupDto; readOnly: boolean }) {
  const query = useReportingStreamsQuery(projectId);
  const save = useSaveReportingStreamsMutation(projectId);
  const initial = useMemo(() => (query.data?.streams ?? []).filter((s) => s.isActive).map(toDraft), [query.data]);
  const [streams, setStreams] = useState<Draft[]>(initial);
  useEffect(() => setStreams(initial), [initial]);
  const dirty = JSON.stringify(streams) !== JSON.stringify(initial);
  const roles = query.data?.roleOptions ?? [];
  const contractors = setup.parties.contractors;
  const live = setup.status !== "DRAFT";

  const patch = (i: number, p: Partial<Draft>) => setStreams((list) => list.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const add = () =>
    setStreams((list) => [
      ...list,
      { key: `stream-${list.length + 1}`, label: "", kind: "ITEM_REPORTS", roleIds: [], reportingCadence: "WEEKLY", projectContractorId: null, sortOrder: list.length },
    ]);

  return (
    <StepSection
      title="Reporting streams"
      description="Optional. Use streams when different people report on different cadences, e.g. weekly resident supervision and a quarterly M&E visit."
      actions={
        !readOnly ? (
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ streams: streams.map((s, i) => ({ ...s, key: s.id ? s.key : slug(s.label || s.key), sortOrder: i })) as never })}
            className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save streams"}
          </button>
        ) : undefined
      }
    >
      {query.isLoading && <p className="text-xs text-slate-500">Loading streams…</p>}
      {streams.length === 0 && !query.isLoading && (
        <p className="text-xs text-slate-600">
          <span className="font-semibold">Default</span>: the cadence above, owed by the independent verifiers and the contractors (one report per scheduled BOQ item per period).
        </p>
      )}
      <div className="space-y-3">
        {streams.map((s, i) => {
          const current = query.data?.streams.find((x) => x.id === s.id);
          return (
            <div key={s.id ?? `new-${i}`} className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Name</label>
                  <input className={inputClass()} value={s.label} onChange={(e) => patch(i, { label: e.target.value })} disabled={readOnly} placeholder="e.g. M&E visit" />
                </div>
                <div>
                  <label className={labelClass}>Kind</label>
                  <select
                    className={inputClass()}
                    value={s.kind}
                    onChange={(e) => patch(i, { kind: e.target.value as Draft["kind"], visitType: e.target.value === "INSPECTION" ? s.visitType ?? "ROUTINE" : null })}
                    disabled={readOnly || (live && Boolean(s.id))}
                  >
                    {Object.entries(REPORTING_STREAM_KIND_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Cadence</label>
                  <select className={inputClass()} value={s.reportingCadence} onChange={(e) => patch(i, { reportingCadence: e.target.value as Draft["reportingCadence"] })} disabled={readOnly}>
                    {ReportingCadenceEnum.options.map((c) => (
                      <option key={c} value={c}>{CADENCE_LABEL[c] ?? c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {s.reportingCadence === "QUARTERLY" && (
                  <div>
                    <label className={labelClass}>Quarters start in</label>
                    <select className={inputClass()} value={s.quarterAnchorMonth ?? 1} onChange={(e) => patch(i, { quarterAnchorMonth: Number(e.target.value) })} disabled={readOnly}>
                      {MONTHS.map((m, idx) => (
                        <option key={m} value={idx + 1}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
                {s.reportingCadence === "CUSTOM_INTERVAL" && (
                  <div>
                    <label className={labelClass}>Days per period</label>
                    <input type="number" min={1} max={366} className={inputClass()} value={s.customIntervalDays ?? ""} onChange={(e) => patch(i, { customIntervalDays: e.target.value ? Number(e.target.value) : null })} disabled={readOnly} />
                  </div>
                )}
                {s.kind === "INSPECTION" && (
                  <>
                    <div>
                      <label className={labelClass}>Visit type</label>
                      <select className={inputClass()} value={s.visitType ?? "ROUTINE"} onChange={(e) => patch(i, { visitType: e.target.value as Draft["visitType"] })} disabled={readOnly}>
                        {InspectionVisitTypeEnum.options.map((v) => (
                          <option key={v} value={v}>{INSPECTION_VISIT_TYPE_LABELS[v]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Upload within (days of the visit)</label>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        className={inputClass()}
                        value={s.submissionDeadlineDays ?? ""}
                        onChange={(e) => patch(i, { submissionDeadlineDays: e.target.value ? Number(e.target.value) : null })}
                        disabled={readOnly}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className={labelClass}>Contractor package</label>
                  <select className={inputClass()} value={s.projectContractorId ?? ""} onChange={(e) => patch(i, { projectContractorId: e.target.value || null })} disabled={readOnly}>
                    <option value="">All</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>{c.organizationName} ({c.tradeCode})</option>
                    ))}
                  </select>
                </div>
              </div>
              <fieldset>
                <legend className={labelClass}>Owed by (roles)</legend>
                <div className="flex flex-wrap gap-2">
                  {roles.map((r) => {
                    const on = s.roleIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        disabled={readOnly}
                        onClick={() => patch(i, { roleIds: on ? s.roleIds.filter((x) => x !== r.id) : [...s.roleIds, r.id] })}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${on ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {current?.currentPeriod
                    ? `Current period ${current.currentPeriod.periodStart} to ${current.currentPeriod.calendarEnd}, due ${new Date(current.currentPeriod.dueAt).toLocaleString()}`
                    : s.id
                      ? "No periods"
                      : "New stream: periods start when saved"}
                  {current?.pendingChange ? ` · new periods from ${current.pendingChange.effectiveFrom}` : ""}
                </span>
                {!readOnly && (
                  <button type="button" onClick={() => setStreams((list) => list.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" /> {live && s.id ? "Deactivate" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400">
          <Plus className="w-3.5 h-3.5" /> Add stream
        </button>
      )}
    </StepSection>
  );
}
