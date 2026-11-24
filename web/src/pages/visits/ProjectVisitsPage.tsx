import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarPlus, ClipboardList, Send, Sparkles } from "lucide-react";
import { VISIT_KIND_META, VISIT_STATUS_LABELS, VisitKindEnum, VisitStatusEnum, type InspectionFindingDto, type VisitDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import Loader from "../../components/Loader";
import { CustomSelect } from "../../components/common";
import { CapturePhoto, CaptureAudio } from "../../components/evidence/CaptureMedia";
import { useProjectFindingsQuery, useProjectVisitsQuery, useSiteLogQuery } from "../../queries/visits/useVisitQueries";
import { useDismissProjectFindingMutation, useGenerateVisitsMutation, usePublishVisitsMutation, useResolveProjectFindingMutation } from "../../mutations/visits/useVisitMutations";
import { CreateVisitDialog } from "../../components/visits/VisitDialogs";
import { VisitDetailPanel } from "../../components/visits/VisitDetailPanel";
import { ConfirmationText, officersText, primaryButton, secondaryButton, visitKindLabel, VisitStatusChip, WarningsList } from "../../components/visits/visitUi";

/**
 * Redesign R4: a project's visits. Plan (proposed, planned and done visits with their officers,
 * warnings, publish, generate, create), the selected visit (history, submissions, review), findings
 * and the site log. Visits are carried out in the field app.
 */

type Tab = "plan" | "findings" | "site-log";

export function ProjectVisitsPage({ project }: { project: ProjectSummaryDto }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "findings" ? "findings" : params.get("tab") === "site-log" ? "site-log" : "plan";
  const selectedId = params.get("visitId");
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Visits</h1>
          <p className="text-xs text-slate-500">The project's visit plan. Officers confirm or move their visits and submit the frozen form from the field app.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold" role="tablist">
          {(["plan", "findings", "site-log"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setParam("tab", t === "plan" ? null : t)}
              className={`rounded-lg px-3 py-1.5 ${tab === t ? "bg-white text-brand-primary shadow-xs" : "text-slate-600"}`}
            >
              {t === "plan" ? "Plan" : t === "findings" ? "Findings" : "Site log"}
            </button>
          ))}
        </div>
      </div>

      {tab === "findings" ? (
        <FindingsTab projectId={project.id} />
      ) : tab === "site-log" ? (
        <SiteLogTab projectId={project.id} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className={selectedId ? "xl:col-span-2" : "xl:col-span-5"}>
            <PlanTab projectId={project.id} selectedId={selectedId} onSelect={(id) => setParam("visitId", id)} />
          </div>
          {selectedId && (
            <div className="xl:col-span-3">
              <VisitDetailPanel projectId={project.id} visitId={selectedId} onClose={() => setParam("visitId", null)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanTab({ projectId, selectedId, onSelect }: { projectId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const { hasPermission } = useAuth();
  const canPlan = hasPermission("visits:plan");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const q = useProjectVisitsQuery(projectId, { status: status || undefined, visitKind: kind || undefined });
  const publish = usePublishVisitsMutation(projectId);
  const generate = useGenerateVisitsMutation(projectId);
  const visits = useMemo(() => {
    const all = q.data?.visits ?? [];
    return showDone || status ? all : all.filter((v) => !["APPROVED", "CANCELLED"].includes(v.status));
  }, [q.data, showDone, status]);
  const proposed = visits.filter((v) => v.status === "PROPOSED");

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <CustomSelect value={status} onChange={(v) => setStatus(String(v))} options={[{ value: "", label: "Open visits" }, ...VisitStatusEnum.options.map((s) => ({ value: s, label: VISIT_STATUS_LABELS[s] }))]} />
        </div>
        <div className="w-44">
          <CustomSelect value={kind} onChange={(v) => setKind(String(v))} options={[{ value: "", label: "All kinds" }, ...VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))]} />
        </div>
        {!status && (
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include accepted and cancelled
          </label>
        )}
        {canPlan && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={`${secondaryButton} inline-flex items-center gap-1`} disabled={generate.isPending} onClick={() => generate.mutate({})}>
              <Sparkles className="w-3.5 h-3.5" /> Generate from plan
            </button>
            <button type="button" className={`${primaryButton} inline-flex items-center gap-1`} onClick={() => setCreating(true)}>
              <CalendarPlus className="w-3.5 h-3.5" /> New visit
            </button>
          </div>
        )}
      </div>

      {q.data && <WarningsList warnings={q.data.warnings} />}

      {canPlan && proposed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <span>
            {proposed.length} proposed visit(s) not yet sent to officers{checked.length ? ` · ${checked.length} selected` : ""}.
          </span>
          <button
            type="button"
            className={`${primaryButton} inline-flex items-center gap-1`}
            disabled={publish.isPending || checked.length === 0}
            onClick={() => publish.mutate(checked, { onSuccess: () => setChecked([]) })}
          >
            <Send className="w-3.5 h-3.5" /> Publish selected
          </button>
          <button type="button" className={secondaryButton} onClick={() => setChecked(proposed.filter((v) => v.assignees.length > 0).map((v) => v.id))}>
            Select all with an officer
          </button>
        </div>
      )}

      {q.isLoading ? (
        <Loader />
      ) : visits.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">No visits match.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visits.map((v) => (
            <VisitRow
              key={v.id}
              visit={v}
              selected={v.id === selectedId}
              onSelect={() => onSelect(v.id)}
              checkable={canPlan && v.status === "PROPOSED"}
              checked={checked.includes(v.id)}
              onCheck={(on) => setChecked((c) => (on ? [...c, v.id] : c.filter((x) => x !== v.id)))}
            />
          ))}
        </ul>
      )}
      {creating && <CreateVisitDialog projectId={projectId} onClose={() => setCreating(false)} />}
    </section>
  );
}

function VisitRow({
  visit: v,
  selected,
  onSelect,
  checkable,
  checked,
  onCheck,
}: {
  visit: VisitDto;
  selected: boolean;
  onSelect: () => void;
  checkable: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
}) {
  return (
    <li className={`flex items-start gap-2 px-2 py-3 rounded-lg hover:bg-slate-50 ${selected ? "bg-brand-primary/5" : ""}`}>
      {checkable && <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label="Select to publish" />}
      <button type="button" onClick={onSelect} className="flex-1 text-left">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-900">
            {v.plannedDate} · {visitKindLabel(v.visitKind)}
          </span>
          <span className="flex items-center gap-2">
            <ConfirmationText visit={v} />
            <VisitStatusChip status={v.status} />
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {officersText(v)}
          {v.sprint ? ` · ${v.sprint.name}` : ""}
          {v.facilityCount ? ` · ${v.facilityCount} facilit${v.facilityCount === 1 ? "y" : "ies"}` : ""}
          {v.recheckCount ? ` · ${v.recheckCount} re-check(s)` : ""}
          {v.pendingProposal ? ` · proposed ${v.pendingProposal.toDate}` : ""}
          {v.isLate ? " · late" : ""}
          {v.origin === "UNSCHEDULED" ? " · unscheduled" : ""}
        </p>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function FindingCard({ projectId, finding: f }: { projectId: string; finding: InspectionFindingDto }) {
  const resolve = useResolveProjectFindingMutation(projectId);
  const dismiss = useDismissProjectFindingMutation(projectId);
  const [notes, setNotes] = useState("");
  const where = [f.facilityName, f.unitLabel].filter(Boolean).join(" · ");
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{f.title}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            f.status === "OPEN" ? (f.severity === "MINOR" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700") : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {f.status === "OPEN" ? f.severity.toLowerCase() : f.status.toLowerCase()}
        </span>
      </div>
      <p className="text-slate-700">{f.description}</p>
      <p className="text-[11px] text-slate-500">
        {where ? `${where} · ` : ""}
        {f.visitKind ? visitKindLabel(f.visitKind) : "Visit"} of {f.inspectionVisitDate} · {f.contractorName ?? "Monitoring side"}
        {f.recheckCount ? ` · re-checked ${f.recheckCount} time(s)` : ""}
        {f.escalatedAt ? " · escalated" : ""}
      </p>
      {f.resolvedNotes && (
        <p className="text-[11px] text-slate-600">
          {f.status === "DISMISSED" ? "Dismissed" : "Resolved"} by {f.resolvedByName}: {f.resolvedNotes}
        </p>
      )}
      {f.resolutionCaptures.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {f.resolutionCaptures.map((c) => (c.objectKey ? <CapturePhoto key={c.id} projectId={projectId} objectKey={c.objectKey} alt="Fix" className="w-16 h-16" /> : null))}
        </div>
      )}
      {(f.canResolve || f.canDismiss) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input className="flex-1 min-w-[10rem] rounded-xl border border-slate-300 px-3 py-1.5 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done, or why it is dismissed" aria-label="Notes" />
          {f.canResolve && (
            <button type="button" disabled={resolve.isPending || notes.trim().length < 5} onClick={() => resolve.mutate({ findingId: f.id, notes: notes.trim() })} className={primaryButton}>
              Resolve
            </button>
          )}
          {f.canDismiss && (
            <button type="button" disabled={dismiss.isPending || notes.trim().length < 5} onClick={() => dismiss.mutate({ findingId: f.id, body: { reason: notes.trim() } })} className={secondaryButton}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FindingsTab({ projectId }: { projectId: string }) {
  const q = useProjectFindingsQuery(projectId);
  if (q.isLoading) return <Loader />;
  const findings = q.data ?? [];
  const columns = [
    { key: "OPEN", title: "Open" },
    { key: "RESOLVED", title: "Resolved" },
    { key: "DISMISSED", title: "Dismissed" },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {columns.map((c) => {
        const inColumn = findings.filter((f) => f.status === c.key);
        return (
          <section key={c.key} className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm space-y-2">
            <h2 className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" /> {c.title} ({inColumn.length})
            </h2>
            {inColumn.length === 0 ? <p className="text-[11px] text-slate-400">None</p> : inColumn.map((f) => <FindingCard key={f.id} projectId={projectId} finding={f} />)}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site log
// ---------------------------------------------------------------------------

function SiteLogTab({ projectId }: { projectId: string }) {
  const q = useSiteLogQuery(projectId);
  if (q.isLoading) return <Loader />;
  const entries = q.data ?? [];
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm space-y-3">
      <p className="text-xs text-slate-500">Photos, voice notes and notes officers took on site outside a form. Entries attached to a visit show on that visit too.</p>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">Nothing in the site log yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={e.id} className="py-3 flex gap-3">
              {e.capture?.objectKey &&
                (e.kind === "VOICE" ? (
                  <CaptureAudio projectId={projectId} objectKey={e.capture.objectKey} />
                ) : (
                  <CapturePhoto projectId={projectId} objectKey={e.capture.objectKey} alt="Site log" className="w-16 h-16" />
                ))}
              <div className="text-xs">
                <p className="font-semibold text-slate-900">
                  {e.authorName} · {new Date(e.capturedAt).toLocaleString()}
                </p>
                {e.text && <p className="text-slate-700">{e.text}</p>}
                {e.capture?.transcript && <p className="text-slate-600 italic">“{e.capture.transcript}”</p>}
                <p className="text-[11px] text-slate-500">
                  {e.kind.toLowerCase()}
                  {e.geofenceStatus ? ` · ${e.geofenceStatus.toLowerCase().replace("_", " ")}` : ""}
                  {e.attachedSubmissionId ? " · attached to a visit" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
