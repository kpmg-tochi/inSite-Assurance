import React, { useEffect, useRef, useState } from "react";
import { Archive, X } from "lucide-react";
import { Overlay } from "../common/Overlay";
import { useArchiveProjectMutation } from "../../mutations/projects/useProjectSetupMutations";

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
  const [reason, setReason] = useState("");
  const archive = useArchiveProjectMutation(projectId);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !archive.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archive.isPending, onClose]);

  const confirm = async () => {
    await archive.mutateAsync(reason.trim() || undefined);
    onArchived?.();
    onClose();
  };

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
              Archive {codePrefix}?
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
            <li>Field staff cannot send new reports.</li>
            <li>IPCs, reports, evidence and the audit ledger stay available to read.</li>
          </ul>
        </div>
        <div>
          <label htmlFor="archive-reason" className="block text-xs font-semibold text-slate-700 mb-1">
            Reason (recorded in the audit ledger)
          </label>
          <textarea
            id="archive-reason"
            ref={reasonRef}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Works completed and final certificate issued"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={archive.isPending}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={archive.isPending}
            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {archive.isPending ? "Archiving…" : "Archive project"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
