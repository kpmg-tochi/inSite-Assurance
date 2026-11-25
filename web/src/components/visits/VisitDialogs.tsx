import { useEffect, useMemo } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { CancelVisitRequestSchema, CreateVisitRequestSchema, VISIT_KIND_META, VisitKindEnum, type VisitDto, type VisitKind } from "@insite/shared";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import { CustomSelect } from "../common";
import { FieldError, SubmitButton, canSubmit, fieldA11y, invalidClass, useZodForm, zDateText } from "../../lib/forms";
import { useVisitOfficersQuery } from "../../queries/visits/useVisitQueries";
import { useProjectScopeQuery } from "../../queries/scope/useScopeQueries";
import { useCancelVisitMutation, useCreateVisitMutation, useDecideProposalMutation, useUpdateVisitMutation } from "../../mutations/visits/useVisitMutations";

/** Redesign R4: create, edit (move, reassign, facilities) and cancel dialogs for a visit. */

type Officers = Array<{ userId: string; isLead: boolean }>;

function OfficerPicker({ projectId, value, onChange }: { projectId: string; value: Officers; onChange: (v: Officers) => void }) {
  const q = useVisitOfficersQuery(projectId);
  const candidates = q.data?.candidates ?? [];
  const selected = new Set(value.map((v) => v.userId));
  const toggle = (userId: string) => {
    if (selected.has(userId)) {
      const rest = value.filter((v) => v.userId !== userId);
      onChange(rest.length && !rest.some((r) => r.isLead) ? rest.map((r, i) => ({ ...r, isLead: i === 0 })) : rest);
    } else {
      onChange([...value, { userId, isLead: value.length === 0 }]);
    }
  };
  if (q.isLoading) return <p className="text-[11px] text-slate-500">Loading officers…</p>;
  if (candidates.length === 0) return <p className="text-[11px] text-slate-500">No one in this workspace has a field role that can carry out visits.</p>;
  return (
    <div className="space-y-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 p-2">
      {candidates.map((c) => {
        const on = selected.has(c.userId);
        const lead = value.find((v) => v.userId === c.userId)?.isLead ?? false;
        return (
          <div key={c.userId} className="flex items-center justify-between gap-2 text-xs">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={on} onChange={() => toggle(c.userId)} />
              <span className="font-medium text-slate-800">{c.fullName}</span>
              <span className="text-[11px] text-slate-500">
                {c.roleName}
                {c.onProject ? "" : " · not on the project yet (added when saved)"}
              </span>
            </label>
            {on && (
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                <input type="radio" name="lead" checked={lead} onChange={() => onChange(value.map((v) => ({ ...v, isLead: v.userId === c.userId })))} /> Lead
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FacilityPicker({ projectId, value, onChange }: { projectId: string; value: string[]; onChange: (v: string[]) => void }) {
  const scope = useProjectScopeQuery(projectId);
  const facilities = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of scope.data?.units ?? []) map.set(u.facility.id, u.facility.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [scope.data]);
  return (
    <div className="flex flex-wrap gap-2">
      {facilities.map((f) => (
        <label key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs">
          <input type="checkbox" checked={value.includes(f.id)} onChange={(e) => onChange(e.target.checked ? [...value, f.id] : value.filter((x) => x !== f.id))} />
          {f.name}
        </label>
      ))}
      {facilities.length === 0 && <p className="text-[11px] text-slate-500">The project has no facility units.</p>}
    </div>
  );
}

const OfficersField = z.array(z.object({ userId: z.string(), isLead: z.boolean() }));

const CreateVisitFormSchema = z
  .object({
    visitKind: VisitKindEnum,
    plannedDate: zDateText("Date"),
    assignees: OfficersField,
    pickedFacilityIds: z.array(z.string()),
    proposed: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.proposed && v.assignees.length === 0) {
      ctx.addIssue({ code: "custom", path: ["assignees"], message: "Pick at least one officer to publish the visit, or save it as proposed" });
    }
    if (VISIT_KIND_META[v.visitKind].facilityRule === "PICKED" && v.pickedFacilityIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["pickedFacilityIds"], message: "Pick at least one facility to check" });
    }
  })
  .transform((v) => ({ ...v, pickedFacilityIds: VISIT_KIND_META[v.visitKind].facilityRule === "PICKED" ? v.pickedFacilityIds : [] }))
  .pipe(CreateVisitRequestSchema);

export function CreateVisitDialog({ projectId, onClose, defaultDate }: { projectId: string; onClose: () => void; defaultDate?: string }) {
  const create = useCreateVisitMutation(projectId);
  const form = useZodForm(CreateVisitFormSchema, {
    defaultValues: { visitKind: "ROUTINE", plannedDate: defaultDate ?? "", assignees: [], pickedFacilityIds: [], proposed: false },
  });
  const adHoc = VISIT_KIND_META[form.watch("visitKind")].facilityRule === "PICKED";
  const proposed = form.watch("proposed");
  // These switch rules on or off for other fields: re-check them so their messages stay current.
  useEffect(() => {
    void form.trigger(["assignees", "pickedFacilityIds"]);
  }, [form, proposed, adHoc]);
  return (
    <ModalShell title="New visit" subtitle="Plan a visit by hand. Published visits go to their officers with a frozen form." onClose={onClose}>
      <form className="p-5 space-y-3" noValidate onSubmit={form.handleSubmit((body) => create.mutate(body, { onSuccess: onClose }))}>
        <Controller
          control={form.control}
          name="visitKind"
          render={({ field }) => (
            <CustomSelect
              label="Visit kind"
              value={field.value}
              onChange={(v) => field.onChange(v as VisitKind)}
              options={VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))}
            />
          )}
        />
        <label className="block text-xs font-semibold text-slate-700">
          Date
          <input type="date" className={`${inputClass} mt-1 ${invalidClass(form, "plannedDate")}`} {...form.register("plannedDate")} {...fieldA11y(form, "plannedDate")} />
        </label>
        <FieldError form={form} name="plannedDate" />
        {adHoc && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-700">Facilities to check</p>
            <Controller
              control={form.control}
              name="pickedFacilityIds"
              render={({ field }) => (
                <FacilityPicker
                  projectId={projectId}
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    field.onBlur();
                  }}
                />
              )}
            />
            <FieldError form={form} name="pickedFacilityIds" />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700">Officers</p>
          <Controller
            control={form.control}
            name="assignees"
            render={({ field }) => (
              <OfficerPicker
                projectId={projectId}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  field.onBlur();
                }}
              />
            )}
          />
          <FieldError form={form} name="assignees" />
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" {...form.register("proposed")} /> Save as proposed (publish later)
        </label>
        <ModalActions
          onCancel={onClose}
          submitLabel={proposed ? "Propose" : "Plan and publish"}
          pendingLabel="Saving…"
          isPending={create.isPending}
          disabled={!canSubmit(form, { pending: create.isPending })}
        />
      </form>
    </ModalShell>
  );
}

export function EditVisitDialog({ projectId, visit, onClose, defaultDate }: { projectId: string; visit: VisitDto; onClose: () => void; defaultDate?: string }) {
  const update = useUpdateVisitMutation(projectId);
  const adHoc = VISIT_KIND_META[visit.visitKind].facilityRule === "PICKED";
  const published = visit.status === "PLANNED";
  const schema = z
    .object({
      plannedDate: zDateText("Date"),
      note: z.string().trim().max(1000, "Too long (at most 1000 characters)"),
      assignees: OfficersField,
      pickedFacilityIds: z.array(z.string()),
    })
    .superRefine((v, ctx) => {
      if (published && v.plannedDate !== visit.plannedDate && v.note.length < 3) {
        ctx.addIssue({ code: "custom", path: ["note"], message: "Say why the visit moves (at least 3 characters)" });
      }
      if (published && v.assignees.length === 0) ctx.addIssue({ code: "custom", path: ["assignees"], message: "A published visit needs at least one officer" });
      if (adHoc && v.pickedFacilityIds.length === 0) ctx.addIssue({ code: "custom", path: ["pickedFacilityIds"], message: "Pick at least one facility to check" });
    });
  const form = useZodForm(schema, {
    defaultValues: {
      plannedDate: defaultDate ?? visit.plannedDate,
      note: "",
      assignees: visit.assignees.map((a) => ({ userId: a.userId, isLead: a.isLead })),
      pickedFacilityIds: visit.pickedFacilityIds,
    },
  });
  const plannedDate = form.watch("plannedDate");
  const assignees = form.watch("assignees");
  const picked = form.watch("pickedFacilityIds");
  const moved = plannedDate !== visit.plannedDate;
  // Moving the date can make the note required (or not): re-check it.
  useEffect(() => {
    void form.trigger("note");
  }, [form, moved]);
  const sameOfficers =
    assignees.length === visit.assignees.length && assignees.every((a) => visit.assignees.some((b) => b.userId === a.userId && b.isLead === a.isLead));
  const samePicked = picked.length === visit.pickedFacilityIds.length && picked.every((p) => visit.pickedFacilityIds.includes(p));
  const unchanged = !moved && sameOfficers && samePicked;
  return (
    <ModalShell
      title={`${VISIT_KIND_META[visit.visitKind].label} · ${visit.plannedDate}`}
      subtitle={published ? `Original date ${visit.originalPlannedDate}. Officers are told of any change and must confirm again.` : "Proposed visit (not published yet)."}
      onClose={onClose}
    >
      <form
        className="p-5 space-y-3"
        noValidate
        onSubmit={form.handleSubmit((v) =>
          update.mutate(
            {
              visitId: visit.id,
              body: {
                ...(moved ? { plannedDate: v.plannedDate } : {}),
                ...(!sameOfficers ? { assignees: v.assignees } : {}),
                ...(adHoc && !samePicked ? { pickedFacilityIds: v.pickedFacilityIds } : {}),
                note: v.note || null,
              },
            },
            { onSuccess: onClose }
          )
        )}
      >
        <label className="block text-xs font-semibold text-slate-700">
          Date
          <input type="date" className={`${inputClass} mt-1 ${invalidClass(form, "plannedDate")}`} {...form.register("plannedDate")} {...fieldA11y(form, "plannedDate")} />
        </label>
        <FieldError form={form} name="plannedDate" />
        {published && moved && (
          <>
            <label className="block text-xs font-semibold text-slate-700">
              Why it moves
              <input className={`${inputClass} mt-1 ${invalidClass(form, "note")}`} placeholder="Told to the officers" {...form.register("note")} {...fieldA11y(form, "note")} />
            </label>
            <FieldError form={form} name="note" />
          </>
        )}
        {adHoc && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-700">Facilities to check</p>
            <Controller
              control={form.control}
              name="pickedFacilityIds"
              render={({ field }) => (
                <FacilityPicker
                  projectId={projectId}
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    field.onBlur();
                  }}
                />
              )}
            />
            <FieldError form={form} name="pickedFacilityIds" />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700">Officers</p>
          <Controller
            control={form.control}
            name="assignees"
            render={({ field }) => (
              <OfficerPicker
                projectId={projectId}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  field.onBlur();
                }}
              />
            )}
          />
          <FieldError form={form} name="assignees" />
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Save"
          pendingLabel="Saving…"
          isPending={update.isPending}
          disabled={!canSubmit(form, { pending: update.isPending, blocked: unchanged })}
        />
      </form>
    </ModalShell>
  );
}

const RejectProposalFormSchema = z.object({
  note: z.string().trim().min(3, "Say why the date stays (at least 3 characters)").max(1000, "Too long (at most 1000 characters)"),
});

/**
 * Accept an officer's date proposal, or reject it with a note (required). Used by the visit drawer
 * and the planner's side panel.
 */
export function ProposalDecisionForm({
  projectId,
  visitId,
  changeId,
  acceptLabel,
  placeholder,
  inputClassName,
  className,
  acceptClassName,
  rejectClassName,
}: {
  projectId: string;
  visitId: string;
  changeId: string;
  acceptLabel: string;
  placeholder: string;
  inputClassName: string;
  className: string;
  acceptClassName: string;
  rejectClassName: string;
}) {
  const decide = useDecideProposalMutation(projectId);
  const form = useZodForm(RejectProposalFormSchema, { defaultValues: { note: "" } });
  return (
    <form
      className={className}
      noValidate
      onSubmit={form.handleSubmit((v) => decide.mutate({ visitId, changeId, body: { decision: "REJECT", note: v.note } }))}
    >
      <button
        type="button"
        className={acceptClassName}
        disabled={decide.isPending}
        onClick={() => decide.mutate({ visitId, changeId, body: { decision: "ACCEPT" } })}
      >
        {acceptLabel}
      </button>
      <span className="flex-1 min-w-[6rem]">
        <input className={`w-full ${inputClassName} ${invalidClass(form, "note")}`} placeholder={placeholder} aria-label="Reject note" {...form.register("note")} {...fieldA11y(form, "note")} />
        <FieldError form={form} name="note" />
      </span>
      <SubmitButton form={form} pending={decide.isPending} showHint={false} className={rejectClassName}>
        Reject
      </SubmitButton>
    </form>
  );
}

export function CancelVisitDialog({ projectId, visit, onClose }: { projectId: string; visit: VisitDto; onClose: () => void }) {
  const cancel = useCancelVisitMutation(projectId);
  const form = useZodForm(CancelVisitRequestSchema, { defaultValues: { reason: "" } });
  return (
    <ModalShell title="Cancel visit" subtitle={`${VISIT_KIND_META[visit.visitKind].label} · ${visit.plannedDate}`} onClose={onClose}>
      <form className="p-5 space-y-3" noValidate onSubmit={form.handleSubmit((body) => cancel.mutate({ visitId: visit.id, body }, { onSuccess: onClose }))}>
        <label className="block text-xs font-semibold text-slate-700">
          Reason
          <input className={`${inputClass} mt-1 ${invalidClass(form, "reason")}`} placeholder="Told to the officers" {...form.register("reason")} {...fieldA11y(form, "reason")} />
        </label>
        <FieldError form={form} name="reason" />
        <ModalActions
          onCancel={onClose}
          submitLabel="Cancel visit"
          pendingLabel="Cancelling…"
          isPending={cancel.isPending}
          disabled={!canSubmit(form, { pending: cancel.isPending })}
        />
      </form>
    </ModalShell>
  );
}
