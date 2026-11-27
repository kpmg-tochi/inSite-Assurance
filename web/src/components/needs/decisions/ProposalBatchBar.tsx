import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { NeedsCycleDto, NeedsProposalSummaryDto, NeedsStage, ProposalBatchAction, StageOutcome } from "@insite/shared";
import { useAuth } from "../../../lib/auth-context";
import { BatchActionDialog } from "./BatchActionDialog";
import { DecisionDrawer } from "./DecisionDrawer";
import { batchOffers, cycleWritable, decisionOutcomesFor, permissionKeysOf } from "./decisionUi";

type Picked = { id: string; reference: string; title: string };

/**
 * Needs pipeline wave 3 (C1, D-N.4): the bar shown while proposed projects are selected. It offers
 * only what every selected proposal allows (worked out per row from its stage and status, the cycle's
 * rules and the user's permissions); the server still refuses the whole batch if one may not move.
 * The selection is frozen when a dialog opens, so a list that refreshes underneath does not change it.
 */
export function ProposalBatchBar({ cycle, selected, onClear }: { cycle: NeedsCycleDto; selected: NeedsProposalSummaryDto[]; onClear: () => void }) {
  const { user } = useAuth();
  const keys = permissionKeysOf(user);
  const writable = cycleWritable(cycle, user);
  const offers = useMemo(() => (writable ? batchOffers(selected, cycle, keys) : []), [writable, selected, cycle, keys]);
  const [action, setAction] = useState<{ action: ProposalBatchAction; proposals: Picked[] } | null>(null);
  const [decision, setDecision] = useState<{ stage: NeedsStage; outcome: StageOutcome; outcomes: StageOutcome[]; proposals: Picked[]; decided: boolean } | null>(null);
  const picked = (): Picked[] => selected.map((p) => ({ id: p.id, reference: p.reference, title: p.title }));
  const mixedStages = new Set(selected.map((p) => p.stage)).size > 1;

  return (
    <>
      {selected.length > 0 && (
        <div
          role="region"
          aria-label="Selected proposed projects"
          className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-primary/30 bg-white px-4 py-2.5 shadow-md"
        >
          <span className="text-xs font-semibold text-slate-900" aria-live="polite">
            {selected.length} selected
          </span>
          <span className="h-4 w-px bg-slate-200" aria-hidden="true" />
          {offers.length === 0 ? (
            <span className="text-xs text-slate-600">
              {!writable
                ? cycle.status !== "OPEN"
                  ? "The cycle is closed: nothing can change."
                  : "Only the organisation that runs this cycle can act on its proposed projects."
                : mixedStages
                  ? "No action is common to every selected proposed project. Select ones at the same stage."
                  : "You have no action in common on these proposed projects."}
            </span>
          ) : (
            offers.map((o) => (
              <button
                key={o.type === "action" ? o.action : `${o.stage}-${o.outcome}`}
                type="button"
                onClick={() =>
                  o.type === "action"
                    ? setAction({ action: o.action, proposals: picked() })
                    : setDecision({ stage: o.stage, outcome: o.outcome, outcomes: decisionOutcomesFor(o.stage, selected, cycle, keys), proposals: picked(), decided: false })
                }
                className={
                  o.type === "action" && o.action === "WITHDRAW"
                    ? "rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    : "rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
                }
              >
                {o.label}
              </button>
            ))
          )}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear selection
          </button>
        </div>
      )}
      {action && <BatchActionDialog cycleId={cycle.id} action={action.action} proposals={action.proposals} onClose={() => setAction(null)} onDone={onClear} />}
      {decision && (
        <DecisionDrawer
          cycle={cycle}
          stage={decision.stage}
          proposals={decision.proposals}
          outcomes={decision.outcomes}
          initialOutcome={decision.outcome}
          onDone={() => setDecision((d) => (d ? { ...d, decided: true } : d))}
          onClose={() => {
            if (decision.decided) onClear();
            setDecision(null);
          }}
        />
      )}
    </>
  );
}
