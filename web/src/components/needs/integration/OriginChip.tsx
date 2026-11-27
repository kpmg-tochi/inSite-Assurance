import React from "react";
import { CalendarX2 } from "lucide-react";
import { PROJECT_ORIGIN_LABELS } from "@insite/shared";

/**
 * Needs pipeline wave 4 (D-N.13): "Outside annual cycle" on a project approved through the
 * out-of-cycle route (portfolio and directory rows, the Overview's Origin card). Icon plus label.
 */
export function OutsideCycleChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ${className}`}
    >
      <CalendarX2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      {PROJECT_ORIGIN_LABELS.OUT_OF_CYCLE}
    </span>
  );
}
