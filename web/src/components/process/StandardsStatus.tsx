import React from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { StandardsViolationItem } from "@insite/shared";
import { TableBadge } from "../table";

/** Badge for a report's standards check: passed, failed, or not checked (null). */
export function StandardsStatusBadge({ passed }: { passed: boolean | null }) {
  if (passed === true) return <TableBadge variant="success">Standards passed</TableBadge>;
  if (passed === false) return <TableBadge variant="danger">Standards failed</TableBadge>;
  return <TableBadge variant="neutral">Standards not checked</TableBadge>;
}

export function StandardsViolationList({ violations }: { violations: StandardsViolationItem[] }) {
  if (violations.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {violations.map((v, i) => (
        <li
          key={`${v.standardCode}-${i}`}
          className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
            v.severity === "CRITICAL" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <p className="font-semibold">
            <span className="font-mono">{v.standardCode}</span> {v.standardTitle} ·{" "}
            {v.severity === "CRITICAL" ? "Critical" : "Warning"}
          </p>
          <p>{v.violationSummary}</p>
          <p className="mt-0.5 text-slate-700">Required: {v.requiredRectification}</p>
        </li>
      ))}
    </ul>
  );
}

/** The standards check card in the report review drawer. */
export function StandardsCheckCard({
  passed,
  violations,
}: {
  passed: boolean | null;
  violations: StandardsViolationItem[];
}) {
  const Icon = passed === true ? ShieldCheck : passed === false ? ShieldAlert : ShieldQuestion;
  const iconCls = passed === true ? "text-emerald-600" : passed === false ? "text-rose-600" : "text-slate-400";
  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <Icon className={`w-4 h-4 ${iconCls}`} /> Standards check
        </p>
        <StandardsStatusBadge passed={passed} />
      </div>
      {passed === null && (
        <p className="text-[11px] text-slate-500">
          Not checked: the check is off, no standard applies to this item, or the rules could not decide.
        </p>
      )}
      {passed === true && <p className="text-[11px] text-slate-600">The report shows the applicable standards were met.</p>}
      <StandardsViolationList violations={violations} />
    </div>
  );
}
