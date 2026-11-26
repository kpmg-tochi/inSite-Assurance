import React, { useEffect, useRef } from "react";
import { Archive, X } from "lucide-react";
import { z } from "zod";
import { formatProjectCode } from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { Overlay } from "../common/Overlay";
import { useArchiveProjectMutation } from "../../mutations/projects/useProjectSetupMutations";

/**
 * The server accepts an optional reason of up to 500 characters (`ArchiveProjectBodySchema` in
 * projects.routes.ts, not in @insite/shared); the owner requires one here (2026-11-24).
 */
const ArchiveProjectFormSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500, "The reason is too long (at most 500 characters)"),
});

/**
 * Confirms archiving an active project. Archiving is one-way from the web: the project becomes
 * read-only and disappears from mobile and portfolio views.
 */
export function ArchiveProjectDialog({
  projectId,
  projectName,
  codePrefix,
  onClose,
  onArchived,
}: {
  projectId: string;
  projectName: string;
  codePrefix: string;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const archive = useArchiveProjectMutation(projectId);
  const form = useZodForm(ArchiveProjectFormSchema, { defaultValues: { reason: "" } });
  const reasonField = form.register("reason");
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    reasonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !archive.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archive.isPending, onClose]);

  const confirm = form.handleSubmit(async ({ reason }) => {
    try {
      await archive.mutateAsync(reason);
    } catch {
      return; // toasted by the mutation hook
    }
    onArchived?.();
    onClose();
  });

  return (
    <Overlay zIndex="z-[1000]" className="flex items-center justify-center p-4" role="presentation" onClick={() => !archive.isPending && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-project-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-rose-600" />
            <h2 id="archive-project-title" className="text-sm font-bold text-slate-900">
              Archive {formatProjectCode(codePrefix)}?
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={archive.isPending} aria-label="Close">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="text-xs text-slate-600 space-y-2">
          <p>
            <span className="font-semibold text-slate-800">{projectName}</span> becomes read-only.
          </p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>It disappears from the mobile app and from the portfolio views.</li>
            <li>Field staff cannot submit new monitoring reports.</li>
            <li>Monitoring visits, documents, payments, certificates and the audit ledger stay available to read.</li>
          </ul>
        </div>
        <form onSubmit={confirm} noValidate className="space-y-4">
          <div>
            <label htmlFor="archive-reason" className="block text-xs font-semibold text-slate-700 mb-1">
              Reason (recorded in the audit ledger)
            </label>
            <textarea
              id="archive-reason"
              rows={2}
              maxLength={500}
              placeholder="e.g. Works completed and final certificate issued"
              className={`w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary ${invalidClass(form, "reason")}`}
              {...reasonField}
              ref={(el) => {
                reasonField.ref(el);
                reasonRef.current = el;
              }}
              {...fieldA11y(form, "reason")}
            />
            <FieldError form={form} name="reason" />
          </div>
          <div className="flex justify-end items-start gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={archive.isPending}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <SubmitButton
              form={form}
              pending={archive.isPending}
              pendingLabel="Archiving…"
              hint="Give a reason of at least 5 characters."
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Archive project
            </SubmitButton>
          </div>
        </form>
      </div>
    </Overlay>
  );
}
