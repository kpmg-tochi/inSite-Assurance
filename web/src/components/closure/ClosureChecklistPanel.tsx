import React, { useState } from "react";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import {
  WaiveClosureItemRequestSchema,
  type ClosureChecklistItemDto,
  type ClosureChecklistList,
  type ProjectClosureChecklistDto,
} from "@insite/shared";
import { z } from "zod";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import { useCompleteClosureItemMutation, useWaiveClosureItemMutation } from "../../mutations/closure/useClosureMutations";
import { primaryAction, secondaryAction } from "./closureUi";

/** Which gate an item holds (the server's two lists). */
const LIST_LABEL: Record<ClosureChecklistList, string> = {
  BEFORE_CLOSE: "Before closing",
  BEFORE_ARCHIVE: "Before archiving",
};

type Group = "AUTOMATIC" | "MANUAL" | "AUDIT";
const GROUPS: { id: Group; title: string; help: string }[] = [
  { id: "AUTOMATIC", title: "Checked by the platform", help: "Ticked as soon as the record exists." },
  { id: "MANUAL", title: "Confirmed by a person", help: "Mark done once confirmed, or waive with a reason." },
  { id: "AUDIT", title: "Audit sign-off", help: "Signed off by audit. Cannot be waived." },
];
const groupOf = (item: ClosureChecklistItemDto): Group => (item.kind === "AUDIT_SIGNOFF" ? "AUDIT" : item.automatic ? "AUTOMATIC" : "MANUAL");

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

/**
 * Phase 15: the closure checklist with live evaluation and the manual actions. Design round
 * 2026-11-26: items grouped by who completes them (the platform, a person, audit); each item says
 * which gate it holds (before closing / before archiving). The gate progress is in the tab's header.
 */
export function ClosureChecklistPanel({ projectId, checklist }: { projectId: string; checklist: ProjectClosureChecklistDto }) {
  const items = [...checklist.beforeClose, ...checklist.beforeArchive];
  if (items.length === 0) {
    return <p className="text-xs text-slate-600">This project's type has no closure checklist.</p>;
  }
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const groupItems = items.filter((i) => groupOf(i) === g.id);
        if (groupItems.length === 0) return null;
        const done = groupItems.filter((i) => i.status !== "PENDING").length;
        return (
          <div key={g.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.title}{" "}
                <span className="font-normal normal-case tracking-normal text-slate-600">
                  · {done} of {groupItems.length} done
                </span>
              </h3>
              <p className="text-[11px] text-slate-600">{g.help}</p>
            </div>
            <ul className="mt-1 divide-y divide-slate-100">
              {groupItems.map((item) => (
                <ItemRow key={`${item.list}-${item.key}`} projectId={projectId} item={item} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ItemRow({ projectId, item }: { projectId: string; item: ClosureChecklistItemDto }) {
  const [modal, setModal] = useState<"complete" | "waive" | null>(null);
  const Icon = item.status === "DONE" ? CheckCircle2 : item.status === "WAIVED" ? MinusCircle : Circle;
  const color = item.status === "DONE" ? "text-emerald-600" : item.status === "WAIVED" ? "text-sky-700" : "text-slate-400";
  const stateWord = item.status === "DONE" ? "Done" : item.status === "WAIVED" ? "Waived" : "Open";
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900">
            <span className="sr-only">{stateWord}: </span>
            {item.label}
            <span className="ml-2 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{LIST_LABEL[item.list]}</span>
          </p>
          {item.status === "WAIVED" ? (
            <p className="text-[11px] text-sky-900">
              Waived by {item.completedByName ?? "—"}: {item.waivedReason}
            </p>
          ) : item.status === "DONE" && item.completedAt ? (
            <p className="text-[11px] text-slate-600">
              Done {fmt(item.completedAt)}
              {item.completedByName ? ` by ${item.completedByName}` : ""}
              {item.notes && !item.automatic ? `: ${item.notes}` : ""}
            </p>
          ) : (
            item.detail && <p className="text-[11px] text-slate-600">{item.detail}</p>
          )}
        </div>
      </div>
      {(item.canComplete || item.canWaive) && (
        <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">
          {item.canWaive && (
            <button type="button" onClick={() => setModal("waive")} className={secondaryAction}>
              Waive
            </button>
          )}
          {item.canComplete && (
            <button type="button" onClick={() => setModal("complete")} className={primaryAction}>
              {item.kind === "AUDIT_SIGNOFF" ? "Sign off" : "Mark done"}
            </button>
          )}
        </div>
      )}
      {modal && <ItemModal projectId={projectId} item={item} mode={modal} onClose={() => setModal(null)} />}
    </li>
  );
}

/** Waive: WaiveClosureItemRequestSchema (a reason of at least 5 characters). Mark done: optional notes. */
const ItemFormSchema = z
  .object({
    mode: z.enum(["complete", "waive"]),
    text: z.string().trim().max(1000, "Too long (at most 1000 characters)"),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== "waive") return;
    const reason = WaiveClosureItemRequestSchema.shape.reason.safeParse(v.text);
    if (!reason.success) ctx.addIssue({ code: "custom", path: ["text"], message: `${reason.error.issues[0]?.message ?? "Say why the item is waived"} (at least 5 characters)` });
  });

function ItemModal({ projectId, item, mode, onClose }: { projectId: string; item: ClosureChecklistItemDto; mode: "complete" | "waive"; onClose: () => void }) {
  const complete = useCompleteClosureItemMutation(projectId);
  const waive = useWaiveClosureItemMutation(projectId);
  const form = useZodForm(ItemFormSchema, { defaultValues: { mode, text: "" } });
  const pending = complete.isPending || waive.isPending;
  return (
    <ModalShell title={mode === "waive" ? `Waive "${item.label}"` : item.kind === "AUDIT_SIGNOFF" ? "Audit sign-off" : `Mark "${item.label}" done`} onClose={onClose} maxWidth="max-w-md">
      <form
        className="space-y-3 p-5"
        noValidate
        onSubmit={form.handleSubmit(({ text }) => {
          if (mode === "waive") waive.mutate({ list: item.list, itemKey: item.key, reason: text }, { onSuccess: onClose });
          else complete.mutate({ list: item.list, itemKey: item.key, notes: text || null }, { onSuccess: onClose });
        })}
      >
        <textarea
          rows={3}
          className={`${inputClass} ${invalidClass(form, "text")}`}
          aria-label={mode === "waive" ? "Reason for waiving" : "Notes"}
          placeholder={mode === "waive" ? "Why is it waived? (recorded in the audit ledger)" : "Notes (optional)"}
          maxLength={1000}
          {...form.register("text")}
          {...fieldA11y(form, "text")}
        />
        <FieldError form={form} name="text" />
        <ModalActions
          onCancel={onClose}
          submitLabel={mode === "waive" ? "Waive item" : item.kind === "AUDIT_SIGNOFF" ? "Sign off" : "Mark done"}
          pendingLabel="Saving…"
          isPending={pending}
          disabled={!canSubmit(form, { pending })}
        />
      </form>
    </ModalShell>
  );
}
