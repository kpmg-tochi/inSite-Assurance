import React from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";

/**
 * UBEC IRL: "Export to Excel" for the screens with a server-built .xlsx. `onDark` for a
 * StandardTable header (dark band), otherwise the light toolbar style. Disabled while the file is
 * being built.
 */
export function ExportExcelButton({ onClick, pending, onDark = false, label = "Export to Excel" }: { onClick: () => void; pending: boolean; onDark?: boolean; label?: string }) {
  const tone = onDark
    ? "border-white/30 text-white hover:bg-white/10"
    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${tone}`}
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />}
      {pending ? "Preparing…" : label}
    </button>
  );
}
