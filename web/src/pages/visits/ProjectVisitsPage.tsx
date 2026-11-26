import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useSearchParams } from "react-router-dom";
import { CalendarPlus, ClipboardList, Send, Sparkles } from "lucide-react";
import { VISIT_KIND_META, VISIT_STATUS_LABELS, VisitKindEnum, VisitStatusEnum, type InspectionFindingDto, type ProjectVisitsExportQuery, type VisitDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort, formatDateTimeShort } from "../../lib/formatters";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import Loader from "../../components/Loader";
import { CustomSelect } from "../../components/common";
import { TAB_LIST_CLASS, tabItemClass } from "../../components/common/Tabs";
import { CapturePhoto, CaptureAudio } from "../../components/evidence/CaptureMedia";
import { StandardTable, type TableColumnDef } from "../../components/table";
import { useProjectFindingsQuery, useProjectVisitsQuery, useSiteLogQuery } from "../../queries/visits/useVisitQueries";
import { useDismissProjectFindingMutation, useGenerateVisitsMutation, usePublishVisitsMutation, useResolveProjectFindingMutation } from "../../mutations/visits/useVisitMutations";
import { ExportExcelButton } from "../../components/common/ExportExcelButton";
import { useExportProjectFindingsMutation, useExportProjectVisitsMutation } from "../../mutations/screenExports/useScreenExportMutations";
import { CreateVisitDialog } from "../../components/visits/VisitDialogs";
import { VisitDetailPanel } from "../../components/visits/VisitDetailPanel";
import { ConfirmationText, officersText, primaryButton, secondaryButton, visitKindLabel, WarningsList } from "../../components/visits/visitUi";
import { VisitCalendar } from "../../components/visits/VisitCalendar";
import { officerInitials, useUrlView, useVisitCalendarState } from "../../components/visits/useVisitCalendar";

/**
 * Redesign R4: a project's visits. Plan (proposed, planned and done visits with their officers,
 * warnings, publish, generate, create), the selected visit (history, submissions, review), findings
 * and the site log. Visits are carried out in the field app.
 */

type Tab = "plan" | "findings" | "site-log";

const REPORT_TABS: Array<{ id: "plan" | "findings" | "site-log"; label: string; intro: string }> = [
  { id: "plan", label: "Monitoring visits", intro: "Planned and past monitoring visits and their monitoring reports. Officers confirm or move monitoring visits and submit the form from the field app." },
  { id: "findings", label: "Findings", intro: "Problems raised by monitoring reports, followed until the contractor corrects them and a monitoring visit confirms it." },
  { id: "site-log", label: "Site log", intro: "Photos, voice notes and notes officers record on site outside a monitoring visit." },
];

const PLAN_VIEWS = ["list", "calendar"] as const;

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
  // Client demo updates D4: the visit plan as a list (default) or a read-only calendar (`?view=calendar`).
  const [view, setView] = useUrlView(PLAN_VIEWS, "list");
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Below xl the panel sits under the calendar: bring it into view when a visit is opened.
    if (view === "calendar" && selectedId) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [view, selectedId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Monitoring" className={TAB_LIST_CLASS}>
          {REPORT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParam("tab", t.id === "plan" ? null : t.id)}
              className={`${tabItemClass(tab === t.id)} text-sm`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "plan" && (
          <div role="group" aria-label="Monitoring plan view" className={TAB_LIST_CLASS}>
            {PLAN_VIEWS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={tabItemClass(view === v)}>
                {v === "list" ? "List" : "Calendar"}
              </button>
            ))}
          </div>
        )}
        <p className="w-full text-sm text-slate-600">{REPORT_TABS.find((t) => t.id === tab)!.intro}</p>
      </div>

      {tab === "findings" ? (
        <FindingsTab projectId={project.id} />
      ) : tab === "site-log" ? (
        <SiteLogTab projectId={project.id} />
      ) : view === "calendar" ? (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className={selectedId ? "xl:col-span-3" : "xl:col-span-5"}>
            <PlanCalendar projectId={project.id} selectedId={selectedId} onSelect={(id) => setParam("visitId", id)} />
          </div>
          {selectedId && (
            <div ref={panelRef} className="xl:col-span-2 scroll-mt-4">
              <VisitDetailPanel projectId={project.id} visitId={selectedId} onClose={() => setParam("visitId", null)} />
            </div>
          )}
        </div>
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

type DotTone = "muted" | "info" | "pending" | "good" | "bad";
const DOT_CLASS: Record<DotTone, string> = {
  muted: "bg-slate-400",
  info: "bg-sky-500",
  pending: "bg-amber-500",
  good: "bg-emerald-600",
  bad: "bg-rose-600",
};
const VISIT_STATUS_TONE: Record<VisitDto["status"], DotTone> = {
  PROPOSED: "muted",
  PLANNED: "info",
  IN_PROGRESS: "info",
  SUBMITTED: "pending",
  RETURNED: "pending",
  APPROVED: "good",
  MISSED: "bad",
  CANCELLED: "muted",
};

/** "24 Nov 2026" from YYYY-MM-DD (a calendar date, no zone shift). */
const visitDay = (date: string) => formatDateShort(date);

/** What else is worth knowing about a visit, in one line. */
function visitNotes(v: VisitDto): string {
  return [
    v.sprint ? v.sprint.name : null,
    v.facilityCount ? `${v.facilityCount} facilit${v.facilityCount === 1 ? "y" : "ies"}` : null,
    v.recheckCount ? `${v.recheckCount} follow-up check${v.recheckCount === 1 ? "" : "s"}` : null,
    v.pendingProposal ? `move to ${formatDateShort(v.pendingProposal.toDate)} proposed` : null,
    v.isLate ? "late" : null,
    v.origin === "UNSCHEDULED" ? "unscheduled" : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
  const exportVisits = useExportProjectVisitsMutation(projectId);
  // The file holds what the table shows: "Open visits" leaves out accepted and cancelled ones.
  const exportStatus = status || (showDone ? undefined : VisitStatusEnum.options.filter((s) => s !== "APPROVED" && s !== "CANCELLED").join(","));
  const visits = useMemo(() => {
    const all = q.data?.visits ?? [];
    return showDone || status ? all : all.filter((v) => !["APPROVED", "CANCELLED"].includes(v.status));
  }, [q.data, showDone, status]);
  const proposed = visits.filter((v) => v.status === "PROPOSED");
  const selectable = canPlan && proposed.length > 0;

  const columns: TableColumnDef<VisitDto>[] = [
    ...(selectable
      ? [
          {
            id: "select",
            header: <span className="sr-only">Select to publish</span>,
            width: "w-8",
            cell: (v: VisitDto) =>
              v.status === "PROPOSED" ? (
                <input
                  type="checkbox"
                  checked={checked.includes(v.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setChecked((c) => (on ? [...c, v.id] : c.filter((x) => x !== v.id)));
                  }}
                  aria-label={`Select the ${visitKindLabel(v.visitKind)} of ${visitDay(v.plannedDate)} to publish`}
                />
              ) : null,
          },
        ]
      : []),
    {
      id: "date",
      header: "Date",
      width: "w-28",
      cell: (v) => <span className="whitespace-nowrap font-semibold tabular-nums text-slate-900">{visitDay(v.plannedDate)}</span>,
    },
    {
      id: "visit",
      header: "Monitoring visit",
      cell: (v) => {
        const notes = visitNotes(v);
        return (
          <div className="min-w-0">
            <div className="font-semibold text-slate-900">{visitKindLabel(v.visitKind)}</div>
            {notes && <div className="text-[11px] text-slate-500">{notes}</div>}
          </div>
        );
      },
    },
    { id: "officers", header: "Officers", cell: (v) => <span className="text-slate-700">{officersText(v)}</span> },
    {
      id: "status",
      header: "Status",
      width: "w-36",
      cell: (v) => (
        <div>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-slate-800">
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[VISIT_STATUS_TONE[v.status]]}`} aria-hidden="true" />
            {VISIT_STATUS_LABELS[v.status]}
          </span>
          <div>
            <ConfirmationText visit={v} />
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {q.data && <WarningsList warnings={q.data.warnings} />}

      {selectable && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <span>
            {proposed.length} proposed monitoring visit(s) not yet sent to officers{checked.length ? ` · ${checked.length} selected` : ""}.
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

      {q.isError && <p className="text-xs text-rose-700">The monitoring visits could not be loaded.</p>}

      <StandardTable<VisitDto>
        title="Monitoring visits"
        subtitle={q.data ? `${visits.length} monitoring visit${visits.length === 1 ? "" : "s"}` : undefined}
        headerActions={
          <>
            <ExportExcelButton
              onDark
              pending={exportVisits.isPending}
              onClick={() => exportVisits.mutate({ status: exportStatus, visitKind: (kind || undefined) as ProjectVisitsExportQuery["visitKind"] })}
            />
            {canPlan && (
              <>
                <button
                  type="button"
                  disabled={generate.isPending}
                  onClick={() => generate.mutate({})}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Generate from plan
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
                >
                  <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" /> New monitoring visit
                </button>
              </>
            )}
          </>
        }
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <CustomSelect
                value={status}
                onChange={(v) => setStatus(String(v))}
                options={[{ value: "", label: "Open monitoring visits" }, ...VisitStatusEnum.options.map((st) => ({ value: st, label: VISIT_STATUS_LABELS[st] }))]}
              />
            </div>
            <div className="w-44">
              <CustomSelect
                value={kind}
                onChange={(v) => setKind(String(v))}
                options={[{ value: "", label: "All kinds" }, ...VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))]}
              />
            </div>
            {!status && (
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include accepted and cancelled
              </label>
            )}
          </div>
        }
        columns={columns}
        data={visits}
        keyExtractor={(v) => v.id}
        onRowClick={(v) => onSelect(v.id)}
        selectedId={selectedId}
        loading={q.isLoading}
        minWidth="min-w-[620px]"
        emptyState={{
          title: status || kind ? "No monitoring visits match" : "No monitoring visits yet",
          description:
            status || kind
              ? "Choose another status or kind."
              : canPlan
                ? "Generate the monitoring visits from the plan, or add one with New monitoring visit."
                : "Monitoring visits appear here once they are planned.",
        }}
      />
      {creating && <CreateVisitDialog projectId={projectId} onClose={() => setCreating(false)} />}
    </div>
  );
}

/**
 * Client demo updates D4: the visit plan as a read-only month / week calendar. Loads the shown range
 * (`GET /projects/:id/visits?from&to`, plus status and kind); every status shows unless one is
 * chosen. Clicking a visit opens the same detail panel as the list (`?visitId=`).
 */
function PlanCalendar({ projectId, selectedId, onSelect }: { projectId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const calendar = useVisitCalendarState("month");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const q = useProjectVisitsQuery(projectId, { ...calendar.range, status: status || undefined, visitKind: kind || undefined }, true, true);
  return (
    <div className="space-y-3">
      {q.data && <WarningsList warnings={q.data.warnings} />}
      <VisitCalendar
        state={calendar}
        visits={q.data?.visits ?? []}
        loading={q.isLoading}
        error={q.isError}
        primaryText={(v) => visitKindLabel(v.visitKind)}
        secondaryText={(v) => officerInitials(v)}
        describe={(v) => officersText(v)}
        selectedId={selectedId}
        onOpen={(v) => onSelect(v.id)}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <CustomSelect
                value={status}
                onChange={(v) => setStatus(String(v))}
                ariaLabel="Status"
                options={[{ value: "", label: "All statuses" }, ...VisitStatusEnum.options.map((st) => ({ value: st, label: VISIT_STATUS_LABELS[st] }))]}
              />
            </div>
            <div className="w-44">
              <CustomSelect
                value={kind}
                onChange={(v) => setKind(String(v))}
                ariaLabel="Kind"
                options={[{ value: "", label: "All kinds" }, ...VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))]}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** One note for both actions: what was done (resolve) or why it is dismissed. Both need 5 characters. */
const FindingNotesFormSchema = z.object({
  notes: z.string().trim().min(5, "Say how it was rectified, or why it is dismissed (at least 5 characters)").max(1000, "Too long (at most 1000 characters)"),
});

function FindingCard({ projectId, finding: f }: { projectId: string; finding: InspectionFindingDto }) {
  const resolve = useResolveProjectFindingMutation(projectId);
  const dismiss = useDismissProjectFindingMutation(projectId);
  const form = useZodForm(FindingNotesFormSchema, { defaultValues: { notes: "" } });
  const pending = resolve.isPending || dismiss.isPending;
  const where =[f.facilityName, f.unitLabel].filter(Boolean).join(" · ");
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{f.title}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            f.status === "OPEN" ? (f.severity === "MINOR" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700") : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {f.status === "OPEN" ? f.severity.toLowerCase() : f.status === "RESOLVED" ? "rectified" : f.status.toLowerCase()}
        </span>
      </div>
      <p className="text-slate-700">{f.description}</p>
      <p className="text-[11px] text-slate-500">
        {where ? `${where} · ` : ""}
        {f.visitKind ? visitKindLabel(f.visitKind) : "Monitoring visit"} of {formatDateShort(f.inspectionVisitDate)} · {f.contractorName ?? "Monitoring side"}
        {f.recheckCount ? ` · followed up ${f.recheckCount} time(s)` : ""}
        {f.escalatedAt ? " · escalated" : ""}
      </p>
      {f.resolvedNotes && (
        <p className="text-[11px] text-slate-600">
          {f.status === "DISMISSED" ? "Dismissed" : "Rectified"} by {f.resolvedByName}: {f.resolvedNotes}
        </p>
      )}
      {f.resolutionCaptures.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {f.resolutionCaptures.map((c) => (c.objectKey ? <CapturePhoto key={c.id} projectId={projectId} objectKey={c.objectKey} alt="Fix" className="w-16 h-16" /> : null))}
        </div>
      )}
      {(f.canResolve || f.canDismiss) && (
        <form
          className="flex flex-wrap items-start gap-2 pt-1"
          noValidate
          onSubmit={form.handleSubmit((v) => (f.canResolve ? resolve.mutate({ findingId: f.id, notes: v.notes }) : dismiss.mutate({ findingId: f.id, body: { reason: v.notes } })))}
        >
          <span className="flex-1 min-w-[10rem]">
            <input
              className={`w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs ${invalidClass(form, "notes")}`}
              placeholder="How it was rectified, or why it is dismissed"
              aria-label="Notes"
              {...form.register("notes")}
              {...fieldA11y(form, "notes")}
            />
            <FieldError form={form} name="notes" />
          </span>
          {f.canResolve && (
            <SubmitButton form={form} pending={pending} showHint={false} className={primaryButton}>
              Mark rectified
            </SubmitButton>
          )}
          {f.canDismiss && (
            <SubmitButton
              form={form}
              pending={pending}
              showHint={false}
              type="button"
              onClick={form.handleSubmit((v) => dismiss.mutate({ findingId: f.id, body: { reason: v.notes } }))}
              className={secondaryButton}
            >
              Dismiss
            </SubmitButton>
          )}
        </form>
      )}
    </div>
  );
}

function FindingsTab({ projectId }: { projectId: string }) {
  const q = useProjectFindingsQuery(projectId);
  const exportFindings = useExportProjectFindingsMutation(projectId);
  if (q.isLoading) return <Loader />;
  const findings = q.data ?? [];
  const columns = [
    { key: "OPEN", title: "Open" },
    { key: "RESOLVED", title: "Rectified" },
    { key: "DISMISSED", title: "Dismissed" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ExportExcelButton pending={exportFindings.isPending} onClick={() => exportFindings.mutate({})} />
      </div>
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
      <p className="text-xs text-slate-500">Entries attached to a monitoring visit show on that monitoring visit too.</p>
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
                  {e.authorName} · {formatDateTimeShort(e.capturedAt)}
                </p>
                {e.text && <p className="text-slate-700">{e.text}</p>}
                {e.capture?.transcript && <p className="text-slate-600 italic">“{e.capture.transcript}”</p>}
                <p className="text-[11px] text-slate-500">
                  {e.kind.toLowerCase()}
                  {e.geofenceStatus ? ` · ${e.geofenceStatus.toLowerCase().replace("_", " ")}` : ""}
                  {e.attachedSubmissionId ? " · attached to a monitoring visit" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
