import { Link } from "react-router-dom";
import { CONTRACTOR_FLAG_ACTION_META, formatProjectCode, type ContractorFlagDto } from "@insite/shared";
import { formatDateTimeShort } from "../../lib/formatters";
import { ActionStatusChip, FlagStatusChip } from "./flagUi";

/**
 * Client demo updates F.4: one flag as a card (contractor page): the project, the summary, the
 * reports it rests on, the latest action and "Review flag", which opens the decision drawer.
 */
export function ContractorFlagCard({ flag, onReview }: { flag: ContractorFlagDto; onReview: () => void }) {
  const latest = [...flag.actions].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
  const open = flag.status === "OPEN";
  return (
    <article
      className={`flex flex-col gap-2 rounded-xl border p-3 text-xs ${open ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white"}`}
      aria-label={`Flag on ${formatProjectCode(flag.projectCode)}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/app/projects/${flag.projectId}/dashboard`} className="min-w-0 hover:underline">
          <span className="font-semibold text-slate-900">{formatProjectCode(flag.projectCode)}</span>
          <span className="ml-1 text-slate-600">{flag.projectName}</span>
        </Link>
        <FlagStatusChip status={flag.status} />
      </div>
      <p className={open ? "font-semibold text-rose-800" : "text-slate-700"}>{flag.summary}</p>
      <p className="text-[11px] text-slate-500">
        Raised {formatDateTimeShort(flag.raisedAt)} · {flag.evidence.length} monitoring report{flag.evidence.length === 1 ? "" : "s"} ·{" "}
        {flag.actions.length} action{flag.actions.length === 1 ? "" : "s"} decided
      </p>
      {latest && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-700">
          Latest: <span className="font-semibold">{CONTRACTOR_FLAG_ACTION_META[latest.kind].label}</span>
          <ActionStatusChip status={latest.status} />
        </p>
      )}
      {!open && flag.closeReason && <p className="text-[11px] text-slate-600">Closed: {flag.closeReason}</p>}
      <div>
        <button
          type="button"
          onClick={onReview}
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
            open && flag.canDecide ? "bg-brand-primary text-white hover:bg-brand-hover" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
          }`}
        >
          {open && flag.canDecide ? "Review flag" : "View flag"}
        </button>
      </div>
    </article>
  );
}
