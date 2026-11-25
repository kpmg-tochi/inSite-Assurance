import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import type { ProjectRegisterFilters } from "@insite/shared";
import { useExportProjectRegisterMutation } from "../../mutations/projects/useProjectRegisterMutations";
import type { ProjectRegisterExportFormat } from "../../api/projects/projectRegisterApi";

/**
 * UBEC IRL: "Export" on the register's title bar. Downloads the register as shown (the filters, the
 * status button and the search) as Excel or PDF. Sits on the dark table header.
 */
export function ProjectRegisterExportMenu({ filters }: { filters: ProjectRegisterFilters }) {
  const exporter = useExportProjectRegisterMutation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const pick = (format: ProjectRegisterExportFormat) => {
    setOpen(false);
    buttonRef.current?.focus();
    exporter.mutate({ format, filters });
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={exporter.isPending}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" /> {exporter.isPending ? "Exporting…" : "Export"}
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Export the project register"
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={() => pick("xlsx")}>
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" aria-hidden="true" /> Excel (.xlsx)
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={() => pick("pdf")}>
            <FileText className="w-4 h-4 text-rose-700" aria-hidden="true" /> PDF
          </button>
        </div>
      )}
    </div>
  );
}
