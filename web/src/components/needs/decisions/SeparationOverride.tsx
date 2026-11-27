import React, { useState } from "react";
import { z } from "zod";
import { CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";
import {
  SeparationOverrideDecisionRequestSchema,
  SeparationOverrideDetailsSchema,
  SeparationOverrideRequestSchema,
  type NeedsSeparationAction,
  type NeedsSeparationErrorCode,
  type ProposalFlagDto,
  type SeparationOverrideDetails,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useAuth } from "../../../lib/auth-context";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useDecideSeparationOverrideMutation, useRequestSeparationOverrideMutation } from "../../../mutations/needs/useDecisionMutations";
import { cardCls, inputCls, labelCls } from "../needsUi";
import { SEPARATION_ACTION_FOR_CODE, SEPARATION_ACTION_LABELS, SEPARATION_ACTION_PERMISSION, separationActionForStage, separationMessage } from "./decisionUi";

/**
 * Needs pipeline wave 3 (C4; D-N.9, owner decision 16.2 O-1): separation of duties overrides. The
 * blocked person asks with a reason; another holder of `needs:override_separation` (never the asker)
 * authorises or refuses with a note; the authorisation counts for that action on this proposed project
 * while it stays in the stage, and is marked used when the action goes ahead.
 */

export interface OverrideFlag {
  flag: ProposalFlagDto;
  details: SeparationOverrideDetails | null;
}

export function overrideFlagsOf(flags: readonly ProposalFlagDto[]): OverrideFlag[] {
  return flags
    .filter((f) => f.kind === "SEPARATION_OVERRIDE")
    .map((flag) => {
      const parsed = SeparationOverrideDetailsSchema.safeParse(flag.details);
      return { flag, details: parsed.success ? parsed.data : null };
    });
}

/** An open request by this user for this action, or an authorised one not yet used. */
function standingRequest(overrides: OverrideFlag[], userId: string | undefined, action: NeedsSeparationAction) {
  const mine = overrides.filter((o) => o.details && o.details.requestedByUserId === userId && o.details.action === action);
  return {
    waiting: mine.find((o) => !o.flag.resolved) ?? null,
    authorised: mine.find((o) => o.flag.resolved && o.flag.resolution === "AUTHORISED" && !o.details?.usedAt) ?? null,
  };
}

const ReasonFormSchema = z.object({ reason: SeparationOverrideRequestSchema.shape.reason });

/** Ask for an override after a 409 `SAME_PERSON_*` (or before trying, from the proposal page). */
export function AskOverrideDialog({
  cycleId,
  proposal,
  code,
  action,
  overrides,
  onClose,
}: {
  cycleId: string;
  proposal: { id: string; reference: string; title: string };
  /** The error that blocked the user, when there was one. */
  code: NeedsSeparationErrorCode | null;
  action: NeedsSeparationAction;
  /** The proposal's override flags, when known (to show a request already waiting). */
  overrides?: OverrideFlag[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const ask = useRequestSeparationOverrideMutation(cycleId);
  const form = useZodForm(ReasonFormSchema, { defaultValues: { reason: "" } });
  const standing = standingRequest(overrides ?? [], user?.id, action);
  const submit = form.handleSubmit((values) => ask.mutate({ proposalId: proposal.id, action, reason: values.reason }, { onSuccess: () => onClose() }));

  return (
    <ModalShell title="Ask for a separation of duties override" subtitle={`${proposal.reference} · ${proposal.title}`} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {code ? separationMessage(code) : `Separation of duties may stop you from this step: ${SEPARATION_ACTION_LABELS[action].toLowerCase()}.`} Another person who may
          authorise overrides decides your request; you cannot authorise it yourself.
        </p>
        {standing.waiting ? (
          <p className="text-xs text-slate-700">
            Your request of {formatDateTimeShort(standing.waiting.flag.raisedAt)} is still waiting for a decision. You will be able to go ahead once it is authorised.
          </p>
        ) : standing.authorised ? (
          <p className="text-xs text-emerald-800">
            Your request was authorised{standing.authorised.flag.resolvedByName ? ` by ${standing.authorised.flag.resolvedByName}` : ""}. Try the step again.
          </p>
        ) : (
          <div>
            <label className={labelCls} htmlFor="override-reason">
              Why should you do this step yourself? <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="override-reason"
              rows={4}
              className={`${inputCls} ${invalidClass(form, "reason")}`}
              placeholder="e.g. The only validator in the State is on leave until after the deadline."
              {...form.register("reason")}
              {...fieldA11y(form, "reason")}
            />
            <FieldError form={form} name="reason" />
          </div>
        )}
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            {standing.waiting || standing.authorised ? "Close" : "Cancel"}
          </button>
          {!standing.waiting && !standing.authorised && (
            <SubmitButton form={form} pending={ask.isPending} pendingLabel="Sending…" hint="Give the reason (at least 10 characters).">
              Ask for an override
            </SubmitButton>
          )}
        </div>
      </form>
    </ModalShell>
  );
}

const NoteFormSchema = z.object({ note: z.string().trim().max(1000, "At most 1,000 characters") });

/** The override requests of a proposal, with Authorise / Refuse for another authoriser. */
export function SeparationOverridesCard({
  cycleId,
  proposal,
  stage,
  overrides,
  writable,
}: {
  cycleId: string;
  proposal: { id: string; reference: string; title: string };
  stage: Parameters<typeof separationActionForStage>[0];
  overrides: OverrideFlag[];
  writable: boolean;
}) {
  const { user, hasPermission } = useAuth();
  const [asking, setAsking] = useState(false);
  const stageAction = separationActionForStage(stage);
  const canAsk = writable && stageAction !== null && hasPermission(SEPARATION_ACTION_PERMISSION[stageAction]);
  if (overrides.length === 0 && !canAsk) return null;

  return (
    <section aria-labelledby="separation-overrides" className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="separation-overrides" className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <ShieldAlert className="h-4 w-4 text-slate-500" aria-hidden="true" /> Separation of duties
          </h3>
          <p className="text-[11px] text-slate-500">
            The person who uploaded a version cannot validate it, and the validator cannot cost it, unless another person authorises an override.
          </p>
        </div>
        {canAsk && stageAction && (
          <button type="button" className="text-xs font-semibold text-brand-primary hover:underline" onClick={() => setAsking(true)}>
            Ask for an override
          </button>
        )}
      </div>
      {overrides.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No override has been asked for.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
          {overrides.map((o) => (
            <OverrideRow
              key={o.flag.id}
              cycleId={cycleId}
              proposalId={proposal.id}
              override={o}
              canDecide={writable && hasPermission("needs:override_separation") && Boolean(o.details) && o.details?.requestedByUserId !== user?.id}
            />
          ))}
        </ul>
      )}
      {asking && stageAction && (
        <AskOverrideDialog cycleId={cycleId} proposal={proposal} code={null} action={stageAction} overrides={overrides} onClose={() => setAsking(false)} />
      )}
    </section>
  );
}

function OverrideStatus({ o }: { o: OverrideFlag }) {
  if (!o.flag.resolved)
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
        <Clock className="h-3 w-3" aria-hidden="true" /> Waiting for a decision
      </span>
    );
  if (o.flag.resolution === "AUTHORISED")
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {o.details?.usedAt ? "Authorised, used" : "Authorised, not used yet"}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
      <XCircle className="h-3 w-3" aria-hidden="true" /> Refused
    </span>
  );
}

function OverrideRow({ cycleId, proposalId, override: o, canDecide }: { cycleId: string; proposalId: string; override: OverrideFlag; canDecide: boolean }) {
  const decide = useDecideSeparationOverrideMutation(cycleId);
  const [deciding, setDeciding] = useState(false);
  const form = useZodForm(NoteFormSchema, { defaultValues: { note: "" } });
  const d = o.details;
  const send = (decision: "AUTHORISED" | "REFUSED") =>
    form.handleSubmit((values) => {
      const body = SeparationOverrideDecisionRequestSchema.parse({ decision, note: values.note || null });
      decide.mutate({ flagId: o.flag.id, proposalId, body }, { onSuccess: () => setDeciding(false) });
    })();

  return (
    <li className="py-2 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {d ? `${SEPARATION_ACTION_LABELS[d.action]}: asked by ${d.requestedByName}` : "Override request"}
            <span className="font-normal text-slate-500"> · {formatDateTimeShort(o.flag.raisedAt)}</span>
          </p>
          {d && <p className="text-slate-700">Reason: {d.reason}</p>}
          {o.flag.resolved && (
            <p className="text-slate-600">
              {o.flag.resolution === "AUTHORISED" ? "Authorised" : "Refused"}
              {o.flag.resolvedByName ? ` by ${o.flag.resolvedByName}` : ""}
              {o.flag.resolvedAt ? `, ${formatDateTimeShort(o.flag.resolvedAt)}` : ""}
              {o.flag.resolutionReason ? `: ${o.flag.resolutionReason}` : ""}
              {d?.usedAt ? ` · used ${formatDateTimeShort(d.usedAt)}` : ""}
            </p>
          )}
        </div>
        <OverrideStatus o={o} />
      </div>
      {!o.flag.resolved && canDecide && !deciding && (
        <button type="button" className="mt-1 text-xs font-semibold text-brand-primary hover:underline" onClick={() => setDeciding(true)}>
          Decide this request
        </button>
      )}
      {!o.flag.resolved && canDecide && deciding && (
        <form className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" noValidate onSubmit={(e) => e.preventDefault()}>
          <div>
            <label className={labelCls} htmlFor={`override-note-${o.flag.id}`}>
              Note (optional)
            </label>
            <textarea id={`override-note-${o.flag.id}`} rows={2} className={`${inputCls} ${invalidClass(form, "note")}`} {...form.register("note")} {...fieldA11y(form, "note")} />
            <FieldError form={form} name="note" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600" onClick={() => setDeciding(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={decide.isPending || !form.formState.isValid}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => send("REFUSED")}
            >
              Refuse
            </button>
            <button
              type="button"
              disabled={decide.isPending || !form.formState.isValid}
              className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              onClick={() => send("AUTHORISED")}
            >
              {decide.isPending ? "Saving…" : "Authorise"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/** Shared by the pages: the override action that a separation error asks for. */
export const overrideActionFor = (code: NeedsSeparationErrorCode) => SEPARATION_ACTION_FOR_CODE[code];
