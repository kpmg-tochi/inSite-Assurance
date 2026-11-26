import React from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import type { ScopeWorkbookIssue } from "@insite/shared";

/** The needs assessment file limit (the server accepts about 11 MB of base64 more than that). */
export const NEEDS_ASSESSMENT_MAX_BYTES = 10 * 1024 * 1024;

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** Row errors (confirm refused) or warnings, as the in-project import shows them. */
export function IssueList({ items, tone }: { items: ScopeWorkbookIssue[]; tone: "error" | "warning" }) {
  if (items.length === 0) return null;
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900";
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`} role={tone === "error" ? "alert" : "note"}>
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <Icon className="w-4 h-4" aria-hidden="true" />{" "}
        {items.length} {tone === "error" ? "error(s): fix them in the file and upload it again" : "warning(s)"}
      </p>
      <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5 text-[11px]">
        {items.map((i, n) => (
          <li key={`${i.sheet}-${i.row}-${i.code}-${n}`}>
            <span className="font-semibold">{i.sheet || "File"}</span>
            {i.row ? ` row ${i.row}` : ""}
            {i.column ? ` · ${i.column}` : ""}: {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone === "warning" ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className={`text-[10px] ${tone === "warning" ? "text-amber-800" : "text-slate-500"}`}>{hint}</p>}
    </div>
  );
}
