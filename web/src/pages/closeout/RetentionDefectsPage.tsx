import React, { useMemo, useState } from "react";
import { CalendarClock, Landmark, Plus, ShieldCheck, Wallet } from "lucide-react";
import {
  DEFECT_STATUS_LABELS,
  type DefectSeverity,
  type DefectStatus,
  type DefectTicketDto,
  type LenderDecisionType,
  type RetentionContractorBalanceDto,
  type RetentionReleaseRequestDto,
  type RetentionReleaseStageValue,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth, useTerm } from "../../lib/auth-context";
import { formatNaira } from "../../lib/formatters";
import Loader from "../../components/Loader";
import { CustomSelect, KpiCard } from "../../components/common";
import { TableBadge } from "../../components/table/StandardTable";
import { CapturePhoto } from "../../components/evidence/CaptureMedia";
import { BlockedNotice, ModalActions, ModalShell, inputClass } from "../reconciliation/components/ModalShell";
import {
  CertifierRegistrationBox,
  signatureRegistrationSuffix,
  useCertifierRegistration,
} from "../../components/credentials/CertifierRegistration";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useDefectTicketsQuery, useRetentionSummaryQuery } from "../../queries/closeout/useCloseoutQueries";
import {
  useCancelRetentionReleaseMutation,
  useCertifyRetentionReleaseMutation,
  useCreateDefectTicketMutation,
  useDecideRetentionReleaseMutation,
  useDefectActionMutation,
  useRequestRetentionReleaseMutation,
} from "../../mutations/closeout/useCloseoutMutations";
import { useReviewValuationMutation } from "../../mutations/reconciliation/useReconciliationMutations";

const STAGE_LABEL: Record<RetentionReleaseStageValue, string> = {
  COMPLETION: "At practical completion",
  FINAL: "Final release",
};

const OUTCOME_BADGE: Record<RetentionReleaseRequestDto["outcome"], { variant: "success" | "warning" | "danger" | "neutral" | "info"; label: string }> = {
  AWAITING_CERTIFICATION: { variant: "warning", label: "Awaiting certification" },
  IN_APPROVAL: { variant: "info", label: "In approval" },
  RELEASED: { variant: "success", label: "Released" },
  HELD: { variant: "neutral", label: "Held" },
  RETURNED: { variant: "danger", label: "Returned" },
  CANCELLED: { variant: "neutral", label: "Cancelled" },
};

const BOARD: DefectStatus[] = ["OPEN", "ASSIGNED", "RECTIFIED_PENDING_VERIFICATION", "VERIFIED_CLOSED", "REJECTED_NOT_A_DEFECT"];
const SEVERITY_BADGE: Record<DefectSeverity, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

/**
 * Project "Retention and defects" tab (Phase 10 Step 8): held, released and remaining retention
 * per contractor, the liability-period countdown, release requests through the disbursement chain
 * (with the unmet preconditions listed when a release is not possible yet), and the defect board.
 */
export function RetentionDefectsPage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const term = useTerm();
  const processQuery = useProjectProcess(project.id);
  const enabled = processQuery.data?.config.enableRetentionModule ?? false;
  const canSeeMoney = [
    "retention:manage_defects",
    "retention:release_escrow",
    "ipc:certify_valuation",
    "tranche:approve_disbursement",
    "audit:view_ledger",
  ].some((k) => hasPermission(k));
  const summaryQuery = useRetentionSummaryQuery(project.id, enabled && canSeeMoney);
  const ticketsQuery = useDefectTicketsQuery(project.id, enabled);

  if (processQuery.isLoading) return <Loader />;
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
        {term("retention")} and defects are not used on this project.
      </div>
    );
  }
  const s = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-900">{term("retention")} and defects</h1>
        <p className="text-xs text-slate-500">
          {project.codePrefix}
          {s?.retentionPercentage ? ` · ${s.retentionPercentage}% withheld from each release` : ` · no ${term("retention", { lower: true })} percentage set`}
          {s?.retentionDurationMonths ? ` · ${s.retentionDurationMonths}-month defects liability period` : ""}
          {s && s.retentionReleaseAtCompletionPct > 0 ? ` · ${s.retentionReleaseAtCompletionPct}% may be released at practical completion` : ""}
        </p>
      </div>

      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard title={`${term("retention")} held`} value={formatNaira(s.heldNgn)} icon={<Wallet className="h-4 w-4" />} />
            <KpiCard title={`${term("retention")} released`} value={formatNaira(s.releasedNgn)} icon={<Landmark className="h-4 w-4" />} iconVariant="emerald" />
            <KpiCard
              title="Liability period"
              value={
                s.retentionEndDate
                  ? s.daysRemaining !== null && s.daysRemaining >= 0
                    ? `${s.daysRemaining} days left`
                    : "Ended"
                  : "Not started"
              }
              subtitle={s.retentionEndDate ? `${s.retentionStartDate} to ${s.retentionEndDate}` : "Starts at practical completion"}
              icon={<CalendarClock className="h-4 w-4" />}
              iconVariant="amber"
            />
          </div>
          <BalancesSection project={project} contractors={s.contractors} canRequest={s.canRequestRelease} />
          <ReleaseRequests project={project} requests={s.requests} />
        </>
      )}

      <DefectBoard project={project} tickets={ticketsQuery.data ?? []} loading={ticketsQuery.isLoading} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balances and release requests
// ---------------------------------------------------------------------------

function BalancesSection({
  project,
  contractors,
  canRequest,
}: {
  project: ProjectSummaryDto;
  contractors: RetentionContractorBalanceDto[];
  canRequest: boolean;
}) {
  const term = useTerm();
  const [requesting, setRequesting] = useState<{ contractor: RetentionContractorBalanceDto; stage: RetentionReleaseStageValue } | null>(null);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-900">Per {term("contractor", { lower: true })}</h2>
      </div>
      <div className="divide-y divide-slate-100">
        {contractors.map((c) => (
          <div key={c.projectContractorId} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-[1.5fr_1fr_1fr_1fr_2fr]">
            <div>
              <p className="font-semibold text-slate-900">{c.contractorName}</p>
              <p className="text-[11px] text-slate-500">
                {c.tradeCode}
                {c.isMainContractor ? ` · main ${term("contractor", { lower: true })}` : ""} · {c.openTicketCount} open defect(s)
              </p>
            </div>
            <Amount label="Held" value={c.heldNgn} />
            <Amount label="Released" value={c.releasedNgn} />
            <Amount label="Pending release" value={c.pendingReleaseNgn} />
            <div className="space-y-2">
              {c.stages.map((stage) => (
                <div key={stage.stage} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-700">{STAGE_LABEL[stage.stage]}</p>
                    {stage.allowed ? (
                      <p className="text-[11px] text-slate-500">Up to {formatNaira(stage.maxAmountNgn)}</p>
                    ) : (
                      <ul className="list-disc pl-4 text-[11px] text-slate-500">
                        {stage.unmet.map((u) => (
                          <li key={u}>{u}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {canRequest && (
                    <button
                      type="button"
                      disabled={!stage.allowed}
                      onClick={() => setRequesting({ contractor: c, stage: stage.stage })}
                      className="shrink-0 rounded-lg bg-brand-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-hover disabled:opacity-40"
                    >
                      Request release
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {requesting && (
        <RequestReleaseModal
          projectId={project.id}
          contractor={requesting.contractor}
          stage={requesting.stage}
          onClose={() => setRequesting(null)}
        />
      )}
    </section>
  );
}

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="font-semibold text-slate-900">{formatNaira(value)}</p>
    </div>
  );
}

function RequestReleaseModal({
  projectId,
  contractor,
  stage,
  onClose,
}: {
  projectId: string;
  contractor: RetentionContractorBalanceDto;
  stage: RetentionReleaseStageValue;
  onClose: () => void;
}) {
  const mutation = useRequestRetentionReleaseMutation(projectId);
  const term = useTerm();
  const max = contractor.stages.find((s) => s.stage === stage)?.maxAmountNgn ?? 0;
  const [amount, setAmount] = useState(String(max));
  const [notes, setNotes] = useState("");
  const value = Number(amount);
  const bad = !(value > 0) || value > max;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({ projectContractorId: contractor.projectContractorId, stage, amountNgn: value, notes: notes.trim() || undefined });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title={`Request ${term("retention", { lower: true })} release`} subtitle={`${contractor.contractorName} · ${STAGE_LABEL[stage]}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        <p className="text-slate-600">
          A certifier certifies the release next; it then follows the project's disbursement approval chain like any other{" "}
          {term("valuation", { lower: true })}.
        </p>
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Amount (NGN), at most {formatNaira(max)}</span>
          <input type="number" min={0.01} max={max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Notes (optional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} maxLength={2000} />
        </label>
        <ModalActions onCancel={onClose} submitLabel="Request release" pendingLabel="Requesting…" isPending={mutation.isPending} disabled={bad} />
      </form>
    </ModalShell>
  );
}

function ReleaseRequests({ project, requests }: { project: ProjectSummaryDto; requests: RetentionReleaseRequestDto[] }) {
  const cancel = useCancelRetentionReleaseMutation(project.id);
  const review = useReviewValuationMutation(project.id);
  const [certifying, setCertifying] = useState<RetentionReleaseRequestDto | null>(null);
  const [deciding, setDeciding] = useState<RetentionReleaseRequestDto | null>(null);
  if (requests.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-900">Release requests</h2>
      </div>
      <ul className="divide-y divide-slate-100">
        {requests.map((r) => {
          const badge = OUTCOME_BADGE[r.outcome];
          const step = r.valuation?.approval?.steps.find((s) => s.stepOrder === r.valuation?.approval?.currentStepOrder);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
              <div className="min-w-[220px] flex-1">
                <p className="font-semibold text-slate-900">
                  {formatNaira(r.amountNgn)} · {r.contractorName}
                </p>
                <p className="text-[11px] text-slate-500">
                  {STAGE_LABEL[r.stage]} · requested by {r.requestedByName ?? "—"} on {new Date(r.requestedAt).toLocaleDateString("en-GB")}
                  {r.valuation ? ` · certified by ${r.valuation.certifierFullName}` : ""}
                  {r.outcome === "IN_APPROVAL" && step ? ` · waiting for "${step.label}"` : ""}
                </p>
              </div>
              <TableBadge variant={badge.variant}>{badge.label}</TableBadge>
              <div className="flex flex-wrap gap-2">
                {r.actions.certify.allowed && (
                  <ActionButton onClick={() => setCertifying(r)} primary>
                    Certify
                  </ActionButton>
                )}
                {r.actions.review.allowed && r.valuation && (
                  <ActionButton onClick={() => review.mutate({ valuationId: r.valuation!.id, decision: "APPROVE", notes: null })}>Approve step</ActionButton>
                )}
                {r.actions.decide.allowed && (
                  <ActionButton onClick={() => setDeciding(r)} primary>
                    Record decision
                  </ActionButton>
                )}
                {r.actions.cancel.allowed && <ActionButton onClick={() => cancel.mutate(r.id)}>Cancel</ActionButton>}
              </div>
            </li>
          );
        })}
      </ul>
      {certifying && <CertifyModal projectId={project.id} request={certifying} onClose={() => setCertifying(null)} />}
      {deciding && <DecideModal projectId={project.id} request={deciding} onClose={() => setDeciding(null)} />}
    </section>
  );
}

function ActionButton({ onClick, children, primary }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "rounded-lg bg-brand-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-hover"
          : "rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
      }
    >
      {children}
    </button>
  );
}

function CertifyModal({ projectId, request, onClose }: { projectId: string; request: RetentionReleaseRequestDto; onClose: () => void }) {
  const mutation = useCertifyRetentionReleaseMutation(projectId);
  const term = useTerm();
  // Phase 12: the project's registration policy decides whether a registration is needed.
  const { blocked: registrationBlocked, registration } = useCertifierRegistration(projectId);
  const [summary, setSummary] = useState("");
  const [ack, setAck] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({ requestId: request.id, body: { executiveCertificationSummary: summary.trim(), certifierDigitalSignatureAck: true } });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };
  return (
    <ModalShell title={`Certify ${term("retention", { lower: true })} release`} subtitle={`${formatNaira(request.amountNgn)} · ${request.contractorName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        <CertifierRegistrationBox projectId={projectId} />
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Certification summary</span>
          <textarea rows={4} required minLength={10} value={summary} onChange={(e) => setSummary(e.target.value)} className={inputClass} maxLength={4000} />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          <span>
            I certify this release{signatureRegistrationSuffix(registration)}. My name
            {registration ? " and registration are" : " is"} recorded on the {term("valuation", { lower: true })}.
          </span>
        </label>
        <ModalActions onCancel={onClose} submitLabel="Certify" pendingLabel="Certifying…" isPending={mutation.isPending} disabled={!ack || summary.trim().length < 10 || registrationBlocked} />
      </form>
    </ModalShell>
  );
}

function DecideModal({ projectId, request, onClose }: { projectId: string; request: RetentionReleaseRequestDto; onClose: () => void }) {
  const mutation = useDecideRetentionReleaseMutation(projectId);
  const term = useTerm();
  const [decision, setDecision] = useState<LenderDecisionType>("APPROVE_FULL");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const value = Number(amount);
  const bad = decision === "APPROVE_WITH_HOLDBACK" && (!(value > 0) || value > request.amountNgn);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({
        valuationId: request.valuation!.id,
        body: {
          decision,
          ...(decision === "APPROVE_WITH_HOLDBACK" ? { approvedDisbursementAmountNgn: value } : {}),
          approverNotes: notes.trim() || undefined,
        },
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };
  return (
    <ModalShell title={`${term("retention")} release decision`} subtitle={`${request.contractorName} · ${STAGE_LABEL[request.stage]}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        <dl className="grid grid-cols-2 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <dt className="text-slate-500">Certified release</dt>
          <dd className="text-right font-bold text-emerald-700">{formatNaira(request.amountNgn)}</dd>
          <dt className="text-slate-500">Certified by</dt>
          <dd className="text-right">{request.valuation?.certifierFullName}</dd>
        </dl>
        <CustomSelect
          label="Decision"
          value={decision}
          onChange={setDecision}
          options={[
            { value: "APPROVE_FULL", label: "Release the certified amount" },
            { value: "APPROVE_WITH_HOLDBACK", label: "Release a lower amount" },
            { value: "HOLD", label: "Hold", description: "Release nothing now" },
          ]}
        />
        {decision === "APPROVE_WITH_HOLDBACK" && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Amount (NGN)</span>
            <input type="number" min={0.01} max={request.amountNgn} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </label>
        )}
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Notes (optional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} maxLength={1500} />
        </label>
        <ModalActions onCancel={onClose} submitLabel="Record decision" pendingLabel="Recording…" isPending={mutation.isPending} disabled={bad} />
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Defect board
// ---------------------------------------------------------------------------

type TicketAction = { ticket: DefectTicketDto; kind: "assign" | "rectify" | "verify" | "reject" };

function DefectBoard({ project, tickets, loading }: { project: ProjectSummaryDto; tickets: DefectTicketDto[]; loading: boolean }) {
  const { hasPermission, user } = useAuth();
  const [raising, setRaising] = useState(false);
  const [acting, setActing] = useState<TicketAction | null>(null);
  const byStatus = useMemo(() => {
    const m = new Map<DefectStatus, DefectTicketDto[]>(BOARD.map((s) => [s, []]));
    for (const t of tickets) m.get(t.status)!.push(t);
    return m;
  }, [tickets]);
  // Same rule as the server: a user whose organisation is a contractor on the project is the liable
  // side and cannot raise defects.
  const isProjectContractor = project.contractors.some((c) => c.organizationId === user?.organizationId);
  const canRaise = hasPermission("retention:manage_defects") && !isProjectContractor;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">Defects</h2>
        {canRaise && (
          <button
            type="button"
            onClick={() => setRaising(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
          >
            <Plus className="h-4 w-4" /> Raise defect
          </button>
        )}
      </div>
      {loading && <Loader />}
      <div className="grid gap-3 lg:grid-cols-5">
        {BOARD.map((status) => (
          <div key={status} className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <p className="px-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {DEFECT_STATUS_LABELS[status]} ({byStatus.get(status)!.length})
            </p>
            <div className="space-y-2">
              {byStatus.get(status)!.map((t) => (
                <TicketCard key={t.id} project={project} ticket={t} onAct={(kind) => setActing({ ticket: t, kind })} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {raising && <RaiseDefectModal project={project} onClose={() => setRaising(false)} />}
      {acting && <TicketActionModal project={project} action={acting} onClose={() => setActing(null)} />}
    </section>
  );
}

function TicketCard({ project, ticket: t, onAct }: { project: ProjectSummaryDto; ticket: DefectTicketDto; onAct: (k: TicketAction["kind"]) => void }) {
  return (
    <article className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px]">
      <div className="flex items-center justify-between gap-1">
        <span className="font-bold text-slate-500">{t.reference}</span>
        <TableBadge variant={SEVERITY_BADGE[t.severity]}>{t.severity.toLowerCase()}</TableBadge>
      </div>
      <p className="text-xs font-semibold text-slate-900">{t.title}</p>
      <p className="text-slate-600">{t.description}</p>
      <p className="text-slate-500">
        {t.contractorName}
        {t.location ? ` · ${t.location}` : ""}
        {t.dueDate ? ` · due ${t.dueDate}` : ""}
      </p>
      {t.isOverdue && <p className="font-semibold text-rose-700">Overdue</p>}
      {t.rectificationNotes && <p className="text-slate-600">Fix: {t.rectificationNotes}</p>}
      {t.resolutionReason && <p className="text-slate-600">Note: {t.resolutionReason}</p>}
      {(t.snagPhotoKeys.length > 0 || t.rectificationCaptures.length > 0 || t.verificationCaptures.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {t.snagPhotoKeys.map((k) => (
            <CapturePhoto key={k} projectId={project.id} objectKey={k} alt="Snag photo" className="h-12 w-12" />
          ))}
          {[...t.rectificationCaptures, ...t.verificationCaptures]
            .filter((c) => c.objectKey)
            .map((c) => (
              <CapturePhoto key={c.clientCaptureId} projectId={project.id} objectKey={c.objectKey!} alt="Repair photo" className="h-12 w-12" />
            ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 pt-1">
        {t.actions.assign.allowed && <SmallButton onClick={() => onAct("assign")}>Assign</SmallButton>}
        {t.actions.rectify.allowed && <SmallButton onClick={() => onAct("rectify")}>Mark fixed</SmallButton>}
        {t.actions.verify.allowed && (
          <SmallButton onClick={() => onAct("verify")}>
            <ShieldCheck className="h-3 w-3" /> Verify
          </SmallButton>
        )}
        {t.actions.reject.allowed && <SmallButton onClick={() => onAct("reject")}>Not a defect</SmallButton>}
      </div>
    </article>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function contractorOptions(project: ProjectSummaryDto) {
  return project.contractors.map((c) => ({ value: c.id, label: `${c.organizationName} (${c.tradeCode})${c.isMainContractor ? " · main" : ""}` }));
}

function RaiseDefectModal({ project, onClose }: { project: ProjectSummaryDto; onClose: () => void }) {
  const mutation = useCreateDefectTicketMutation(project.id);
  const term = useTerm();
  const multiPrime = project.contractorExecutionMode === "MULTI_PRIME_SEPARATE_IPC";
  const main = project.contractors.find((c) => c.isMainContractor) ?? project.contractors[0];
  const [form, setForm] = useState({
    title: "",
    description: "",
    severity: "MEDIUM" as DefectSeverity,
    projectContractorId: multiPrime ? "" : main?.id ?? "",
    location: "",
    dueDate: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({
        title: form.title,
        description: form.description,
        severity: form.severity,
        projectContractorId: form.projectContractorId || null,
        location: form.location || undefined,
        dueDate: form.dueDate || null,
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };
  return (
    <ModalShell title="Raise a defect" subtitle={`The responsible ${term("contractor", { lower: true })} is notified`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Title</span>
          <input required minLength={3} value={form.title} onChange={(e) => set("title", e.target.value)} className={inputClass} maxLength={160} />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Description</span>
          <textarea required minLength={3} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} className={inputClass} maxLength={4000} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <CustomSelect label={`Responsible ${term("contractor", { lower: true })}`} value={form.projectContractorId} onChange={(v) => set("projectContractorId", v)} options={contractorOptions(project)} placeholder="Choose" />
          <CustomSelect
            label="Severity"
            value={form.severity}
            onChange={(v) => set("severity", v as DefectSeverity)}
            options={["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
          />
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Location (optional)</span>
            <input value={form.location} onChange={(e) => set("location", e.target.value)} className={inputClass} maxLength={200} />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Due date (optional)</span>
            <input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={inputClass} />
          </label>
        </div>
        <ModalActions onCancel={onClose} submitLabel="Raise defect" pendingLabel="Raising…" isPending={mutation.isPending} disabled={multiPrime && !form.projectContractorId} />
      </form>
    </ModalShell>
  );
}

const ACTION_TITLE: Record<TicketAction["kind"], string> = {
  assign: "Assign defect",
  rectify: "Mark as fixed",
  verify: "Verify the repair",
  reject: "Not a defect",
};

function TicketActionModal({ project, action, onClose }: { project: ProjectSummaryDto; action: TicketAction; onClose: () => void }) {
  const mutation = useDefectActionMutation(project.id);
  const term = useTerm();
  const t = action.ticket;
  const [contractorId, setContractorId] = useState(t.projectContractorId);
  const [dueDate, setDueDate] = useState(t.dueDate ?? "");
  const [notes, setNotes] = useState("");
  // When the monitoring side captures the evidence, closing needs site photos: done in the field app.
  const closeInFieldApp = t.evidenceCapturedBy === "MONITOR";
  const [verifyDecision, setVerifyDecision] = useState<"CLOSE" | "REOPEN">(closeInFieldApp ? "REOPEN" : "CLOSE");

  const invalid =
    (action.kind === "reject" && notes.trim().length < 5) ||
    (action.kind === "rectify" && notes.trim().length < 5) ||
    (action.kind === "verify" && verifyDecision === "REOPEN" && notes.trim().length < 5);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body =
      action.kind === "assign"
        ? { kind: "assign" as const, body: { projectContractorId: contractorId, dueDate: dueDate || null } }
        : action.kind === "rectify"
          ? { kind: "rectify" as const, body: { notes: notes.trim(), captureIds: [] } }
          : action.kind === "verify"
            ? { kind: "verify" as const, body: { decision: verifyDecision, notes: notes.trim(), captureIds: [] } }
            : { kind: "reject" as const, body: { reason: notes.trim() } };
    try {
      await mutation.mutateAsync({ ticketId: t.id, action: body });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title={ACTION_TITLE[action.kind]} subtitle={`${t.reference} · ${t.title}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        {action.kind === "assign" && (
          <>
            <CustomSelect label={`Responsible ${term("contractor", { lower: true })}`} value={contractorId} onChange={setContractorId} options={contractorOptions(project)} />
            <label className="block space-y-1">
              <span className="font-semibold text-slate-700">Due date (optional)</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            </label>
          </>
        )}
        {action.kind === "rectify" && (
          <p className="text-slate-600">Describe the repair. Site photos are taken with the field app, which links them to this ticket.</p>
        )}
        {action.kind === "verify" && closeInFieldApp && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sky-900">
            Only the monitoring side reports from site on this project, so a verifier closes this defect from the field app with
            photos of the repair. Here you can reopen it if the repair is not acceptable.
          </p>
        )}
        {action.kind === "verify" && (
          <CustomSelect
            label="Outcome"
            value={verifyDecision}
            onChange={(v) => setVerifyDecision(v as "CLOSE" | "REOPEN")}
            options={[
              ...(closeInFieldApp ? [] : [{ value: "CLOSE" as const, label: "Repair verified: close the ticket" }]),
              { value: "REOPEN" as const, label: "Not fixed: reopen" },
            ]}
          />
        )}
        {action.kind !== "assign" && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">
              {action.kind === "reject" ? "Reason" : action.kind === "rectify" ? "What was done" : verifyDecision === "REOPEN" ? "What is still wrong" : "Notes (optional)"}
            </span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} maxLength={2000} />
          </label>
        )}
        {action.kind === "reject" && <BlockedNotice>The ticket is closed as not a defect. The reason is recorded in the audit ledger.</BlockedNotice>}
        <ModalActions onCancel={onClose} submitLabel={ACTION_TITLE[action.kind]} pendingLabel="Saving…" isPending={mutation.isPending} disabled={invalid} />
      </form>
    </ModalShell>
  );
}
