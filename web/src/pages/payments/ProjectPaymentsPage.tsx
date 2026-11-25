import { useEffect, useMemo, useState } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, CircleDashed, Landmark, Plus, Receipt, Wallet } from "lucide-react";
import {
  PAYMENT_EXCEPTION_LABELS,
  PAYMENT_KIND_LABELS,
  PaymentKindEnum,
  RecordPaymentRequestSchema,
  VoidPaymentRequestSchema,
  type PaymentDto,
  type PaymentKind,
  type ProjectPaymentsSummaryDto,
  type RecordPaymentRequest,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useTerm } from "../../lib/auth-context";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm, zDateText, zNumberText } from "../../lib/forms";
import { CustomSelect, KpiCard } from "../../components/common";
import { ModalActions, ModalShell, inputClass } from "../../components/common/ModalShell";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../../components/table";
import { useProjectPaymentsQuery } from "../../queries/payments/usePaymentsQueries";
import { useRecordPaymentMutation, useVoidPaymentMutation } from "../../mutations/payments/usePaymentsMutations";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { PaidVsContractSumBar } from "../../components/payments/PaidVsContractSumBar";
import { ExportExcelButton } from "../../components/common/ExportExcelButton";
import { useExportProjectPaymentsMutation } from "../../mutations/screenExports/useScreenExportMutations";

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
  const exportPayments = useExportProjectPaymentsMutation(project.id);
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
          <>
            <ExportExcelButton
              onDark
              pending={exportPayments.isPending}
              onClick={() =>
                exportPayments.mutate({
                  search: search.trim() || undefined,
                  kind: kindFilter || undefined,
                  sprint: sprintFilter || undefined,
                  exceptionsOnly: exceptionsOnly ? "true" : undefined,
                })
              }
            />
            {s?.canRecord && (
              <button
                type="button"
                onClick={() => setRecording(true)}
                className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
              >
                <Plus className="w-3.5 h-3.5" /> Record payment
              </button>
            )}
          </>
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
  const pct = retentionOn ? summary.retentionPercentage ?? 0 : 0;
  const expectedHeldFor = (kind: PaymentKind, gross: number) => (kind === "RETENTION_RELEASE" || !(gross > 0) ? 0 : Math.round(gross * pct) / 100);
  /** The held amount typed over the default, when it differs from it (null = the default applies). */
  const heldChange = (kind: PaymentKind, gross: number, heldOverride: string): number | null => {
    if (kind === "RETENTION_RELEASE" || heldOverride.trim() === "") return null;
    const held = Number(heldOverride);
    return Math.abs(held - expectedHeldFor(kind, gross)) > 0.005 ? held : null;
  };

  // Built per render: the release limit, the default retention and its wording come from the project.
  const schema = z
    .object({
      kind: PaymentKindEnum,
      paidOn: zDateText("Payment date"),
      amount: zNumberText("Amount paid").refine((n) => n > 0, "Enter the amount paid (above zero)"),
      reference: RecordPaymentRequestSchema.innerType().shape.reference,
      sprintId: z.string(),
      description: z.string().trim().max(500, "Note is too long (at most 500 characters)"),
      heldOverride: z
        .string()
        .trim()
        .refine((v) => v === "" || (/^\d+(\.\d+)?$/.test(v) && Number(v) >= 0), "Enter the amount held as a number, or leave it empty"),
      overrideReason: z.string().trim().max(500, "Too long (at most 500 characters)"),
    })
    .superRefine((v, ctx) => {
      if (v.kind === "RETENTION_RELEASE" && v.amount > summary.retentionBalanceNgn + 0.005) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: `Only ${formatNaira(summary.retentionBalanceNgn)} is held` });
      }
      const held = heldChange(v.kind, v.amount, v.heldOverride);
      if (held !== null && held > v.amount) {
        ctx.addIssue({ code: "custom", path: ["heldOverride"], message: "The amount held cannot be more than the amount paid" });
      }
      if (held !== null && v.overrideReason.length < 3) {
        ctx.addIssue({ code: "custom", path: ["overrideReason"], message: `Say why the ${term("retention", { lower: true })} differs (at least 3 characters)` });
      }
    })
    .transform((v): RecordPaymentRequest => {
      const held = heldChange(v.kind, v.amount, v.heldOverride);
      return {
        kind: v.kind,
        paidOn: v.paidOn,
        grossAmountNgn: v.amount,
        reference: v.reference,
        description: v.description || null,
        retentionHeldNgn: held,
        retentionOverrideReason: held !== null ? v.overrideReason : null,
        sprintId: v.sprintId || null,
      };
    })
    .pipe(RecordPaymentRequestSchema);

  const form = useZodForm(schema, {
    defaultValues: { kind: "INTERIM", paidOn: summary.today, amount: "", reference: "", sprintId: "", description: "", heldOverride: "", overrideReason: "" },
  });
  const kind = form.watch("kind");
  const gross = Number(form.watch("amount"));
  const heldOverride = form.watch("heldOverride");
  const expectedHeld = expectedHeldFor(kind, gross);
  const held = heldOverride.trim() !== "" && Number.isFinite(Number(heldOverride)) ? Number(heldOverride) : expectedHeld;
  const changedHeld = heldChange(kind, Number.isFinite(gross) ? gross : 0, heldOverride) !== null;
  // The amount drives the default retention, so the override rules follow it.
  useEffect(() => {
    if (form.getFieldState("heldOverride").isTouched || form.getFieldState("overrideReason").isTouched) void form.trigger(["heldOverride", "overrideReason"]);
  }, [form, gross, kind]);

  const submit = form.handleSubmit(async (body) => {
    try {
      await record.mutateAsync(body);
      onClose();
    } catch {
      // Toast from the mutation hook.
    }
  });

  return (
    <ModalShell title="Record payment" subtitle="A payment already made outside the platform" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <CustomSelect
                label="Type"
                value={field.value}
                onChange={(v) => {
                  field.onChange(v as PaymentKind);
                  form.setValue("heldOverride", "", { shouldValidate: true });
                  void form.trigger("amount");
                }}
                options={kinds.map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] }))}
              />
            )}
          />
          <div>
            <label className={labelClass} htmlFor="pay-date">
              Paid on
            </label>
            <input id="pay-date" type="date" className={`${inputClass} ${invalidClass(form, "paidOn")}`} {...form.register("paidOn")} {...fieldA11y(form, "paidOn")} />
            <FieldError form={form} name="paidOn" />
          </div>
          <div>
            <label className={labelClass} htmlFor="pay-amount">
              Amount paid (gross)
            </label>
            <input
              id="pay-amount"
              type="number"
              min="0"
              step="0.01"
              className={`${inputClass} ${invalidClass(form, "amount")}`}
              {...form.register("amount")}
              {...fieldA11y(form, "amount")}
            />
            <FieldError form={form} name="amount" />
          </div>
          <div>
            <label className={labelClass} htmlFor="pay-ref">
              Reference
            </label>
            <input
              id="pay-ref"
              className={`${inputClass} ${invalidClass(form, "reference")}`}
              maxLength={120}
              placeholder="e.g. PV-2026-0142"
              {...form.register("reference")}
              {...fieldA11y(form, "reference")}
            />
            <FieldError form={form} name="reference" />
          </div>
          {summary.sprints.length > 0 && (
            <div className="sm:col-span-2">
              <Controller
                control={form.control}
                name="sprintId"
                render={({ field }) => (
                  <CustomSelect
                    label="Sprint (optional)"
                    hint="The sprint this payment is for. A sprint a payment names cannot be removed later."
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: "", label: "No sprint" },
                      ...summary.sprints.map((sp) => ({ value: sp.id, label: `Sprint ${sp.number} · ${sp.name}` })),
                    ]}
                  />
                )}
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
                  className={`${inputClass} ${invalidClass(form, "heldOverride")}`}
                  placeholder={formatNaira(expectedHeld)}
                  {...form.register("heldOverride")}
                  {...fieldA11y(form, "heldOverride")}
                  aria-describedby={fieldA11y(form, "heldOverride")["aria-describedby"] ?? "pay-held-hint"}
                />
                <FieldError form={form} name="heldOverride" />
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
                    className={`${inputClass} ${invalidClass(form, "overrideReason")}`}
                    maxLength={500}
                    {...form.register("overrideReason")}
                    {...fieldA11y(form, "overrideReason")}
                  />
                  <FieldError form={form} name="overrideReason" />
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
          <input id="pay-desc" className={`${inputClass} ${invalidClass(form, "description")}`} maxLength={500} {...form.register("description")} {...fieldA11y(form, "description")} />
          <FieldError form={form} name="description" />
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Record payment"
          pendingLabel="Recording…"
          isPending={record.isPending}
          disabled={!canSubmit(form, { pending: record.isPending })}
        />
      </form>
    </ModalShell>
  );
}

function VoidPaymentModal({ projectId, payment, onClose }: { projectId: string; payment: PaymentDto; onClose: () => void }) {
  const voidMutation = useVoidPaymentMutation(projectId);
  const form = useZodForm(VoidPaymentRequestSchema, { defaultValues: { reason: "" } });
  const submit = form.handleSubmit(async (body) => {
    try {
      await voidMutation.mutateAsync({ paymentId: payment.id, body });
      onClose();
    } catch {
      // Toast from the mutation hook.
    }
  });
  return (
    <ModalShell title="Void payment" subtitle={`${payment.reference} · ${formatNaira(payment.grossAmountNgn)}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3 p-5">
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
            className={`${inputClass} ${invalidClass(form, "reason")}`}
            rows={3}
            maxLength={500}
            placeholder="Why is this entry wrong?"
            {...form.register("reason")}
            {...fieldA11y(form, "reason")}
          />
          <FieldError form={form} name="reason" />
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Void payment"
          pendingLabel="Voiding…"
          isPending={voidMutation.isPending}
          disabled={!canSubmit(form, { pending: voidMutation.isPending })}
        />
      </form>
    </ModalShell>
  );
}
