import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { SubmitPortfolioRequestSchema, type NeedsProposalSummaryDto, type NeedsSubmissionDto } from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, visibleError } from "../../../lib/forms";
import { useSubmitPortfolioMutation } from "../../../mutations/needs/useApprovalMutations";
import { cardCls, inputCls, labelCls, locationText, money, plural } from "../needsUi";
import { DistributionPanel } from "./submissionUi";

/**
 * Needs pipeline wave 4 (C1): the submitter builds the list put to approval from the finalised ranking.
 * Every proposed project at Approval is listed by rank. Those above the funding line are included by
 * default and may be excluded with a reason; those below it are excluded ("Below the funding line")
 * and cannot be included (the committee's line, D-N.10). After a return, the returned list's choices
 * are the starting point.
 */

export const BELOW_LINE_REASON = "Below the funding line";

export const amountOf = (p: Pick<NeedsProposalSummaryDto, "costedAmountNgn" | "preliminaryCostNgn">) => p.costedAmountNgn ?? p.preliminaryCostNgn;

export function PortfolioBuilder({
  cycleId,
  proposals,
  returned,
  approvalLabel,
}: {
  cycleId: string;
  /** The proposed projects at Approval (in progress), any order. */
  proposals: NeedsProposalSummaryDto[];
  /** The returned submission whose choices are kept, if any. */
  returned: NeedsSubmissionDto | null;
  approvalLabel: string;
}) {
  const submit = useSubmitPortfolioMutation(cycleId);
  const rows = useMemo(
    () => [...proposals].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.reference.localeCompare(b.reference)),
    [proposals]
  );

  const form = useZodForm(SubmitPortfolioRequestSchema, {
    defaultValues: {
      note: "",
      items: rows.map((p) => {
        const before = returned?.items.find((i) => i.proposalId === p.id);
        if (p.aboveLine === false) return { proposalId: p.id, included: false, exclusionReason: before?.exclusionReason || BELOW_LINE_REASON };
        if (before && !before.included) return { proposalId: p.id, included: false, exclusionReason: before.exclusionReason ?? "" };
        return { proposalId: p.id, included: true, exclusionReason: "" };
      }),
    },
  });
  const items = form.watch("items") ?? [];

  const setItem = (index: number, patch: { included?: boolean; exclusionReason?: string }) =>
    form.setValue(
      "items",
      items.map((it, n) => (n === index ? { ...it, ...patch } : it)),
      { shouldValidate: true, shouldDirty: true, shouldTouch: true }
    );

  const includedRows = rows.filter((_, i) => items[i]?.included);
  const total = includedRows.reduce((s, p) => s + (amountOf(p) ?? 0), 0);
  const distributionItems = includedRows.map((p) => ({ stateCode: p.stateCode, lgaCodes: p.lgaCodes, amountNgn: amountOf(p) }));

  const onSubmit = form.handleSubmit((v) =>
    submit.mutate({
      note: v.note ? v.note : null,
      items: v.items.map((i) => ({ proposalId: i.proposalId, included: i.included, exclusionReason: i.included ? null : i.exclusionReason })),
    })
  );

  return (
    <form className="space-y-4" noValidate onSubmit={onSubmit}>
      <section className={`${cardCls} space-y-3`} aria-labelledby="portfolio-builder-heading">
        <div>
          <h3 id="portfolio-builder-heading" className="text-sm font-bold text-slate-900">
            {returned ? `Revise and resubmit for ${approvalLabel.toLowerCase()}` : `Submit for ${approvalLabel.toLowerCase()}`}
          </h3>
          <p className="text-[11px] text-slate-500">
            Every proposed project at Approval, in ranking order. Include or exclude each one; an exclusion needs a reason. Those below the funding line stay
            excluded.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200" tabIndex={0} role="region" aria-label="Proposed projects at Approval">
          <table className="w-full min-w-[880px] text-xs">
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="w-20 px-3 py-1.5">Include</th>
                <th scope="col" className="w-14 px-3 py-1.5 text-right">Rank</th>
                <th scope="col" className="px-3 py-1.5">Proposed project</th>
                <th scope="col" className="px-3 py-1.5">Location</th>
                <th scope="col" className="w-28 px-3 py-1.5">Funding line</th>
                <th scope="col" className="w-32 px-3 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p, i) => {
                const item = items[i];
                const below = p.aboveLine === false;
                const name = `items.${i}.exclusionReason`;
                return (
                  <React.Fragment key={p.id}>
                    <tr className={item?.included ? "" : "bg-slate-50/70"}>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={Boolean(item?.included)}
                            disabled={below}
                            onChange={(e) => setItem(i, { included: e.target.checked, exclusionReason: e.target.checked ? "" : item?.exclusionReason || "" })}
                            aria-describedby={below ? `below-${p.id}` : undefined}
                          />
                          <span className="sr-only">Include {p.reference}</span>
                        </label>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{p.rank ?? "–"}</td>
                      <td className="px-3 py-2">
                        <Link to={`/app/needs-assessment/proposals/${p.id}`} className="font-semibold text-brand-primary hover:underline">
                          {p.reference}
                        </Link>
                        <span className="block text-slate-700">{p.title}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{locationText(p.stateCode, p.lgaCodes)}</td>
                      <td className="px-3 py-2">
                        <LineText aboveLine={p.aboveLine} id={`below-${p.id}`} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{money(amountOf(p))}</td>
                    </tr>
                    {item && !item.included && (
                      <tr className="bg-slate-50/70">
                        <td />
                        <td colSpan={5} className="px-3 pb-2">
                          <label className="sr-only" htmlFor={`exclusion-${p.id}`}>
                            Reason for excluding {p.reference}
                          </label>
                          <input
                            id={`exclusion-${p.id}`}
                            className={`${inputCls} ${visibleError(form, name) ? "border-rose-400" : ""}`}
                            placeholder="Reason for the exclusion (required)"
                            value={item.exclusionReason ?? ""}
                            readOnly={below}
                            onChange={(e) => setItem(i, { exclusionReason: e.target.value })}
                            {...fieldA11y(form, name)}
                          />
                          <FieldError form={form} name={name} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-700">
          Included: <span className="font-semibold">{plural(includedRows.length, "proposed project")}</span> · <span className="font-semibold tabular-nums">{money(total)}</span>
          {rows.length - includedRows.length > 0 && <span className="text-slate-500"> · excluded: {rows.length - includedRows.length}</span>}
        </p>
      </section>

      <section className={`${cardCls} space-y-2`} aria-labelledby="portfolio-builder-distribution">
        <h3 id="portfolio-builder-distribution" className="text-sm font-bold text-slate-900">
          Where the included projects are
        </h3>
        <DistributionPanel items={distributionItems} />
      </section>

      <div className={cardCls}>
        <label className={labelCls} htmlFor="portfolio-note">
          Note to the approvers <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id="portfolio-note"
          rows={2}
          className={`${inputCls} ${invalidClass(form, "note")}`}
          placeholder={returned ? "What changed since the return" : "e.g. Prepared from the Prioritised Project Portfolio of 21 October"}
          {...form.register("note")}
          {...fieldA11y(form, "note")}
        />
        <FieldError form={form} name="note" />
        <div className="mt-3 flex justify-end">
          <SubmitButton form={form} pending={submit.isPending} pendingLabel="Submitting…" hint="Give a reason for every exclusion." blocked={includedRows.length === 0}>
            {returned ? "Resubmit" : "Submit for approval"}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function LineText({ aboveLine, id }: { aboveLine: boolean | null; id?: string }) {
  if (aboveLine === null) return <span className="text-slate-400">–</span>;
  return aboveLine ? (
    <span id={id} className="inline-flex items-center gap-1 text-emerald-800">
      <ArrowUpToLine className="h-3.5 w-3.5" aria-hidden="true" /> Above
    </span>
  ) : (
    <span id={id} className="inline-flex items-center gap-1 text-slate-600">
      <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" /> Below
    </span>
  );
}
