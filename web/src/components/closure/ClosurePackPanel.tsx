import React from "react";
import { Archive, Download } from "lucide-react";
import type { ClosurePackExportDto } from "@insite/shared";
import Loader from "../Loader";
import { StatusChip } from "../contracts/contractUi";
import { useClosurePacksQuery } from "../../queries/closure/useClosureQueries";
import { useRequestClosurePackMutation } from "../../mutations/closure/useClosureMutations";
import { useOpenDocumentMutation } from "../../mutations/contracts/useContractMutations";

const STATUS: Record<ClosurePackExportDto["status"], { label: string; cls: string }> = {
  QUEUED: { label: "Queued", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  RUNNING: { label: "Building", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  DONE: { label: "Ready", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  FAILED: { label: "Failed", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Phase 15: export the closure pack (ZIP) and download earlier ones from the register. */
export function ClosurePackPanel({ projectId }: { projectId: string }) {
  const query = useClosurePacksQuery(projectId);
  const request = useRequestClosurePackMutation(projectId);
  const open = useOpenDocumentMutation(projectId);
  const busy = query.data?.some((e) => e.status === "QUEUED" || e.status === "RUNNING") ?? false;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Archive className="mt-0.5 h-4 w-4 text-brand-primary" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">Closure pack</h2>
            <p className="text-[11px] text-slate-500">
              A ZIP for audit: index, every current document, the certificates, the payment record, visit summaries and the audit ledger with its
              chain verification. Filed in the register as a closure file.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || request.isPending}
          onClick={() => request.mutate()}
          className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Building…" : "Export closure pack"}
        </button>
      </div>
      {query.isLoading && <Loader />}
      {query.data && query.data.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {query.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip label={STATUS[e.status].label} cls={STATUS[e.status].cls} />
                <span className="text-slate-700">
                  {fmt(e.createdAt)} by {e.requestedByName ?? "—"}
                </span>
                {e.status === "DONE" && (
                  <span className="text-slate-500">
                    {e.entryCount} files · {((e.byteSize ?? 0) / 1024 / 1024).toFixed(1)} MB ·{" "}
                    <span className={e.chainVerified ? "text-emerald-700" : "text-rose-700"}>audit chain {e.chainVerified ? "verified" : "NOT verified"}</span>
                  </span>
                )}
                {e.status === "FAILED" && <span className="text-rose-700">{e.error}</span>}
              </div>
              {e.documentId && (
                <button
                  type="button"
                  onClick={() => open.mutate({ documentId: e.documentId! })}
                  className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
