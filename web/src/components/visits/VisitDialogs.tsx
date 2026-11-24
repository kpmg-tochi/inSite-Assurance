import React, { useMemo, useState } from "react";
import { VISIT_KIND_META, VisitKindEnum, type VisitDto, type VisitKind } from "@insite/shared";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import { CustomSelect } from "../common";
import { useVisitOfficersQuery } from "../../queries/visits/useVisitQueries";
import { useProjectScopeQuery } from "../../queries/scope/useScopeQueries";
import { useCancelVisitMutation, useCreateVisitMutation, useUpdateVisitMutation } from "../../mutations/visits/useVisitMutations";

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

export function CreateVisitDialog({ projectId, onClose, defaultDate }: { projectId: string; onClose: () => void; defaultDate?: string }) {
  const create = useCreateVisitMutation(projectId);
  const [visitKind, setVisitKind] = useState<VisitKind>("ROUTINE");
  const [plannedDate, setPlannedDate] = useState(defaultDate ?? "");
  const [assignees, setAssignees] = useState<Officers>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [proposed, setProposed] = useState(false);
  const adHoc = VISIT_KIND_META[visitKind].facilityRule === "PICKED";
  const blocked = !plannedDate || (!proposed && assignees.length === 0) || (adHoc && picked.length === 0);
  return (
    <ModalShell title="New visit" subtitle="Plan a visit by hand. Published visits go to their officers with a frozen form." onClose={onClose}>
      <form
        className="p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ visitKind, plannedDate, assignees, pickedFacilityIds: adHoc ? picked : [], proposed }, { onSuccess: onClose });
        }}
      >
        <CustomSelect
          label="Visit kind"
          value={visitKind}
          onChange={(v) => setVisitKind(v as VisitKind)}
          options={VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))}
        />
        <label className="block text-xs font-semibold text-slate-700">
          Date
          <input type="date" className={`${inputClass} mt-1`} value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} required />
        </label>
        {adHoc && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-700">Facilities to check</p>
            <FacilityPicker projectId={projectId} value={picked} onChange={setPicked} />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700">Officers</p>
          <OfficerPicker projectId={projectId} value={assignees} onChange={setAssignees} />
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={proposed} onChange={(e) => setProposed(e.target.checked)} /> Save as proposed (publish later)
        </label>
        <ModalActions onCancel={onClose} submitLabel={proposed ? "Propose" : "Plan and publish"} pendingLabel="Saving…" isPending={create.isPending} disabled={blocked} />
      </form>
    </ModalShell>
  );
}

export function EditVisitDialog({ projectId, visit, onClose, defaultDate }: { projectId: string; visit: VisitDto; onClose: () => void; defaultDate?: string }) {
  const update = useUpdateVisitMutation(projectId);
  const [plannedDate, setPlannedDate] = useState(defaultDate ?? visit.plannedDate);
  const [assignees, setAssignees] = useState<Officers>(visit.assignees.map((a) => ({ userId: a.userId, isLead: a.isLead })));
  const [picked, setPicked] = useState<string[]>(visit.pickedFacilityIds);
  const [note, setNote] = useState("");
  const adHoc = VISIT_KIND_META[visit.visitKind].facilityRule === "PICKED";
  const moved = plannedDate !== visit.plannedDate;
  const published = visit.status === "PLANNED";
  const needsNote = published && moved && note.trim().length < 3;
  const sameOfficers =
    assignees.length === visit.assignees.length && assignees.every((a) => visit.assignees.some((b) => b.userId === a.userId && b.isLead === a.isLead));
  const samePicked = picked.length === visit.pickedFacilityIds.length && picked.every((p) => visit.pickedFacilityIds.includes(p));
  return (
    <ModalShell
      title={`${VISIT_KIND_META[visit.visitKind].label} · ${visit.plannedDate}`}
      subtitle={published ? `Original date ${visit.originalPlannedDate}. Officers are told of any change and must confirm again.` : "Proposed visit (not published yet)."}
      onClose={onClose}
    >
      <form
        className="p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate(
            {
              visitId: visit.id,
              body: {
                ...(moved ? { plannedDate } : {}),
                ...(!sameOfficers ? { assignees } : {}),
                ...(adHoc && !samePicked ? { pickedFacilityIds: picked } : {}),
                note: note.trim() || null,
              },
            },
            { onSuccess: onClose }
          );
        }}
      >
        <label className="block text-xs font-semibold text-slate-700">
          Date
          <input type="date" className={`${inputClass} mt-1`} value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} required />
        </label>
        {published && moved && (
          <label className="block text-xs font-semibold text-slate-700">
            Why it moves
            <input className={`${inputClass} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Told to the officers" />
          </label>
        )}
        {adHoc && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-700">Facilities to check</p>
            <FacilityPicker projectId={projectId} value={picked} onChange={setPicked} />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700">Officers</p>
          <OfficerPicker projectId={projectId} value={assignees} onChange={setAssignees} />
        </div>
        <ModalActions
          onCancel={onClose}
          submitLabel="Save"
          pendingLabel="Saving…"
          isPending={update.isPending}
          disabled={needsNote || (!moved && sameOfficers && samePicked) || (published && assignees.length === 0)}
        />
      </form>
    </ModalShell>
  );
}

export function CancelVisitDialog({ projectId, visit, onClose }: { projectId: string; visit: VisitDto; onClose: () => void }) {
  const cancel = useCancelVisitMutation(projectId);
  const [reason, setReason] = useState("");
  return (
    <ModalShell title="Cancel visit" subtitle={`${VISIT_KIND_META[visit.visitKind].label} · ${visit.plannedDate}`} onClose={onClose}>
      <form
        className="p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          cancel.mutate({ visitId: visit.id, body: { reason: reason.trim() } }, { onSuccess: onClose });
        }}
      >
        <label className="block text-xs font-semibold text-slate-700">
          Reason
          <input className={`${inputClass} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Told to the officers" />
        </label>
        <ModalActions onCancel={onClose} submitLabel="Cancel visit" pendingLabel="Cancelling…" isPending={cancel.isPending} disabled={reason.trim().length < 3} />
      </form>
    </ModalShell>
  );
}
