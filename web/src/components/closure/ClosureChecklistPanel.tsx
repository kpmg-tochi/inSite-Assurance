import React, { useState } from "react";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import {
  CLOSURE_ITEM_KIND_META,
  type ClosureChecklistItemDto,
  type ClosureChecklistList,
  type ProjectClosureChecklistDto,
} from "@insite/shared";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import { useCompleteClosureItemMutation, useWaiveClosureItemMutation } from "../../mutations/closure/useClosureMutations";

const LIST_META: Record<ClosureChecklistList, { title: string; gate: string }> = {
  BEFORE_CLOSE: { title: "Before closing", gate: "The project cannot be closed while one of these is open." },
  BEFORE_ARCHIVE: { title: "Before archiving", gate: "The project cannot be archived while one of these is open." },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

/** Phase 15: the two closure lists with progress, live evaluation and the manual actions. */
export function ClosureChecklistPanel({ projectId, checklist }: { projectId: string; checklist: ProjectClosureChecklistDto }) {
  const lists: Array<[ClosureChecklistList, ClosureChecklistItemDto[]]> = [
    ["BEFORE_CLOSE", checklist.beforeClose],
    ["BEFORE_ARCHIVE", checklist.beforeArchive],
  ];
  if (checklist.beforeClose.length === 0 && checklist.beforeArchive.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500">
        This project's type has no closure checklist.
      </section>
    );
  }
  return (
    <section className="space-y-4">
      {!checklist.generated && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          The checklist starts when the project enters handover. Items that the platform checks already show their state.
        </div>
      )}
      {lists.map(([list, items]) =>
        items.length === 0 ? null : (
          <div key={list} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">{LIST_META[list].title}</h2>
                <p className="text-[11px] text-slate-500">{LIST_META[list].gate}</p>
              </div>
              <Progress done={checklist.progress[list === "BEFORE_CLOSE" ? "beforeClose" : "beforeArchive"].done} total={items.length} />
            </div>
            <ul className="mt-3 divide-y divide-slate-100">
              {items.map((item) => (
                <ItemRow key={item.key} projectId={projectId} item={item} />
              ))}
            </ul>
          </div>
        )
      )}
    </section>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
      </div>
      {done} of {total}
    </div>
  );
}

function ItemRow({ projectId, item }: { projectId: string; item: ClosureChecklistItemDto }) {
  const [modal, setModal] = useState<"complete" | "waive" | null>(null);
  const Icon = item.status === "DONE" ? CheckCircle2 : item.status === "WAIVED" ? MinusCircle : Circle;
  const color = item.status === "DONE" ? "text-emerald-600" : item.status === "WAIVED" ? "text-sky-600" : "text-slate-300";
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-900">{item.label}</div>
          <div className="text-[11px] text-slate-500">
            {CLOSURE_ITEM_KIND_META[item.kind].label}
            {item.detail ? ` · ${item.detail}` : ""}
          </div>
          {item.status === "WAIVED" && <div className="text-[11px] text-sky-800">Waived by {item.completedByName ?? "—"}: {item.waivedReason}</div>}
          {item.status === "DONE" && item.completedAt && (
            <div className="text-[11px] text-slate-500">
              Done {fmt(item.completedAt)}
              {item.completedByName ? ` by ${item.completedByName}` : ""}
              {item.notes && !item.automatic ? `: ${item.notes}` : ""}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {item.canComplete && (
          <button type="button" onClick={() => setModal("complete")} className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover">
            {item.kind === "AUDIT_SIGNOFF" ? "Sign off" : "Mark done"}
          </button>
        )}
        {item.canWaive && (
          <button type="button" onClick={() => setModal("waive")} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Waive
          </button>
        )}
      </div>
      {modal && <ItemModal projectId={projectId} item={item} mode={modal} onClose={() => setModal(null)} />}
    </li>
  );
}

function ItemModal({ projectId, item, mode, onClose }: { projectId: string; item: ClosureChecklistItemDto; mode: "complete" | "waive"; onClose: () => void }) {
  const complete = useCompleteClosureItemMutation(projectId);
  const waive = useWaiveClosureItemMutation(projectId);
  const [text, setText] = useState("");
  const pending = complete.isPending || waive.isPending;
  return (
    <ModalShell title={mode === "waive" ? `Waive "${item.label}"` : item.kind === "AUDIT_SIGNOFF" ? "Audit sign-off" : `Mark "${item.label}" done`} onClose={onClose} maxWidth="max-w-md">
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "waive") waive.mutate({ list: item.list, itemKey: item.key, reason: text.trim() }, { onSuccess: onClose });
          else complete.mutate({ list: item.list, itemKey: item.key, notes: text.trim() || null }, { onSuccess: onClose });
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder={mode === "waive" ? "Why is it waived? (recorded in the audit ledger)" : "Notes (optional)"}
          required={mode === "waive"}
          minLength={mode === "waive" ? 5 : undefined}
          maxLength={1000}
        />
        <ModalActions
          onCancel={onClose}
          submitLabel={mode === "waive" ? "Waive item" : item.kind === "AUDIT_SIGNOFF" ? "Sign off" : "Mark done"}
          pendingLabel="Saving…"
          isPending={pending}
          disabled={mode === "waive" && text.trim().length < 5}
        />
      </form>
    </ModalShell>
  );
}
