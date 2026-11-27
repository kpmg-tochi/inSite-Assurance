import React, { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { SetCommitteeRequestSchema, type NeedsCommitteeDto } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { SubmitButton, useZodForm } from "../../../lib/forms";
import { useAuth } from "../../../lib/auth-context";
import { useSetCommitteeMutation } from "../../../mutations/needs/useCommitteeMutations";
import { inputCls, labelCls } from "../needsUi";

/**
 * D1: the chair sets the committee. The person saving is the chair (one CHAIR row); members are
 * picked from the owning organisation's people who hold the scoring permission (`candidates`).
 */
export function EditCommitteeDialog({ cycleId, committee, onClose }: { cycleId: string; committee: NeedsCommitteeDto; onClose: () => void }) {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const save = useSetCommitteeMutation(cycleId);
  const [filter, setFilter] = useState("");

  const initial = useMemo(
    () => [
      { userId: myId, role: "CHAIR" as const },
      ...committee.members.filter((m) => m.userId !== myId).map((m) => ({ userId: m.userId, role: "MEMBER" as const })),
    ],
    [committee.members, myId]
  );
  const form = useZodForm(SetCommitteeRequestSchema, { defaultValues: { members: initial } });
  const members = form.watch("members");
  const selected = new Set(members.filter((m) => m.role === "MEMBER").map((m) => m.userId));

  const candidates = committee.candidates.filter((c) => c.userId !== myId);
  // People already on the committee who are no longer candidates stay listed so they can be removed.
  const extra = committee.members
    .filter((m) => m.userId !== myId && !committee.candidates.some((c) => c.userId === m.userId))
    .map((m) => ({ userId: m.userId, fullName: m.fullName, roleName: m.roleName, canScore: false, canChair: false }));
  const people = [...candidates, ...extra].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const q = filter.trim().toLowerCase();
  const shown = q ? people.filter((p) => `${p.fullName} ${p.roleName}`.toLowerCase().includes(q)) : people;

  const toggle = (userId: string, on: boolean) => {
    const others = members.filter((m) => m.userId !== userId);
    form.setValue("members", on ? [...others, { userId, role: "MEMBER" }] : others, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
  };

  const submit = form.handleSubmit((values) => save.mutate(values, { onSuccess: () => onClose() }));

  return (
    <ModalShell title="Edit committee" subtitle="You chair the committee. Members score the proposed projects independently." onClose={onClose} maxWidth="max-w-2xl">
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <div className="flex items-center gap-2 rounded-xl border border-brand-primary/20 bg-brand-primary/5 p-3 text-xs text-slate-800">
          <ShieldCheck className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
          <span>
            <span className="font-semibold">{user?.fullName ?? "You"}</span> · Chair
          </span>
        </div>

        <fieldset>
          <legend className={labelCls}>Members</legend>
          {people.length > 6 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <input className={`${inputCls} pl-8`} placeholder="Search by name or role" aria-label="Search people" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          {people.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-600">
              Nobody else in the owning organisation holds the scoring permission. Give the committee members a role with it first.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {shown.map((p) => {
                const checked = selected.has(p.userId);
                const disabled = !p.canScore && !checked;
                return (
                  <label key={p.userId} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${disabled ? "text-slate-400" : "text-slate-800 hover:bg-slate-50"}`}>
                    <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => toggle(p.userId, e.target.checked)} />
                    <span>
                      <span className="font-semibold">{p.fullName}</span> · {p.roleName}
                      {!p.canScore && <span className="block text-[11px] text-slate-500">Does not hold the scoring permission</span>}
                    </span>
                  </label>
                );
              })}
              {shown.length === 0 && <p className="p-2 text-xs text-slate-500">Nobody matches the search.</p>}
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-500">
            {selected.size} {selected.size === 1 ? "member" : "members"} selected. Every member declares conflicts of interest before scoring opens.
          </p>
        </fieldset>

        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={save.isPending} pendingLabel="Saving…" blocked={!myId}>
            Save committee
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
