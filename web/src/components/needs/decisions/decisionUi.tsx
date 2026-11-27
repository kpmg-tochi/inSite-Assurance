import React from "react";
import { AlertTriangle } from "lucide-react";
import {
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NeedsSeparationErrorCodeEnum,
  STAGE_DECISION_OUTCOMES,
  SYSTEM_PERMISSIONS_CATALOG,
  allowedProposalActions,
  type NeedsBatchProblem,
  type NeedsCycleDto,
  type NeedsProposalAction,
  type NeedsProposalStatus,
  type NeedsSeparationAction,
  type NeedsSeparationErrorCode,
  type NeedsStage,
  type StageOutcome,
  type WebUserProfile,
} from "@insite/shared";
import { apiErrorCode, apiErrorDetails } from "../../../api/needsPipeline";

/**
 * Needs pipeline wave 3 (Track C): pure helpers and small pieces shared by the batch bar, the
 * decision drawer and the proposal page tabs. The server decides; these only choose what to offer.
 */

// ---------------------------------------------------------------------------
// Permissions and the cycle
// ---------------------------------------------------------------------------

const ALL_PERMISSION_KEYS = SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key);

/** The keys `allowedProposalActions` checks (the platform super admin holds every one, as on the server). */
export function permissionKeysOf(user: WebUserProfile | null): readonly string[] {
  if (!user) return [];
  return user.isPlatformSuperAdmin ? ALL_PERMISSION_KEYS : user.permissions;
}

/** Writes need an open cycle and the user's organisation to be the cycle's owner (the server checks too). */
export function cycleWritable(cycle: Pick<NeedsCycleDto, "status" | "owningOrganizationId"> | null | undefined, user: WebUserProfile | null): boolean {
  return Boolean(cycle && user && cycle.status === "OPEN" && user.organizationId === cycle.owningOrganizationId);
}

// ---------------------------------------------------------------------------
// Batch actions and stage decisions
// ---------------------------------------------------------------------------

export type BatchOffer =
  | { type: "action"; action: "SUBMIT" | "RESUBMIT" | "WITHDRAW"; label: string }
  | { type: "decision"; stage: NeedsStage; outcome: StageOutcome; label: string };

/** The proposal action that lets a person give this outcome in this stage. */
export function actionForOutcome(stage: NeedsStage, outcome: StageOutcome): NeedsProposalAction | null {
  if (outcome === "RETURN") return "RETURN";
  if (stage === "VALIDATION" && (outcome === "ADVANCE" || outcome === "NOT_VALIDATED")) return "RECORD_VALIDATION";
  if (stage === "COSTING" && outcome === "ADVANCE") return "SIGN_OFF_COSTING";
  return null;
}

/** Button and option wording for an outcome in a stage. */
export function outcomeLabel(stage: NeedsStage, outcome: StageOutcome): string {
  switch (outcome) {
    case "ADVANCE":
      return stage === "COSTING" ? "Sign off the costing" : stage === "VALIDATION" ? "Validate" : "Move on";
    case "RETURN":
      return "Return for correction";
    case "NOT_VALIDATED":
      return "Not validated";
    case "NOT_SELECTED":
      return "Not selected";
    default:
      return outcome;
  }
}

const BATCH_ACTION_LABELS = { SUBMIT: "Submit", RESUBMIT: "Resubmit", WITHDRAW: "Withdraw" } as const;

/**
 * D-N.4: what a selection may get: the actions every selected proposal allows (worked out per row with
 * `allowedProposalActions`, since the list has no `allowedActions`), and the stage decisions when every
 * row is in progress in the same decision stage. The server refuses the whole batch if one row may not move.
 */
export function batchOffers(
  rows: ReadonlyArray<{ stage: NeedsStage; status: NeedsProposalStatus }>,
  cycle: Pick<NeedsCycleDto, "config">,
  permissionKeys: readonly string[]
): BatchOffer[] {
  if (rows.length === 0) return [];
  const perRow = rows.map((r) => new Set(allowedProposalActions(r, cycle.config, permissionKeys)));
  const common = (a: NeedsProposalAction) => perRow.every((s) => s.has(a));
  const out: BatchOffer[] = [];
  for (const action of ["SUBMIT", "RESUBMIT", "WITHDRAW"] as const) {
    if (common(action)) out.push({ type: "action", action, label: BATCH_ACTION_LABELS[action] });
  }
  const stage = rows[0].stage;
  const sameStage = rows.every((r) => r.stage === stage && r.status === "IN_PROGRESS");
  const outcomes = STAGE_DECISION_OUTCOMES[stage] ?? [];
  if (sameStage) {
    for (const outcome of outcomes) {
      const needed = actionForOutcome(stage, outcome);
      if (needed && common(needed)) out.push({ type: "decision", stage, outcome, label: outcomeLabel(stage, outcome) });
    }
  }
  return out;
}

/** The outcomes a person may pick per item in the drawer (those whose action they hold on every item). */
export function decisionOutcomesFor(
  stage: NeedsStage,
  rows: ReadonlyArray<{ stage: NeedsStage; status: NeedsProposalStatus }>,
  cycle: Pick<NeedsCycleDto, "config">,
  permissionKeys: readonly string[]
): StageOutcome[] {
  const perRow = rows.map((r) => new Set(allowedProposalActions(r, cycle.config, permissionKeys)));
  return (STAGE_DECISION_OUTCOMES[stage] ?? []).filter((o) => {
    const needed = actionForOutcome(stage, o);
    return needed !== null && perRow.every((s) => s.has(needed));
  });
}

// ---------------------------------------------------------------------------
// Errors: refused batches and separation of duties
// ---------------------------------------------------------------------------

/** The refused items of a batch (`details.items`), or an empty list. */
export function batchProblemsOf(err: unknown): NeedsBatchProblem[] {
  const details = apiErrorDetails(err);
  const items = Array.isArray(details) ? details : (details as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (i): i is NeedsBatchProblem => Boolean(i) && typeof i === "object" && typeof (i as NeedsBatchProblem).proposalId === "string" && typeof (i as NeedsBatchProblem).message === "string"
  );
}

export function separationCode(code: string | null | undefined): NeedsSeparationErrorCode | null {
  const parsed = NeedsSeparationErrorCodeEnum.safeParse(code);
  return parsed.success ? parsed.data : null;
}

/** The separation code of a failed call (409 `SAME_PERSON_*`), else null. */
export function separationCodeOf(err: unknown): NeedsSeparationErrorCode | null {
  return separationCode(apiErrorCode(err));
}

/** The guarded action an override is asked for, from the error that blocked it. */
export const SEPARATION_ACTION_FOR_CODE: Record<NeedsSeparationErrorCode, NeedsSeparationAction> = {
  SAME_PERSON_VALIDATION: "VALIDATE",
  SAME_PERSON_COSTING: "COST",
  SAME_PERSON_APPROVAL: "APPROVE_STEP",
  SAME_PERSON_FUNDING: "CONFIRM_FUNDING",
};

export const SEPARATION_ACTION_LABELS: Record<NeedsSeparationAction, string> = {
  VALIDATE: "Validate",
  COST: "Cost",
  APPROVE_STEP: "Decide an approval step",
  CONFIRM_FUNDING: "Confirm the funding",
};

/** The action a person at this stage would be blocked from (VALIDATE at Validation, COST at Costing). */
export function separationActionForStage(stage: NeedsStage): NeedsSeparationAction | null {
  if (stage === "VALIDATION") return "VALIDATE";
  if (stage === "COSTING") return "COST";
  return null;
}

/** The permission the asker must hold for an action (plan 6.2 actors). */
export const SEPARATION_ACTION_PERMISSION: Record<NeedsSeparationAction, string> = {
  VALIDATE: "needs:validate",
  COST: "needs:cost",
  APPROVE_STEP: "needs:view",
  CONFIRM_FUNDING: "needs:record_funding",
};

export function separationMessage(code: NeedsSeparationErrorCode): string {
  return NEEDS_SEPARATION_ERROR_MESSAGES[code];
}

/** The refused items of a batch, one line each; a separation problem can ask for an override. */
export function BatchProblemsList({
  problems,
  onAskOverride,
}: {
  problems: NeedsBatchProblem[];
  onAskOverride?: (problem: NeedsBatchProblem, code: NeedsSeparationErrorCode) => void;
}) {
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Nothing was changed. {problems.length === 1 ? "This proposed project cannot move:" : `These ${problems.length} proposed projects cannot move:`}
      </p>
      <ul className="mt-1.5 space-y-1">
        {problems.map((p) => {
          const code = separationCode(p.code);
          return (
            <li key={`${p.proposalId}-${p.code}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{p.reference}</span>
              <span>{p.message}</span>
              {code && onAskOverride && (
                <button type="button" className="font-semibold text-brand-primary underline-offset-2 hover:underline" onClick={() => onAskOverride(p, code)}>
                  Ask for an override
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[11px] text-rose-800">Remove them from the selection, or fix them, and try again.</p>
    </div>
  );
}
