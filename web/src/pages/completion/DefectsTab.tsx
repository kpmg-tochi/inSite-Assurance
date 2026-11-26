import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Plus, RotateCcw, X } from "lucide-react";
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
import Drawer from "../../components/Drawer";
import { CustomSelect } from "../../components/common";
import { StandardTable, TableBadge, type TableBadgeVariant, type TableColumnDef } from "../../components/table/StandardTable";
import { CapturePhoto } from "../../components/evidence/CaptureMedia";
import { BlockedNotice, ModalActions, ModalShell, inputClass } from "../../components/common/ModalShell";
import { panelClass, secondaryAction } from "../../components/closure/closureUi";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useDefectTicketsQuery } from "../../queries/closeout/useCloseoutQueries";
import { formatDateShort } from "../../lib/formatters";
import { useCreateDefectTicketMutation, useDefectActionMutation } from "../../mutations/closeout/useCloseoutMutations";
import { OPEN_DEFECT_STATUSES } from "./completionTabHints";

const BOARD: DefectStatus[] = ["OPEN", "ASSIGNED", "RECTIFIED_PENDING_VERIFICATION", "VERIFIED_CLOSED", "REJECTED_NOT_A_DEFECT"];
const SEVERITIES: DefectSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEVERITY_BADGE: Record<DefectSeverity, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};
const STATUS_BADGE: Record<DefectStatus, TableBadgeVariant> = {
  OPEN: "warning",
  ASSIGNED: "info",
  RECTIFIED_PENDING_VERIFICATION: "info",
  VERIFIED_CLOSED: "success",
  REJECTED_NOT_A_DEFECT: "neutral",
};
const severityLabel = (s: DefectSeverity) => s.charAt(0) + s.slice(1).toLowerCase();

type StatusFilter = "all" | "still-open" | DefectStatus;

/**
 * Completion & handover → Defects (Phase 10; redesign R1b, R6b). The retention cards moved to
 * Payments (D-R6.17). The tab is shown only when the retention module is on.
 *
 * Design round 2026-11-26: the five-column board became one register table (search, status and
 * severity filters, 15 rows a page); a row opens the ticket in a side drawer with its details,
 * repair photos and actions (Assign, Reopen, Not a defect). `?ticket=` (from a notification) opens
 * that ticket's drawer.
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
    return <div className={`${panelClass} text-center text-xs text-slate-600`}>{term("retention")} and defects are not used on this project.</div>;
  }

  return <DefectRegister project={project} tickets={ticketsQuery.data ?? []} loading={ticketsQuery.isLoading} focusTicketId={focusTicketId} />;
}

// ---------------------------------------------------------------------------

type TicketAction = { ticket: DefectTicketDto; kind: "assign" | "verify" | "reject" };

function DefectRegister({
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [severity, setSeverity] = useState<"all" | DefectSeverity>("all");
  // Defects are staff-only (R1c): the liable party is always the project's one contractor.
  const canRaise = hasPermission("defects:manage");

  // A notification link names one ticket: open it once it is loaded.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (focusTicketId && focused.current !== focusTicketId && tickets.some((t) => t.id === focusTicketId)) {
      focused.current = focusTicketId;
      setOpenId(focusTicketId);
    }
  }, [focusTicketId, tickets]);

  const counts = useMemo(() => {
    const byStatus = new Map<DefectStatus, number>(BOARD.map((s) => [s, 0]));
    for (const t of tickets) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    const open = tickets.filter((t) => OPEN_DEFECT_STATUSES.includes(t.status)).length;
    const overdue = tickets.filter((t) => t.isOverdue && OPEN_DEFECT_STATUSES.includes(t.status)).length;
    return { byStatus, open, overdue };
  }, [tickets]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (status === "still-open" && !OPEN_DEFECT_STATUSES.includes(t.status)) return false;
      if (status !== "all" && status !== "still-open" && t.status !== status) return false;
      if (severity !== "all" && t.severity !== severity) return false;
      if (q && ![t.reference, t.title, t.location ?? "", t.description].some((v) => v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tickets, search, status, severity]);

  const selected = openId ? (tickets.find((t) => t.id === openId) ?? null) : null;

  const columns: TableColumnDef<DefectTicketDto>[] = [
    {
      id: "reference",
      header: "Reference",
      width: "w-32",
      cell: (t) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenId(t.id);
          }}
          className="rounded font-bold text-brand-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          aria-label={`Open ${t.reference}: ${t.title}`}
        >
          {t.reference}
        </button>
      ),
    },
    {
      id: "defect",
      header: "Defect",
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{t.title}</p>
          {t.location && <p className="text-[11px] text-slate-600">{t.location}</p>}
        </div>
      ),
    },
    { id: "severity", header: "Severity", width: "w-28", cell: (t) => <TableBadge variant={SEVERITY_BADGE[t.severity]}>{severityLabel(t.severity)}</TableBadge> },
    { id: "status", header: "Status", width: "w-44", cell: (t) => <TableBadge variant={STATUS_BADGE[t.status]}>{DEFECT_STATUS_LABELS[t.status]}</TableBadge> },
    {
      id: "due",
      header: "Due",
      width: "w-36",
      cell: (t) =>
        t.dueDate ? (
          <span className={t.isOverdue ? "inline-flex items-center gap-1 font-semibold text-rose-700" : "text-slate-700"}>
            {t.isOverdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {formatDateShort(t.dueDate)}
            {t.isOverdue && " · overdue"}
          </span>
        ) : (
          <span className="text-slate-500">No due date</span>
        ),
    },
  ];

  const summary =
    tickets.length === 0
      ? "Officers close defects from the field app with photos of the repair."
      : `${counts.open} open${counts.overdue ? ` · ${counts.overdue} overdue` : ""} · ${tickets.length} in all. Officers close defects from the field app with photos of the repair.`;

  return (
    <>
      <StandardTable
        title="Defects"
        subtitle={summary}
        headerActions={
          canRaise ? (
            <button
              type="button"
              onClick={() => setRaising(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Raise defect
            </button>
          ) : undefined
        }
        search={{ value: search, onChange: setSearch, placeholder: "Search reference, title or location" }}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
            <CustomSelect<StatusFilter>
              ariaLabel="Status"
              size="sm"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: `All statuses (${tickets.length})` },
                { value: "still-open", label: `Still open (${counts.open})` },
                ...BOARD.map((s) => ({ value: s as StatusFilter, label: `${DEFECT_STATUS_LABELS[s]} (${counts.byStatus.get(s) ?? 0})` })),
              ]}
            />
            </div>
            <div className="w-40">
            <CustomSelect<"all" | DefectSeverity>
              ariaLabel="Severity"
              size="sm"
              value={severity}
              onChange={setSeverity}
              options={[{ value: "all", label: "All severities" }, ...SEVERITIES.map((s) => ({ value: s, label: severityLabel(s) }))]}
            />
            </div>
          </div>
        }
        columns={columns}
        data={rows}
        keyExtractor={(t) => t.id}
        onRowClick={(t) => setOpenId(t.id)}
        selectedId={openId}
        loading={loading}
        minWidth="min-w-[720px]"
        emptyState={
          tickets.length === 0
            ? { title: "No defects", description: "Defects raised during handover and the defects liability period are listed here." }
            : { title: "No matching defects", description: "Change the search or the filters." }
        }
      />
      {selected && (
        <DefectDrawer
          project={project}
          ticket={selected}
          onClose={() => setOpenId(null)}
          onAct={(kind) => {
            setOpenId(null);
            setActing({ ticket: selected, kind });
          }}
        />
      )}
      {raising && <RaiseDefectModal project={project} onClose={() => setRaising(false)} />}
      {acting && <TicketActionModal project={project} action={acting} onClose={() => setActing(null)} />}
    </>
  );
}

function DefectDrawer({
  project,
  ticket: t,
  onClose,
  onAct,
}: {
  project: ProjectSummaryDto;
  ticket: DefectTicketDto;
  onClose: () => void;
  onAct: (k: TicketAction["kind"]) => void;
}) {
  const photos = t.verificationCaptures.filter((c) => c.objectKey);
  const hasActions = t.actions.assign.allowed || t.actions.verify.allowed || t.actions.reject.allowed;
  const facts: [string, React.ReactNode][] = [
    ["Contractor", t.contractorName],
    ["Location", t.location ?? "—"],
    ["Due", t.dueDate ? `${formatDateShort(t.dueDate)}${t.isOverdue ? " (overdue)" : ""}` : "No due date"],
    ["Raised", `${formatDateShort(t.createdAt)}${t.raisedByName ? ` by ${t.raisedByName}` : ""}`],
    ...(t.boqItemLabel ? ([["BoQ item", t.boqItemLabel]] as [string, React.ReactNode][]) : []),
    ...(t.sourceHandoverSubmissionId ? ([["Source", "Handover punch list"]] as [string, React.ReactNode][]) : []),
    ...(t.reopenCount > 0 ? ([["Reopened", `${t.reopenCount} time${t.reopenCount === 1 ? "" : "s"}`]] as [string, React.ReactNode][]) : []),
    ...(t.verifiedAt ? ([["Verified", `${formatDateShort(t.verifiedAt)}${t.verifiedByName ? ` by ${t.verifiedByName}` : ""}`]] as [string, React.ReactNode][]) : []),
  ];
  return (
    <Drawer onClick={(e) => e.target === e.currentTarget && onClose()} onClose={onClose} labelledBy="defect-drawer-title">
      <div className="flex shrink-0 items-start justify-between gap-3 bg-brand-navy px-5 py-4 text-white">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-white/80">{t.reference}</p>
          <h3 id="defect-drawer-title" className="text-sm font-bold">
            {t.title}
          </h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <TableBadge variant={STATUS_BADGE[t.status]}>{DEFECT_STATUS_LABELS[t.status]}</TableBadge>
          <TableBadge variant={SEVERITY_BADGE[t.severity]}>{severityLabel(t.severity)} severity</TableBadge>
          {t.isOverdue && (
            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Overdue
            </span>
          )}
        </div>
        <p className="whitespace-pre-line text-slate-700">{t.description}</p>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-slate-600">{k}</dt>
              <dd className="text-slate-900">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
        {t.verificationNotes && (
          <div>
            <p className="font-semibold text-slate-700">Verification notes</p>
            <p className="text-slate-700">{t.verificationNotes}</p>
          </div>
        )}
        {t.resolutionReason && (
          <div>
            <p className="font-semibold text-slate-700">Note</p>
            <p className="text-slate-700">{t.resolutionReason}</p>
          </div>
        )}
        {photos.length > 0 && (
          <div>
            <p className="mb-1.5 font-semibold text-slate-700">Repair photos</p>
            <div className="flex flex-wrap gap-2">
              {photos.map((c) => (
                <CapturePhoto key={c.clientCaptureId} projectId={project.id} objectKey={c.objectKey!} alt="Repair photo" className="h-20 w-20" />
              ))}
            </div>
          </div>
        )}
        {!t.actions.verify.allowed && t.actions.verify.reason && OPEN_DEFECT_STATUSES.includes(t.status) && <p className="text-slate-600">{t.actions.verify.reason}</p>}
      </div>
      {hasActions && (
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {t.actions.reject.allowed && (
            <button type="button" onClick={() => onAct("reject")} className={secondaryAction}>
              Not a defect
            </button>
          )}
          {t.actions.verify.allowed && (
            <button type="button" onClick={() => onAct("verify")} className={secondaryAction}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
            </button>
          )}
          {t.actions.assign.allowed && (
            <button
              type="button"
              onClick={() => onAct("assign")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1"
            >
              Assign
            </button>
          )}
        </div>
      )}
    </Drawer>
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
        {action.kind === "reject" && <BlockedNotice>The defect is closed as not a defect. The reason is recorded in the audit ledger.</BlockedNotice>}
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
