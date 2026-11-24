import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Landmark, Plus, Receipt, Wallet } from "lucide-react";
import {
  PAYMENT_EXCEPTION_LABELS,
  PAYMENT_KIND_LABELS,
  PaymentKindEnum,
  type PaymentDto,
  type PaymentKind,
  type ProjectPaymentsSummaryDto,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useTerm } from "../../lib/auth-context";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { CustomSelect, KpiCard } from "../../components/common";
import { ModalActions, ModalShell, inputClass } from "../../components/common/ModalShell";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../../components/table";
import { useProjectPaymentsQuery } from "../../queries/payments/usePaymentsQueries";
import { useRecordPaymentMutation, useVoidPaymentMutation } from "../../mutations/payments/usePaymentsMutations";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { PaidVsContractSumBar } from "../../components/payments/PaidVsContractSumBar";

const labelClass = "block text-xs font-semibold text-slate-700 mb-1";

/**
 * Payments (redesign R1b). Contractor payments are made outside the platform; finance records each
 * one here. Retention is held from interim and final payments and released by recording a
 * retention release. Rule breaches (e.g. a final payment before the Certificate of Completion)
 * are flagged on the payment, never blocked.
 */
export function ProjectPaymentsPage({ project }: { project: ProjectSummaryDto }) {
  const term = useTerm();
  const query = useProjectPaymentsQuery(project.id);
  const process = useProjectProcess(project.id);
  const retentionOn = process.data?.config.enableRetentionModule ?? false;
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<PaymentDto | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | PaymentKind>("");
  // "" = every sprint, "none" = payments without a sprint, else a sprint id.
  const [sprintFilter, setSprintFilter] = useState("");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const s = query.data;
  const sprints = s?.sprints ?? [];

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (s?.payments ?? []).filter(
      (p) =>
        (!t || p.reference.toLowerCase().includes(t) || (p.description ?? "").toLowerCase().includes(t)) &&
        (!kindFilter || p.kind === kindFilter) &&
        (!sprintFilter || (sprintFilter === "none" ? p.sprint === null : p.sprint?.id === sprintFilter)) &&
        (!exceptionsOnly || (!p.voided && p.exceptions.length > 0))
    );
  }, [s?.payments, search, kindFilter, sprintFilter, exceptionsOnly]);
  const filtered = Boolean(kindFilter || sprintFilter || exceptionsOnly || search.trim());

  const columns: TableColumnDef<PaymentDto>[] = [
    { id: "date", header: "Paid on", width: "w-28", cell: (p) => <span className="text-xs tabular-nums">{p.paidOn}</span> },
    {
      id: "what",
      header: "Payment",
      cell: (p) => (
        <div>
          <p className={`text-xs font-bold ${p.voided ? "text-slate-400 line-through" : "text-slate-900"}`}>
            {PAYMENT_KIND_LABELS[p.kind]} · {p.reference}
          </p>
          {p.description && <p className="text-[11px] text-slate-500">{p.description}</p>}
          {p.voided && <p className="text-[11px] text-rose-600">Void: {p.voidReason}</p>}
          {p.retentionOverrideReason && (
            <p className="text-[11px] text-slate-500">Retention changed: {p.retentionOverrideReason}</p>
          )}
        </div>
      ),
    },
    ...(sprints.length > 0
      ? [
          {
            id: "sprint",
            header: "Sprint",
            width: "w-32",
            cell: (p: PaymentDto) =>
              p.sprint ? (
                <span className="text-xs text-slate-700" title={p.sprint.name}>
                  Sprint {p.sprint.number}
                  <span className="block truncate text-[11px] text-slate-500">{p.sprint.name}</span>
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              ),
          },
        ]
      : []),
    { id: "gross", header: "Amount", width: "w-36", align: "right", cell: (p) => <span className="text-xs tabular-nums">{formatNaira(p.grossAmountNgn)}</span> },
    ...(retentionOn
      ? [
          {
            id: "held",
            header: `${term("retention")} held`,
            width: "w-36",
            align: "right" as const,
            cell: (p: PaymentDto) => <span className="text-xs tabular-nums text-slate-600">{p.retentionHeldNgn ? formatNaira(p.retentionHeldNgn) : "—"}</span>,
          },
        ]
      : []),
    { id: "net", header: "Net to contractor", width: "w-36", align: "right", cell: (p) => <span className="text-xs font-semibold tabular-nums">{formatNaira(p.netAmountNgn)}</span> },
    {
      id: "flags",
      header: "Checks",
      width: "w-48",
      cell: (p) =>
        p.exceptions.length === 0 ? (
          <TableBadge variant="success">No exceptions</TableBadge>
        ) : (
          <div className="space-y-1">
            {p.exceptions.map((e) => (
              <p key={e} className="flex items-start gap-1 text-[11px] text-amber-800">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {PAYMENT_EXCEPTION_LABELS[e]}
              </p>
            ))}
          </div>
        ),
    },
    {
      id: "by",
      header: "Recorded",
      width: "w-40",
      cell: (p) => (
        <div className="text-[11px] text-slate-600">
          <p>{p.recordedByName}</p>
          <p className="text-slate-400">{formatDateShort(p.recordedAt)}</p>
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "w-24",
      align: "right",
      cell: (p) =>
        s?.canRecord && !p.voided ? (
          <TableActionButton variant="danger" onClick={() => setVoiding(p)}>
            Void
          </TableActionButton>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Payments</h1>
        <p className="text-xs text-slate-500">
          Payments to the {term("contractor", { lower: true })} are made outside the platform. Record each one here so progress, {term("retention", { lower: true })} and
          closure checks stay complete.
        </p>
      </div>

      {s && <SummaryCards s={s} retentionOn={retentionOn} />}

      {s && (
        <div className={`grid gap-3 ${retentionOn ? "lg:grid-cols-2" : ""}`}>
          <section aria-labelledby="paid-vs-sum" className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 id="paid-vs-sum" className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              Paid against the contract sum
            </h2>
            <PaidVsContractSumBar paidNgn={s.paidGrossNgn} contractSumNgn={s.contractSumNgn} />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Gross amounts of interim and final payments; voided entries and {term("retention", { lower: true })} releases are not counted.
            </p>
          </section>
          {retentionOn && <ReleaseChecks s={s} />}
        </div>
      )}

      <StandardTable<PaymentDto>
        title="Payment record"
        subtitle={`${filtered ? `${rows.length} of ${s?.payments.length ?? 0}` : rows.length} payment(s)${s && s.exceptionCount > 0 ? ` · ${s.exceptionCount} exception(s)` : ""}`}
        search={{ value: search, onChange: setSearch, placeholder: "Search references" }}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-44">
              <CustomSelect
                ariaLabel="Payment type"
                value={kindFilter}
                onChange={(v) => setKindFilter(v as "" | PaymentKind)}
                options={[
                  { value: "", label: "All payment types" },
                  ...PaymentKindEnum.options
                    .filter((k) => retentionOn || k !== "RETENTION_RELEASE")
                    .map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] })),
                ]}
                size="sm"
              />
            </div>
            {sprints.length > 0 && (
              <div className="w-48">
                <CustomSelect
                  ariaLabel="Sprint"
                  value={sprintFilter}
                  onChange={(v) => setSprintFilter(v)}
                  options={[
                    { value: "", label: "All sprints" },
                    { value: "none", label: "No sprint named" },
                    ...sprints.map((sp) => ({ value: sp.id, label: `Sprint ${sp.number} · ${sp.name}` })),
                  ]}
                  size="sm"
                />
              </div>
            )}
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={exceptionsOnly} onChange={(e) => setExceptionsOnly(e.target.checked)} /> Exceptions only
            </label>
          </div>
        }
        headerActions={
          s?.canRecord && (
            <button
              type="button"
              onClick={() => setRecording(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
            >
              <Plus className="w-3.5 h-3.5" /> Record payment
            </button>
          )
        }
        columns={columns}
        data={rows}
        keyExtractor={(p) => p.id}
        loading={query.isLoading}
        emptyState={
          filtered && (s?.payments.length ?? 0) > 0
            ? { title: "No payments match", description: "Clear the search or filters to see every payment." }
            : { title: "No payments recorded", description: "Recorded payments appear here with their checks." }
        }
      />

      {recording && s && <RecordPaymentModal projectId={project.id} summary={s} retentionOn={retentionOn} onClose={() => setRecording(false)} />}
      {voiding && <VoidPaymentModal projectId={project.id} payment={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}

function SummaryCards({ s, retentionOn }: { s: ProjectPaymentsSummaryDto; retentionOn: boolean }) {
  const term = useTerm();
  return (
    <div className={`grid gap-3 ${retentionOn ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      <KpiCard
        title="Paid to date"
        value={formatNaira(s.paidGrossNgn)}
        subtitle={s.contractSumNgn !== null ? `of ${formatNaira(s.contractSumNgn)} contract sum` : "No contract sum set"}
        icon={<Receipt className="h-4 w-4" />}
      />
      <KpiCard
        title="Net to the contractor"
        value={formatNaira(s.paidNetNgn)}
        subtitle={retentionOn ? `after ${term("retention", { lower: true })}, releases included` : undefined}
        icon={<Wallet className="h-4 w-4" />}
        iconVariant="emerald"
      />
      {retentionOn && (
        <KpiCard
          title={`${term("retention")} held now`}
          value={formatNaira(s.retentionBalanceNgn)}
          subtitle={`${formatNaira(s.retentionReleasedNgn)} released${s.retentionPeriodEnd ? ` · period ends ${s.retentionPeriodEnd}` : ""}`}
          icon={<Landmark className="h-4 w-4" />}
          iconVariant="amber"
        />
      )}
    </div>
  );
}

/** Redesign R6d (D-R6.17): what a retention release is checked against, shown before one is recorded. */
function ReleaseChecks({ s }: { s: ProjectPaymentsSummaryDto }) {
  const term = useTerm();
  const checks: Array<{ key: string; met: boolean; label: string; detail: string }> = [
    {
      key: "coc",
      met: s.cocIssued,
      label: "Certificate of Completion",
      detail: s.cocIssued ? "Issued" : "Not issued yet",
    },
    {
      key: "period",
      met: s.retentionPeriodEnded,
      label: "Defects liability period",
      detail: s.retentionPeriodEnd
        ? s.retentionPeriodEnded
          ? `Ended ${s.retentionPeriodEnd}`
          : `Ends ${s.retentionPeriodEnd}`
        : "No end date yet (set when the liability period starts)",
    },
    {
      key: "defects",
      met: s.openDefects === 0,
      label: "Open defects",
      detail: s.openDefects === 0 ? "None open" : `${s.openDefects} still open`,
    },
  ];
  return (
    <section aria-labelledby="release-checks" className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="release-checks" className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Release checks
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        A {term("retention", { lower: true })} release recorded before these are met is flagged as an exception, not blocked.
      </p>
      <ul className="mt-2 space-y-1.5">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-xs">
            {c.met ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
            )}
            <span>
              <span className="font-semibold text-slate-800">{c.label}:</span>{" "}
              <span className={c.met ? "text-slate-700" : "text-amber-800"}>{c.detail}</span>
              <span className="sr-only">{c.met ? " (met)" : " (not met)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecordPaymentModal({
  projectId,
  summary,
  retentionOn,
  onClose,
}: {
  projectId: string;
  summary: ProjectPaymentsSummaryDto;
  retentionOn: boolean;
  onClose: () => void;
}) {
  const term = useTerm();
  const record = useRecordPaymentMutation(projectId);
  const kinds = PaymentKindEnum.options.filter((k) => retentionOn || k !== "RETENTION_RELEASE");
  const [kind, setKind] = useState<PaymentKind>("INTERIM");
  const [paidOn, setPaidOn] = useState(summary.today);
  const [sprintId, setSprintId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [heldOverride, setHeldOverride] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const gross = Number(amount);
  const pct = retentionOn ? summary.retentionPercentage ?? 0 : 0;
  const expectedHeld = kind === "RETENTION_RELEASE" || !(gross > 0) ? 0 : Math.round(gross * pct) / 100;
  const held = heldOverride !== null && heldOverride !== "" ? Number(heldOverride) : expectedHeld;
  const changedHeld = kind !== "RETENTION_RELEASE" && heldOverride !== null && heldOverride !== "" && Math.abs(held - expectedHeld) > 0.005;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(gross > 0)) return setError("Enter the amount paid.");
    if (!reference.trim()) return setError("Enter the payment reference (voucher or transfer number).");
    if (kind === "RETENTION_RELEASE" && gross > summary.retentionBalanceNgn + 0.005) {
      return setError(`Only ${formatNaira(summary.retentionBalanceNgn)} is held.`);
    }
    if (changedHeld && overrideReason.trim().length < 3) return setError(`Say why the ${term("retention", { lower: true })} differs.`);
    setError(null);
    try {
      await record.mutateAsync({
        kind,
        paidOn,
        grossAmountNgn: gross,
        reference: reference.trim(),
        description: description.trim() || null,
        retentionHeldNgn: changedHeld ? held : null,
        retentionOverrideReason: changedHeld ? overrideReason.trim() : null,
        sprintId: sprintId || null,
      });
      onClose();
    } catch {
      // Toast from the mutation hook.
    }
  };

  return (
    <ModalShell title="Record payment" subtitle="A payment already made outside the platform" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <CustomSelect
            label="Type"
            value={kind}
            onChange={(v) => {
              setKind(v as PaymentKind);
              setHeldOverride(null);
            }}
            options={kinds.map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] }))}
          />
          <div>
            <label className={labelClass} htmlFor="pay-date">
              Paid on
            </label>
            <input id="pay-date" type="date" className={inputClass} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="pay-amount">
              Amount paid (gross)
            </label>
            <input id="pay-amount" type="number" min="0" step="0.01" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="pay-ref">
              Reference
            </label>
            <input id="pay-ref" className={inputClass} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PV-2026-0142" />
          </div>
          {summary.sprints.length > 0 && (
            <div className="sm:col-span-2">
              <CustomSelect
                label="Sprint (optional)"
                hint="The sprint this payment is for. A sprint a payment names cannot be removed later."
                value={sprintId}
                onChange={(v) => setSprintId(v)}
                options={[
                  { value: "", label: "No sprint" },
                  ...summary.sprints.map((sp) => ({ value: sp.id, label: `Sprint ${sp.number} · ${sp.name}` })),
                ]}
              />
            </div>
          )}
        </div>
        {kind !== "RETENTION_RELEASE" && retentionOn && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-xs text-slate-700">
              {term("retention")} held from this payment: <span className="font-semibold">{formatNaira(held)}</span>
              {pct ? ` (${pct}% by default)` : ""} · net {formatNaira(Math.max(0, gross - held) || 0)}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="pay-held">
                  Different amount held (optional)
                </label>
                <input
                  id="pay-held"
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  placeholder={formatNaira(expectedHeld)}
                  aria-describedby="pay-held-hint"
                  value={heldOverride ?? ""}
                  onChange={(e) => setHeldOverride(e.target.value)}
                />
                <p id="pay-held-hint" className="mt-1 text-[11px] text-slate-500">
                  Leave empty to hold the default amount.
                </p>
              </div>
              {changedHeld && (
                <div>
                  <label className={labelClass} htmlFor="pay-held-reason">
                    Why it differs
                  </label>
                  <input
                    id="pay-held-reason"
                    className={inputClass}
                    maxLength={500}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        {kind === "RETENTION_RELEASE" && (
          <p className="text-xs text-slate-600">{formatNaira(summary.retentionBalanceNgn)} of {term("retention", { lower: true })} is held now.</p>
        )}
        <div>
          <label className={labelClass} htmlFor="pay-desc">
            Note (optional)
          </label>
          <input id="pay-desc" className={inputClass} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
        <ModalActions onCancel={onClose} submitLabel="Record payment" pendingLabel="Recording…" isPending={record.isPending} />
      </form>
    </ModalShell>
  );
}

function VoidPaymentModal({ projectId, payment, onClose }: { projectId: string; payment: PaymentDto; onClose: () => void }) {
  const voidMutation = useVoidPaymentMutation(projectId);
  const [reason, setReason] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await voidMutation.mutateAsync({ paymentId: payment.id, body: { reason: reason.trim() } });
      onClose();
    } catch {
      // Toast from the mutation hook.
    }
  };
  return (
    <ModalShell title="Void payment" subtitle={`${payment.reference} · ${formatNaira(payment.grossAmountNgn)}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5">
        <p className="text-xs text-slate-600">
          A voided payment stays in the record, crossed out, and stops counting towards the totals. Record the correct payment
          separately.
        </p>
        <div>
          <label className={labelClass} htmlFor="void-reason">
            Reason
          </label>
          <textarea
            id="void-reason"
            className={inputClass}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this entry wrong?"
          />
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Void payment"
          pendingLabel="Voiding…"
          isPending={voidMutation.isPending}
          disabled={reason.trim().length < 5}
        />
      </form>
    </ModalShell>
  );
}
