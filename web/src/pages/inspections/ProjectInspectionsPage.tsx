import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, X } from "lucide-react";
import {
  allChecklistItems,
  INSPECTION_OVERALL_FINDING_LABELS,
  INSPECTION_VISIT_TYPE_LABELS,
  InspectionOverallFindingEnum,
  InspectionVisitTypeEnum,
  type InspectionFindingDto,
  type SiteInspectionDto,
  type SiteInspectionSummaryDto,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { useFindingsQuery, useInspectionQuery, useInspectionsQuery } from "../../queries/inspections/useInspectionQueries";
import {
  useDismissFindingMutation,
  useRaiseFindingMutation,
  useResolveFindingMutation,
  useReviewInspectionMutation,
} from "../../mutations/inspections/useInspectionMutations";
import { InspectionOverviewCard } from "../../components/inspections/InspectionOverviewCard";
import { CapturePhoto } from "../../components/evidence/CaptureMedia";
import { CustomSelect } from "../../components/common";
import Loader from "../../components/Loader";

/**
 * Phase 14: a project's site inspections (list, detail with answers and photos per item, review
 * on the report approval chain) and its findings board. Inspections are carried out in the field
 * app; failed items reach the contractor as findings.
 */

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  RETURNED: "Returned",
};
const FINDING_TONE: Record<string, string> = {
  SATISFACTORY: "bg-emerald-50 text-emerald-700",
  MINOR_ISSUES: "bg-amber-50 text-amber-800",
  MAJOR_ISSUES: "bg-red-50 text-red-700",
};

function answerText(value: string | number | null, unit?: string | null): string {
  if (value === null) return "—";
  if (value === "PASS") return "Pass";
  if (value === "FAIL") return "Fail";
  if (value === "NA") return "Not applicable";
  if (value === "YES") return "Yes";
  if (value === "NO") return "No";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

export function ProjectInspectionsPage({ project }: { project: ProjectSummaryDto }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "findings" ? "findings" : "inspections";
  const selectedId = params.get("inspectionId");
  const [visitType, setVisitType] = useState("");
  const [finding, setFinding] = useState("");
  const [late, setLate] = useState(false);
  const [openFindings, setOpenFindings] = useState(false);
  const list = useInspectionsQuery(project.id, { visitType: visitType || undefined, overallFinding: finding || undefined, late, openFindings }, tab === "inspections");

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Inspections</h1>
          <p className="text-xs text-slate-500">Site visits from a checklist, carried out in the field app. Failed items reach the contractor as findings.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold" role="tablist">
          {(["inspections", "findings"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setParam("tab", t === "inspections" ? null : t)}
              className={`rounded-lg px-3 py-1.5 ${tab === t ? "bg-white text-brand-primary shadow-xs" : "text-slate-600"}`}
            >
              {t === "inspections" ? "Inspections" : "Findings"}
            </button>
          ))}
        </div>
      </div>

      <InspectionOverviewCard projectId={project.id} compact />

      {tab === "findings" ? (
        <FindingsBoard projectId={project.id} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <section className={`bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm space-y-3 ${selectedId ? "xl:col-span-2" : "xl:col-span-5"}`}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-48">
                <CustomSelect
                  value={visitType}
                  onChange={(v) => setVisitType(String(v))}
                  options={[{ value: "", label: "All visit types" }, ...InspectionVisitTypeEnum.options.map((v) => ({ value: v, label: INSPECTION_VISIT_TYPE_LABELS[v] }))]}
                />
              </div>
              <div className="w-44">
                <CustomSelect
                  value={finding}
                  onChange={(v) => setFinding(String(v))}
                  options={[{ value: "", label: "Any finding" }, ...InspectionOverallFindingEnum.options.map((f) => ({ value: f, label: INSPECTION_OVERALL_FINDING_LABELS[f] }))]}
                />
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> Late only
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={openFindings} onChange={(e) => setOpenFindings(e.target.checked)} /> With open findings
              </label>
            </div>
            {list.isLoading ? (
              <Loader />
            ) : (list.data ?? []).length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No inspections match.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(list.data ?? []).map((i) => (
                  <InspectionRow key={i.id} inspection={i} selected={i.id === selectedId} onSelect={() => setParam("inspectionId", i.id)} />
                ))}
              </ul>
            )}
          </section>
          {selectedId && (
            <div className="xl:col-span-3">
              <InspectionDetail projectId={project.id} inspectionId={selectedId} onClose={() => setParam("inspectionId", null)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InspectionRow({ inspection: i, selected, onSelect }: { inspection: SiteInspectionSummaryDto; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" onClick={onSelect} className={`w-full text-left px-2 py-3 rounded-lg hover:bg-slate-50 ${selected ? "bg-brand-primary/5" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-900">
            {INSPECTION_VISIT_TYPE_LABELS[i.visitType]} · {i.visitDate}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${FINDING_TONE[i.overallFinding]}`}>{INSPECTION_OVERALL_FINDING_LABELS[i.overallFinding]}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {i.reporterName} ({i.reporterRoleName}) · {STATUS_LABEL[i.status]}
          {i.isLate ? ` · late (deadline ${i.submissionDeadline})` : ""}
          {i.streamLabel ? ` · ${i.streamLabel}` : ""} · {i.photoCount} photo(s)
          {i.failedItemCount ? ` · ${i.failedItemCount} failed` : ""}
          {i.openFindingCount ? ` · ${i.openFindingCount} open finding(s)` : ""}
        </p>
      </button>
    </li>
  );
}

function InspectionDetail({ projectId, inspectionId, onClose }: { projectId: string; inspectionId: string; onClose: () => void }) {
  const q = useInspectionQuery(projectId, inspectionId);
  const review = useReviewInspectionMutation(projectId);
  const raise = useRaiseFindingMutation(projectId);
  const { hasPermission } = useAuth();
  const [returnNotes, setReturnNotes] = useState("");
  if (q.isLoading) return <Loader />;
  if (!q.data) return null;
  const r: SiteInspectionDto = q.data;
  const answers = new Map(r.answers.map((a) => [a.itemKey, a]));
  const items = new Map(allChecklistItems(r.sections).map((i) => [i.key, i]));
  const flagged = new Set(r.aiFlags.map((f) => f.itemKey));
  const canRaise = hasPermission("inspections:manage_findings");

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            {INSPECTION_VISIT_TYPE_LABELS[r.visitType]} · {r.visitDate}
          </h2>
          <p className="text-[11px] text-slate-500">
            {r.templateName} v{r.templateVersion} · {r.reporterName} ({r.reporterRoleName}) · {STATUS_LABEL[r.status]}
            {r.geofenceStatus ? ` · location ${r.geofenceStatus.toLowerCase().replace("_", " ")}` : " · no location"}
            {r.isLate ? ` · uploaded late (deadline ${r.submissionDeadline})` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className={`rounded-xl px-3 py-2 text-xs ${FINDING_TONE[r.overallFinding]}`}>
        <span className="font-semibold">{INSPECTION_OVERALL_FINDING_LABELS[r.overallFinding]}.</span> {r.summaryText}
      </div>
      {r.returnedNotes && r.status === "RETURNED" && <p className="text-xs text-red-700">Returned: {r.returnedNotes}</p>}
      {r.aiFlags.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Omission check ({r.aiCheckEngine ?? "rules"})
          </p>
          <ul className="mt-1 list-disc pl-5">
            {r.aiFlags.map((f) => (
              <li key={f.itemKey}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}

      {r.sections.map((s) => (
        <div key={s.key} className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{s.title}</h3>
          {s.items.map((item) => {
            const a = answers.get(item.key);
            const hasFinding = r.findings.some((f) => f.checklistItemKey === item.key);
            return (
              <div key={item.key} className={`rounded-xl border p-3 ${a?.failed ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-800">{item.label}</p>
                  <p className={`text-xs font-bold ${a?.failed ? "text-red-700" : "text-slate-900"}`}>
                    {item.responseType === "PHOTO_ONLY" ? "" : answerText(a?.value ?? null, items.get(item.key)?.unit)}
                  </p>
                </div>
                {a?.comment && <p className="mt-1 text-[11px] text-slate-600">{a.comment}</p>}
                {flagged.has(item.key) && <p className="mt-1 text-[11px] font-semibold text-amber-700">Needs a photo</p>}
                {a && a.captures.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {a.captures.map((c) =>
                      c.objectKey ? <CapturePhoto key={c.id} projectId={projectId} objectKey={c.objectKey} alt={item.label} className="w-20 h-20" /> : null
                    )}
                  </div>
                )}
                {a?.failed && canRaise && !hasFinding && (
                  <button
                    type="button"
                    disabled={raise.isPending}
                    onClick={() =>
                      raise.mutate({
                        inspectionId: r.id,
                        body: { checklistItemKey: item.key, projectContractorId: null, description: a.comment || `${item.label} failed`, severity: "MAJOR" },
                      })
                    }
                    className="mt-2 text-[11px] font-semibold text-brand-primary hover:underline"
                  >
                    Raise a finding
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {r.findings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Findings</h3>
          {r.findings.map((f) => (
            <FindingCard key={f.id} projectId={projectId} finding={f} />
          ))}
        </div>
      )}

      {r.approval && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <h3 className="text-xs font-bold text-slate-900">Approval</h3>
          <ol className="text-[11px] text-slate-600 space-y-0.5">
            {r.approval.steps.map((s) => (
              <li key={s.id}>
                {s.stepOrder}. {s.label} · {s.state.toLowerCase()}
              </li>
            ))}
          </ol>
          {r.approval.canAct ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate({ inspectionId: r.id, body: { decision: "APPROVE" } })}
                className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </button>
              <input
                className="flex-1 min-w-[12rem] rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="What the inspector must change"
                aria-label="Return notes"
              />
              <button
                type="button"
                disabled={review.isPending || returnNotes.trim().length < 5}
                onClick={() => review.mutate({ inspectionId: r.id, body: { decision: "RETURN", notes: returnNotes.trim() } })}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                Return
              </button>
            </div>
          ) : (
            r.approval.cannotActReason && r.status === "PENDING_APPROVAL" && <p className="text-[11px] text-slate-500">{r.approval.cannotActReason}</p>
          )}
        </div>
      )}
    </section>
  );
}

function FindingCard({ projectId, finding: f }: { projectId: string; finding: InspectionFindingDto }) {
  const resolve = useResolveFindingMutation(projectId);
  const dismiss = useDismissFindingMutation(projectId);
  const [notes, setNotes] = useState("");
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{f.checklistItemLabel}</span>
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
        {INSPECTION_VISIT_TYPE_LABELS[f.inspectionVisitType]} of {f.inspectionVisitDate} · {f.contractorName ?? "Monitoring side"}
        {f.raisedByName ? ` · raised by ${f.raisedByName}` : ""}
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
            <button
              type="button"
              disabled={resolve.isPending || notes.trim().length < 5}
              onClick={() => resolve.mutate({ findingId: f.id, notes: notes.trim() })}
              className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Resolve
            </button>
          )}
          {f.canDismiss && (
            <button
              type="button"
              disabled={dismiss.isPending || notes.trim().length < 5}
              onClick={() => dismiss.mutate({ findingId: f.id, body: { reason: notes.trim() } })}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FindingsBoard({ projectId }: { projectId: string }) {
  const q = useFindingsQuery(projectId);
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
