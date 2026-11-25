import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, RotateCcw } from "lucide-react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import {
  DEFECT_STATUS_LABELS,
  DefectSeverityEnum,
  type CreateDefectTicketInput,
  type DefectSeverity,
  type DefectStatus,
  type DefectTicketDto,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth, useTerm } from "../../lib/auth-context";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import Loader from "../../components/Loader";
import { CustomSelect } from "../../components/common";
import { TableBadge } from "../../components/table/StandardTable";
import { CapturePhoto } from "../../components/evidence/CaptureMedia";
import { BlockedNotice, ModalActions, ModalShell, inputClass } from "../../components/common/ModalShell";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useDefectTicketsQuery } from "../../queries/closeout/useCloseoutQueries";
import { useCreateDefectTicketMutation, useDefectActionMutation } from "../../mutations/closeout/useCloseoutMutations";

const BOARD: DefectStatus[] = ["OPEN", "ASSIGNED", "RECTIFIED_PENDING_VERIFICATION", "VERIFIED_CLOSED", "REJECTED_NOT_A_DEFECT"];
const SEVERITY_BADGE: Record<DefectSeverity, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

/**
 * Completion & handover → Defects (Phase 10; redesign R1b, R6b): the defect board. The retention
 * cards moved to Payments (D-R6.17). `?ticket=` (from a notification) scrolls to that ticket.
 * The tab is shown only when the retention module is on.
 */
export function DefectsTab({ project }: { project: ProjectSummaryDto }) {
  const term = useTerm();
  const processQuery = useProjectProcess(project.id);
  const enabled = processQuery.data?.config.enableRetentionModule ?? false;
  const ticketsQuery = useDefectTicketsQuery(project.id, enabled);
  const [params] = useSearchParams();
  const focusTicketId = params.get("ticket");

  if (processQuery.isLoading) return <Loader />;
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
        {term("retention")} and defects are not used on this project.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Defects raised during handover and the defects liability period. An officer closes a defect from the field app with photos of the
        repair.
      </p>
      <DefectBoard project={project} tickets={ticketsQuery.data ?? []} loading={ticketsQuery.isLoading} focusTicketId={focusTicketId} />
    </div>
  );
}

// ---------------------------------------------------------------------------

type TicketAction = { ticket: DefectTicketDto; kind: "assign" | "verify" | "reject" };

function DefectBoard({
  project,
  tickets,
  loading,
  focusTicketId,
}: {
  project: ProjectSummaryDto;
  tickets: DefectTicketDto[];
  loading: boolean;
  focusTicketId: string | null;
}) {
  const { hasPermission } = useAuth();
  const [raising, setRaising] = useState(false);
  const [acting, setActing] = useState<TicketAction | null>(null);
  const byStatus = useMemo(() => {
    const m = new Map<DefectStatus, DefectTicketDto[]>(BOARD.map((s) => [s, []]));
    for (const t of tickets) m.get(t.status)!.push(t);
    return m;
  }, [tickets]);
  // A notification link names one ticket: bring it into view once it is loaded.
  const focusFound = Boolean(focusTicketId && tickets.some((t) => t.id === focusTicketId));
  useEffect(() => {
    if (focusFound && focusTicketId) document.getElementById(`defect-${focusTicketId}`)?.scrollIntoView({ block: "center" });
  }, [focusFound, focusTicketId]);
  // Defects are staff-only (R1c): the liable party is always the project's one contractor.
  const canRaise = hasPermission("defects:manage");

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
                <TicketCard key={t.id} project={project} ticket={t} focused={t.id === focusTicketId} onAct={(kind) => setActing({ ticket: t, kind })} />
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

function TicketCard({
  project,
  ticket: t,
  focused,
  onAct,
}: {
  project: ProjectSummaryDto;
  ticket: DefectTicketDto;
  focused: boolean;
  onAct: (k: TicketAction["kind"]) => void;
}) {
  return (
    <article
      id={`defect-${t.id}`}
      aria-current={focused ? "true" : undefined}
      className={`space-y-1.5 rounded-xl border bg-white p-2.5 text-[11px] ${focused ? "border-brand-primary ring-2 ring-brand-primary/40" : "border-slate-200"}`}
    >
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
      {t.resolutionReason && <p className="text-slate-600">Note: {t.resolutionReason}</p>}
      {t.verificationCaptures.some((c) => c.objectKey) && (
        <div className="flex flex-wrap gap-1">
          {t.verificationCaptures
            .filter((c) => c.objectKey)
            .map((c) => (
              <CapturePhoto key={c.clientCaptureId} projectId={project.id} objectKey={c.objectKey!} alt="Repair photo" className="h-12 w-12" />
            ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 pt-1">
        {t.actions.assign.allowed && <SmallButton onClick={() => onAct("assign")}>Assign</SmallButton>}
        {t.actions.verify.allowed && (
          <SmallButton onClick={() => onAct("verify")}>
            <RotateCcw className="h-3 w-3" /> Reopen
          </SmallButton>
        )}
        {t.actions.reject.allowed && <SmallButton onClick={() => onAct("reject")}>Not a defect</SmallButton>}
      </div>
      {!t.actions.verify.allowed && t.actions.verify.reason && (t.status === "ASSIGNED" || t.status === "OPEN" || t.status === "RECTIFIED_PENDING_VERIFICATION") && (
        <p className="text-slate-500">{t.actions.verify.reason}</p>
      )}
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

/** An optional date input: empty, or YYYY-MM-DD. */
const optionalDate = z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a valid date or leave it empty");

/** The raise form; same limits as CreateDefectTicketRequestSchema, with plain-words messages. */
const RaiseDefectFormSchema = z
  .object({
    title: z.string().trim().min(3, "Give the defect a title of at least 3 characters").max(160, "The title is too long (at most 160 characters)"),
    description: z
      .string()
      .trim()
      .min(3, "Describe the defect in at least 3 characters")
      .max(4000, "The description is too long (at most 4000 characters)"),
    severity: DefectSeverityEnum,
    location: z.string().trim().max(200, "The location is too long (at most 200 characters)"),
    dueDate: optionalDate,
  })
  .transform(
    (v): CreateDefectTicketInput => ({
      title: v.title,
      description: v.description,
      severity: v.severity,
      location: v.location || undefined,
      dueDate: v.dueDate || null,
    })
  );

function RaiseDefectModal({ project, onClose }: { project: ProjectSummaryDto; onClose: () => void }) {
  const mutation = useCreateDefectTicketMutation(project.id);
  const term = useTerm();
  const contractor = project.contractors[0];
  const form = useZodForm(RaiseDefectFormSchema, {
    defaultValues: { title: "", description: "", severity: "MEDIUM", location: "", dueDate: "" },
  });
  const submit = form.handleSubmit(async (body) => {
    try {
      await mutation.mutateAsync(body);
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  });
  return (
    <ModalShell
      title="Raise a defect"
      subtitle={contractor ? `Against ${contractor.organizationName}` : `The project has no ${term("contractor", { lower: true })}`}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="space-y-3 p-5 text-xs">
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Title</span>
          <input className={`${inputClass} ${invalidClass(form, "title")}`} maxLength={160} {...form.register("title")} {...fieldA11y(form, "title")} />
          <FieldError form={form} name="title" />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Description</span>
          <textarea
            rows={3}
            className={`${inputClass} ${invalidClass(form, "description")}`}
            maxLength={4000}
            {...form.register("description")}
            {...fieldA11y(form, "description")}
          />
          <FieldError form={form} name="description" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Controller
            control={form.control}
            name="severity"
            render={({ field }) => (
              <CustomSelect
                label="Severity"
                value={field.value}
                onChange={(v) => field.onChange(v as DefectSeverity)}
                options={["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
              />
            )}
          />
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Location (optional)</span>
            <input className={`${inputClass} ${invalidClass(form, "location")}`} maxLength={200} {...form.register("location")} {...fieldA11y(form, "location")} />
            <FieldError form={form} name="location" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-slate-700">Due date (optional)</span>
            <input type="date" className={`${inputClass} ${invalidClass(form, "dueDate")}`} {...form.register("dueDate")} {...fieldA11y(form, "dueDate")} />
            <FieldError form={form} name="dueDate" />
          </label>
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Raise defect"
          pendingLabel="Raising…"
          isPending={mutation.isPending}
          disabled={!contractor || !canSubmit(form, { pending: mutation.isPending })}
        />
      </form>
    </ModalShell>
  );
}

const ACTION_TITLE: Record<TicketAction["kind"], string> = {
  assign: "Assign defect",
  verify: "Reopen the defect",
  reject: "Not a defect",
};

/**
 * One form for the three web actions: assign (optional due date), reopen (what is still wrong, at
 * least 5 characters, VerifyDefectTicketRequestSchema) and not a defect (a reason of at least 5
 * characters, RejectDefectTicketRequestSchema).
 */
const TicketActionFormSchema = z
  .object({
    kind: z.enum(["assign", "verify", "reject"]),
    dueDate: optionalDate,
    notes: z.string().trim().max(2000, "Too long (at most 2000 characters)"),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "verify" && v.notes.length < 5) ctx.addIssue({ code: "custom", path: ["notes"], message: "Say what is still wrong (at least 5 characters)" });
    if (v.kind === "reject" && v.notes.length < 5) ctx.addIssue({ code: "custom", path: ["notes"], message: "Give a reason of at least 5 characters" });
  });

function TicketActionModal({ project, action, onClose }: { project: ProjectSummaryDto; action: TicketAction; onClose: () => void }) {
  const mutation = useDefectActionMutation(project.id);
  const t = action.ticket;
  const form = useZodForm(TicketActionFormSchema, { defaultValues: { kind: action.kind, dueDate: t.dueDate ?? "", notes: "" } });
  // Closing needs the officer's site photos, so it is done from the field app; the web can only reopen.
  const verifyDecision = "REOPEN" as const;

  const submit = form.handleSubmit(async ({ dueDate, notes }) => {
    const body =
      action.kind === "assign"
        ? { kind: "assign" as const, body: { dueDate: dueDate || null } }
        : action.kind === "verify"
          ? { kind: "verify" as const, body: { decision: verifyDecision, notes, captureIds: [] } }
          : { kind: "reject" as const, body: { reason: notes } };
    try {
      await mutation.mutateAsync({ ticketId: t.id, action: body });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  });

  return (
    <ModalShell title={ACTION_TITLE[action.kind]} subtitle={`${t.reference} · ${t.title}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3 p-5 text-xs">
        {action.kind === "assign" && (
          <>
            <p className="text-slate-600">Record that this defect was passed to {t.contractorName}.</p>
            <label className="block space-y-1">
              <span className="font-semibold text-slate-700">Due date (optional)</span>
              <input type="date" className={`${inputClass} ${invalidClass(form, "dueDate")}`} {...form.register("dueDate")} {...fieldA11y(form, "dueDate")} />
              <FieldError form={form} name="dueDate" />
            </label>
          </>
        )}
        {action.kind === "verify" && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sky-900">
            An officer closes this defect from the field app with photos of the repair. Here you can reopen it if the repair is not
            acceptable.
          </p>
        )}
        {action.kind !== "assign" && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">
              {action.kind === "reject" ? "Reason" : "What is still wrong"}
            </span>
            <textarea
              rows={3}
              className={`${inputClass} ${invalidClass(form, "notes")}`}
              maxLength={2000}
              {...form.register("notes")}
              {...fieldA11y(form, "notes")}
            />
            <FieldError form={form} name="notes" />
          </label>
        )}
        {action.kind === "reject" && <BlockedNotice>The ticket is closed as not a defect. The reason is recorded in the audit ledger.</BlockedNotice>}
        <ModalActions
          onCancel={onClose}
          submitLabel={action.kind === "verify" ? "Reopen" : ACTION_TITLE[action.kind]}
          pendingLabel="Saving…"
          isPending={mutation.isPending}
          disabled={!canSubmit(form, { pending: mutation.isPending })}
        />
      </form>
    </ModalShell>
  );
}
