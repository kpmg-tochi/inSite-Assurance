import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, Circle, Flag, Users } from "lucide-react";
import { MILESTONE_COMPLETION_MODE_META, type ContractMilestoneDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { formatDateTimeShort } from "../../lib/formatters";
import { useMilestonesQuery } from "../../queries/contracts/useContractQueries";
import { useCompleteMilestoneMutation, useWaiveMilestoneMutation } from "../../mutations/contracts/useContractMutations";
import { KpiCard } from "../../components/common";
import Loader from "../../components/Loader";
import { MobilisationCompliancePanel } from "../../components/contracts/MobilisationCompliancePanel";
import { DefaultCasesPanel, RaiseDefaultCaseDialog } from "../../components/contracts/DefaultCasesPanel";
import { DefaultCaseModal } from "../../components/contracts/DefaultCaseModal";
import {
  DaysLeft,
  DEFAULT_CASE_VIEW_PERMISSIONS,
  MILESTONE_STATUS_META,
  primaryButton,
  secondaryButton,
  sectionClass,
  smallInput,
  StatusChip,
} from "../../components/contracts/contractUi";

/**
 * Phase 13: the project's contract milestones as an ordered checklist (anchor, due date, days left,
 * evidence and actions), contractor mobilisation compliance and default cases.
 */
export function ProjectMilestonesPage({ project }: { project: ProjectSummaryDto }) {
  const { hasAnyPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const caseId = params.get("case");
  const q = useMilestonesQuery(project.id);
  const [contractorFilter, setContractorFilter] = useState<string>("");
  const canSeeCases = hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS);

  const setCase = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("case", id);
    else next.delete("case");
    setParams(next, { replace: true });
  };

  const data = q.data;
  const contractors = Array.from(
    new Map((data?.milestones ?? []).filter((m) => m.projectContractorId).map((m) => [m.projectContractorId!, m.contractorName ?? "Contractor"])).entries()
  );
  const milestones = [...(data?.milestones ?? [])]
    .filter((m) => !contractorFilter || m.projectContractorId === null || m.projectContractorId === contractorFilter)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Milestones</h1>
          <p className="text-xs text-slate-500">
            Obligations between contract award and the contractor working on site, dated from the contract and kick-off dates.
          </p>
        </div>
        <Link to={`/app/projects/${project.id}/kickoff`} className={secondaryButton}>
          <Users className="w-3.5 h-3.5" /> Kick-off meeting
        </Link>
      </div>

      {q.isLoading ? (
        <Loader />
      ) : q.isError || !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          Could not load the milestones. {(q.error as Error | null)?.message}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <KpiCard title="Milestones" icon={<Flag className="h-4 w-4" />} value={data.summary.total} subtitle={`${data.summary.done} done or waived`} />
            <KpiCard
              title="Overdue"
              icon={<CalendarClock className="h-4 w-4" />}
              iconVariant={data.summary.overdue > 0 ? "rose" : "emerald"}
              value={<span className={data.summary.overdue > 0 ? "text-rose-700" : ""}>{data.summary.overdue}</span>}
              subtitle="Past their due date"
            />
            <KpiCard title="Due within 7 days" icon={<CalendarClock className="h-4 w-4" />} iconVariant="slate" value={data.summary.dueSoon} subtitle={`Today is ${data.today}`} />
            <KpiCard
              title="Anchor dates"
              icon={<CalendarClock className="h-4 w-4" />}
              iconVariant="slate"
              value={<span className="text-sm tabular-nums">{data.anchors.kickoffDate ?? "Kick-off not set"}</span>}
              subtitle={
                <span>
                  Award {data.anchors.contractAwardDate ?? "–"} · signed {data.anchors.contractSignedDate ?? "–"} · activation{" "}
                  {data.anchors.activationDate ?? "–"}
                </span>
              }
            />
          </div>

          <section className={sectionClass} aria-label="Milestone checklist">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">Checklist</h2>
              {contractors.length > 1 && (
                <select className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs" value={contractorFilter} onChange={(e) => setContractorFilter(e.target.value)} aria-label="Contractor">
                  <option value="">All contractors</option>
                  {contractors.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {milestones.length === 0 ? (
              <p className="text-xs text-slate-500">
                No contract milestones. They are created from the project type when it is applied; projects without a type have none.
              </p>
            ) : (
              <ol className="space-y-2">
                {milestones.map((m) => (
                  <MilestoneRow key={m.id} projectId={project.id} m={m} onOpenCase={setCase} />
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      <MobilisationCompliancePanel projectId={project.id} />
      {canSeeCases && <DefaultCasesPanel projectId={project.id} onOpenCase={setCase} />}
      {caseId && <DefaultCaseModal projectId={project.id} caseId={caseId} onClose={() => setCase(null)} />}
    </div>
  );
}

function MilestoneRow({ projectId, m, onOpenCase }: { projectId: string; m: ContractMilestoneDto; onOpenCase: (id: string) => void }) {
  const { hasPermission } = useAuth();
  const complete = useCompleteMilestoneMutation(projectId);
  const waive = useWaiveMilestoneMutation(projectId);
  const [mode, setMode] = useState<"idle" | "complete" | "waive" | "raise">("idle");
  const [text, setText] = useState("");
  const closed = m.status === "DONE" || m.status === "WAIVED";
  const manual = m.completionMode === "MANUAL";
  const canComplete = !closed && manual && hasPermission("milestones:manage");
  const canWaive = !closed && hasPermission("milestones:waive");
  const canRaise = !closed && m.status === "OVERDUE" && Boolean(m.projectContractorId) && !m.openDefaultCaseId && hasPermission("contracts:raise_default");
  const s = MILESTONE_STATUS_META[m.status];

  return (
    <li className={`rounded-xl border p-3 ${m.status === "OVERDUE" ? "border-rose-200 bg-rose-50/30" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          {closed ? <CheckCircle2 className="mt-0.5 w-4 h-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 w-4 h-4 shrink-0 text-slate-300" />}
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900">
              {m.label}
              {m.contractorName && <span className="font-normal text-slate-500"> · {m.contractorName}</span>}
            </p>
            <p className="text-[11px] text-slate-500">
              {m.anchorLabel}
              {m.dueDate ? ` · due ${m.dueDate}` : " · no date yet"}
              {!manual ? ` · ${MILESTONE_COMPLETION_MODE_META[m.completionMode].label.toLowerCase()} (automatic)` : ""}
              {m.responsibleRoleName ? ` · ${m.responsibleRoleName}` : ""}
            </p>
            {m.description && <p className="text-[11px] text-slate-600">{m.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!closed && <DaysLeft daysLeft={m.daysLeft} />}
          <StatusChip label={s.label} cls={s.cls} />
        </div>
      </div>

      {m.evidence.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5 pl-6">
          {m.evidence.map((e) => {
            const ok = Boolean(e.documentId) && (!e.signOffRequired || e.signed);
            return (
              <li key={e.documentTypeCode}>
                <Link
                  to={e.documentId ? `/app/projects/${projectId}/documents?documentId=${e.documentId}` : `/app/projects/${projectId}/documents?type=${encodeURIComponent(e.documentTypeCode)}`}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] hover:underline ${
                    ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                  title={e.documentTitle ?? "Not in the register yet"}
                >
                  {ok ? "✓" : "○"} {e.documentTypeName}
                  {e.documentId && e.signOffRequired && !e.signed ? " (not signed)" : ""}
                  {!e.documentId ? " (missing)" : ""}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {(m.completedAt || m.waivedReason) && (
        <p className="mt-1.5 pl-6 text-[11px] text-slate-600">
          {m.status === "WAIVED"
            ? `Waived: ${m.waivedReason}`
            : `Done ${m.completedAt ? formatDateTimeShort(m.completedAt) : ""}${m.completedByName ? ` by ${m.completedByName}` : ""}${m.completedNotes ? ` · ${m.completedNotes}` : ""}`}
        </p>
      )}

      {(m.openDefaultCaseId || canComplete || canWaive || canRaise) && mode === "idle" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          {m.openDefaultCaseId && (
            <button type="button" onClick={() => onOpenCase(m.openDefaultCaseId!)} className="text-[11px] font-semibold text-rose-700 hover:underline">
              Open default case
            </button>
          )}
          {canComplete && (
            <button
              type="button"
              className={primaryButton}
              disabled={!m.readyToComplete}
              title={m.readyToComplete ? undefined : "The required documents must be in the register and signed off first."}
              onClick={() => {
                setText("");
                setMode("complete");
              }}
            >
              Complete
            </button>
          )}
          {canWaive && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setText("");
                setMode("waive");
              }}
            >
              Waive
            </button>
          )}
          {canRaise && (
            <button type="button" className={secondaryButton} onClick={() => setMode("raise")}>
              Raise a default case
            </button>
          )}
          {canComplete && !m.readyToComplete && <span className="text-[11px] text-slate-500">Waiting for its documents.</span>}
        </div>
      )}

      {(mode === "complete" || mode === "waive") && (
        <div className="mt-2 space-y-2 pl-6">
          <input
            className={smallInput}
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === "complete" ? "Notes (optional)" : "Why the milestone is waived (required)"}
            aria-label={mode === "complete" ? "Notes" : "Reason"}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={complete.isPending || waive.isPending || (mode === "waive" && text.trim().length < 5)}
              onClick={() =>
                mode === "complete"
                  ? complete.mutate({ milestoneId: m.id, notes: text.trim() || null }, { onSuccess: () => setMode("idle") })
                  : waive.mutate({ milestoneId: m.id, reason: text.trim() }, { onSuccess: () => setMode("idle") })
              }
            >
              {mode === "complete" ? "Mark complete" : "Waive milestone"}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "raise" && (
        <RaiseDefaultCaseDialog
          projectId={projectId}
          defaultContractorId={m.projectContractorId ?? undefined}
          defaultMilestoneId={m.id}
          onClose={() => setMode("idle")}
          onRaised={onOpenCase}
        />
      )}
    </li>
  );
}
