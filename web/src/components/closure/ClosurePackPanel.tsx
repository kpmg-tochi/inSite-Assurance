import React from "react";
import { Archive, Download } from "lucide-react";
import type { ClosurePackExportDto } from "@insite/shared";
import Loader from "../Loader";
import { StatusText, type StatusTone } from "../common/StatusText";
import { useClosurePacksQuery } from "../../queries/closure/useClosureQueries";
import { useRequestClosurePackMutation } from "../../mutations/closure/useClosureMutations";
import { useOpenDocumentMutation } from "../../mutations/contracts/useContractMutations";
import { linkAction, panelClass, secondaryAction } from "./closureUi";

const STATUS: Record<ClosurePackExportDto["status"], { label: string; tone: StatusTone }> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Building", tone: "pending" },
  DONE: { label: "Ready", tone: "good" },
  FAILED: { label: "Failed", tone: "bad" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Phase 15: export the closure pack (ZIP) and download earlier ones from the register. */
export function ClosurePackPanel({ projectId }: { projectId: string }) {
  const query = useClosurePacksQuery(projectId);
  const request = useRequestClosurePackMutation(projectId);
  const open = useOpenDocumentMutation(projectId);
  const busy = query.data?.some((e) => e.status === "QUEUED" || e.status === "RUNNING") ?? false;
  return (
    <section className={`${panelClass} space-y-3`} aria-labelledby="closure-file-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="closure-file-heading" className="text-sm font-bold text-slate-900">
              Project closure file
            </h2>
            <p
              className="text-xs text-slate-600"
              title="Index, every current document, the certificates, the payment record, monitoring visit summaries and the audit ledger with its chain verification. Filed in the register as a closure file."
            >
              A ZIP for audit: documents, certificates, payments, monitoring visits and the verified audit ledger.
            </p>
          </div>
        </div>
        <button type="button" disabled={busy || request.isPending} onClick={() => request.mutate()} className={`${secondaryAction} self-start`}>
          {busy ? "Building…" : "Export the project closure file"}
        </button>
      </div>
      {query.isLoading && <Loader />}
      {query.isError && <p className="text-xs text-rose-700">Earlier project closure files could not be loaded.</p>}
      {query.data && query.data.length === 0 && <p className="text-xs text-slate-600">No project closure file has been exported yet.</p>}
      {query.data && query.data.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {query.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusText label={STATUS[e.status].label} tone={STATUS[e.status].tone} />
                <span className="text-slate-700">
                  {fmt(e.createdAt)} by {e.requestedByName ?? "—"}
                </span>
                {e.status === "DONE" && (
                  <span className="text-slate-600">
                    {e.entryCount} files · {((e.byteSize ?? 0) / 1024 / 1024).toFixed(1)} MB ·{" "}
                    <span className={e.chainVerified ? "text-emerald-700" : "font-semibold text-rose-700"}>audit chain {e.chainVerified ? "verified" : "NOT verified"}</span>
                  </span>
                )}
                {e.status === "FAILED" && <span className="text-rose-700">{e.error}</span>}
              </div>
              {e.documentId && (
                <button type="button" onClick={() => open.mutate({ documentId: e.documentId! })} className={linkAction}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
