import React, { useMemo, useState } from "react";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, FileUp } from "lucide-react";
import {
  FLAG_RESOLUTIONS_BY_KIND,
  FLAG_RESOLVER_PERMISSION,
  costingSummary,
  standardRateFor,
  zoneOfState,
  type NeedsBoqLine,
  type NeedsCycleDto,
  type NeedsProposalDetailDto,
  type NeedsSeparationErrorCode,
  type ProposalFlagDto,
} from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useAuth } from "../../../lib/auth-context";
import { useCostingStandardVersionQuery } from "../../../queries/needs/useStandardsQueries";
import { useResolveProposalFlagsMutation } from "../../../mutations/needs/useDecisionMutations";
import { EmptyPanel, cardCls, inputCls, money } from "../needsUi";
import { separationCodeOf, SEPARATION_ACTION_FOR_CODE } from "./decisionUi";
import { CeilingBreachList, FlagResolutionText, RateVarianceList } from "./FlagDetails";
import { AskOverrideDialog, overrideFlagsOf } from "./SeparationOverride";

/**
 * Needs pipeline wave 3 (C3, A4): the BoQ & costing tab. Lines of the current version grouped by
 * unit, each rate against the cycle's costing standard rate for the proposal's zone (base rate ×
 * zone factor), the variance beyond the cycle's tolerance highlighted; the costing summary (the
 * file's and at the standard's percentages, and the same quantities at standard rates); and the
 * costing flags with "Acknowledge" (reason) for the quantity surveyor. Upload of the costed version
 * and sign-off are offered by the page from the server's allowed actions.
 */

const COSTING_FLAG_KINDS = new Set(["RATE_VARIANCE", "CEILING_EXCEEDED", "MISSING_SUPERVISION_LINE"]);
const th = "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const td = "px-2 py-1.5 align-top text-xs text-slate-700";
const qty = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { maximumFractionDigits: 2 }));
const pctText = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

export function ProposalCostingTab({
  proposal,
  cycle,
  writable,
  facilityName,
  onUploadCosted,
  onSignOff,
}: {
  proposal: NeedsProposalDetailDto;
  cycle: NeedsCycleDto | null;
  writable: boolean;
  facilityName: (code: string) => string;
  /** Shown when the server offers UPLOAD_COSTED_VERSION. */
  onUploadCosted: (() => void) | null;
  /** Shown when the server offers SIGN_OFF_COSTING. */
  onSignOff: (() => void) | null;
}) {
  const standardQuery = useCostingStandardVersionQuery(cycle?.costingStandardVersionId);
  const standard = standardQuery.data?.standard ?? null;
  const zone = zoneOfState(proposal.stateCode);
  const tolerance = cycle?.config.rateVarianceTolerancePct ?? 15;
  const lines = proposal.boqLines;
  const costingFlags = proposal.flags.filter((f) => COSTING_FLAG_KINDS.has(f.kind));

  const units = useMemo(() => {
    const byUnit = new Map<string, NeedsBoqLine[]>();
    for (const l of lines) byUnit.set(l.unitId.toUpperCase(), [...(byUnit.get(l.unitId.toUpperCase()) ?? []), l]);
    return [...byUnit.entries()].map(([unitId, unitLines]) => {
      const row = proposal.breakdownRows.find((r) => r.unitId.toUpperCase() === unitId);
      return { unitId, row, lines: unitLines, subtotal: unitLines.reduce((s, l) => s + l.amountNgn, 0) };
    });
  }, [lines, proposal.breakdownRows]);
  const siteName = useMemo(() => new Map(proposal.sites.map((s) => [s.siteNumber, s.schoolName])), [proposal.sites]);
  const computed = useMemo(() => (standard ? costingSummary(lines, standard, zone) : null), [lines, standard, zone]);
  const outside = useMemo(() => {
    if (!standard) return 0;
    return lines.filter((l) => {
      const rate = standardRateFor(standard, l.itemCode, zone);
      return rate !== null && rate > 0 && Math.abs(((l.rateNgn - rate) / rate) * 100) > tolerance;
    }).length;
  }, [lines, standard, zone, tolerance]);

  return (
    <div className="space-y-4">
      {(onUploadCosted || onSignOff) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-primary/25 bg-brand-primary/[0.04] p-3">
          <p className="text-xs text-slate-800">
            {proposal.stage === "COSTING"
              ? "Upload the costed version (with the supervision and monitoring line), acknowledge the rate and ceiling flags with reasons, then sign off the costing."
              : "Upload the corrected costed version."}
          </p>
          <div className="flex flex-wrap gap-2">
            {onUploadCosted && (
              <button type="button" onClick={onUploadCosted} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload the costed version
              </button>
            )}
            {onSignOff && (
              <button type="button" onClick={onSignOff} className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover">
                Sign off the costing
              </button>
            )}
          </div>
        </div>
      )}

      {costingFlags.length > 0 && <CostingFlags proposal={proposal} flags={costingFlags} writable={writable} facilityName={facilityName} />}

      {lines.length === 0 ? (
        <EmptyPanel title="No BoQ lines in the current version">
          {proposal.stage === "COSTING" || proposal.allowedActions.includes("UPLOAD_COSTED_VERSION")
            ? "The quantity surveyor uploads the costed version here: the BoQ by unit, the rates and the costing summary."
            : "The bill of quantities comes with the needs assessment or, at the latest, with the costed version at the Costing stage."}
        </EmptyPanel>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <Fact label="Lines" value={String(lines.length)} />
            <Fact label="Units" value={String(units.length)} />
            <Fact label="Costing standard" value={standardQuery.data ? `Version ${standardQuery.data.version}` : cycle?.costingStandardVersionId ? "Loading…" : "None in this cycle"} />
            <Fact label="Tolerance" value={`±${tolerance}%`} />
            <Fact label="Rates outside it" value={standard ? String(outside) : "–"} warn={outside > 0} />
          </dl>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="Bill of quantities by unit">
            <table className="w-full min-w-[1080px]">
              <caption className="sr-only">BoQ lines grouped by unit, with the standard's rate and the variance</caption>
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className={th}>Item</th>
                  <th scope="col" className={th}>Description</th>
                  <th scope="col" className={`${th} text-right`}>Quantity</th>
                  <th scope="col" className={th}>Unit</th>
                  <th scope="col" className={`${th} text-right`}>Rate</th>
                  <th scope="col" className={`${th} text-right`}>Standard rate</th>
                  <th scope="col" className={`${th} text-right`}>Variance</th>
                  <th scope="col" className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              {units.map((u) => (
                <tbody key={u.unitId} className="border-t border-slate-200">
                  <tr className="bg-slate-50/60">
                    <th scope="rowgroup" colSpan={7} className="px-2 py-1.5 text-left text-xs font-bold text-slate-900">
                      Unit {u.unitId}
                      {u.row && (
                        <span className="ml-1 font-normal text-slate-500">
                          · {facilityName(u.row.facilityCode)} · Site {u.row.siteNumber}
                          {siteName.get(u.row.siteNumber) ? ` (${siteName.get(u.row.siteNumber)})` : ""}
                        </span>
                      )}
                    </th>
                    <td className={`${td} text-right font-semibold tabular-nums text-slate-900`}>{money(u.subtotal)}</td>
                  </tr>
                  {u.lines.map((l) => {
                    const rate = standard ? standardRateFor(standard, l.itemCode, zone) : null;
                    const variance = rate !== null && rate > 0 ? ((l.rateNgn - rate) / rate) * 100 : null;
                    const beyond = variance !== null && Math.abs(variance) > tolerance;
                    return (
                      <tr key={l.wbsCode} className={`border-t border-slate-100 ${beyond ? "bg-amber-50/60" : ""}`}>
                        <td className={`${td} whitespace-nowrap`}>
                          <span className="font-medium text-slate-900">{l.wbsCode}</span>
                          {l.itemCode && <span className="block text-[10px] text-slate-500">{l.itemCode}</span>}
                        </td>
                        <td className={`${td} min-w-[260px]`}>{l.description}</td>
                        <td className={`${td} text-right tabular-nums`}>{qty(l.totalQuantity)}</td>
                        <td className={td}>{l.unit}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(l.rateNgn)}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums text-slate-600`}>
                          {rate !== null ? money(rate) : <span className="text-slate-400">{l.itemCode ? "Not in the standard" : "No item code"}</span>}
                        </td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                          {variance === null ? (
                            "–"
                          ) : beyond ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-900">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              {pctText(variance)}
                              <span className="sr-only"> (outside the tolerance)</span>
                            </span>
                          ) : (
                            <span className="text-slate-600">{pctText(variance)}</span>
                          )}
                        </td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums text-slate-900`}>{money(l.amountNgn)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}

      <CostingSummaryCard proposal={proposal} computed={computed} standardLoaded={Boolean(standard)} />
    </div>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-semibold tabular-nums ${warn ? "text-amber-800" : "text-slate-900"}`}>{value}</dd>
    </div>
  );
}

function CostingSummaryCard({ proposal, computed, standardLoaded }: { proposal: NeedsProposalDetailDto; computed: ReturnType<typeof costingSummary> | null; standardLoaded: boolean }) {
  const file = proposal.costingSummary;
  if (!file && (!computed || proposal.boqLines.length === 0)) return null;
  const rows: Array<{ label: string; file: string; standard: string }> = [
    { label: "Works subtotal", file: money(file?.subtotalNgn), standard: money(computed?.subtotalNgn) },
    {
      label: "Supervision and monitoring",
      file: file ? `${money(file.supervisionMonitoringNgn)} (${file.supervisionMonitoringPct}%)` : "–",
      standard: computed ? `${money(computed.supervisionMonitoringNgn)} (${computed.supervisionMonitoringPct}%)` : "–",
    },
    {
      label: "Contingency",
      file: file ? `${money(file.contingencyNgn)} (${file.contingencyPct}%)` : "–",
      standard: computed ? `${money(computed.contingencyNgn)} (${computed.contingencyPct}%)` : "–",
    },
    { label: "Total", file: money(file?.totalNgn), standard: money(computed?.totalNgn) },
  ];
  const atStandard = computed?.atStandardRatesNgn ?? null;
  const diff = atStandard !== null && computed && atStandard > 0 ? ((computed.subtotalNgn - atStandard) / atStandard) * 100 : null;
  return (
    <section className={cardCls} aria-labelledby="costing-summary">
      <h3 id="costing-summary" className="text-sm font-bold text-slate-900">
        Costing summary
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr>
              <th scope="col" className={th} />
              <th scope="col" className={`${th} text-right`}>In the file</th>
              <th scope="col" className={`${th} text-right`}>At the standard's percentages</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.label} className={r.label === "Total" ? "font-bold text-slate-900" : ""}>
                <th scope="row" className={`${td} text-left font-medium text-slate-900`}>
                  {r.label}
                </th>
                <td className={`${td} text-right tabular-nums`}>{r.file}</td>
                <td className={`${td} text-right tabular-nums`}>{standardLoaded ? r.standard : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {atStandard !== null && (
        <p className="mt-2 text-xs text-slate-700">
          The same quantities at the standard's rates for the zone: <span className="font-semibold tabular-nums text-slate-900">{money(atStandard)}</span>
          {diff !== null && <span className="tabular-nums"> (the BoQ is {pctText(diff)} against it, lines the standard lists only)</span>}.
        </p>
      )}
      {!file && <p className="mt-2 text-[11px] text-slate-500">This version has no costing summary sheet; the costed version must carry one.</p>}
    </section>
  );
}

const AckSchema = z.object({ reason: z.string().trim().min(5, "Give the reason (at least 5 characters)").max(2000, "At most 2,000 characters") });

function CostingFlags({
  proposal,
  flags,
  writable,
  facilityName,
}: {
  proposal: NeedsProposalDetailDto;
  flags: ProposalFlagDto[];
  writable: boolean;
  facilityName: (code: string) => string;
}) {
  const { hasPermission } = useAuth();
  const [asking, setAsking] = useState<NeedsSeparationErrorCode | null>(null);
  return (
    <section className={cardCls} aria-labelledby="costing-flags">
      <h3 id="costing-flags" className="text-sm font-bold text-slate-900">
        Costing flags
      </h3>
      <ul className="mt-2 divide-y divide-slate-100">
        {flags.map((f) => {
          const resolver = FLAG_RESOLVER_PERMISSION[f.kind];
          const canAck = writable && !f.resolved && FLAG_RESOLUTIONS_BY_KIND[f.kind].includes("ACKNOWLEDGED") && Boolean(resolver && hasPermission(resolver)) && proposal.stage === "COSTING";
          return (
            <li key={f.id} className="py-2 text-xs">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                {f.resolved ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />}
                {f.label}
                {f.raisedOnVersion !== null && <span className="font-normal text-slate-500">· version {f.raisedOnVersion}</span>}
              </p>
              {f.kind === "RATE_VARIANCE" && <RateVarianceList flag={f} />}
              {f.kind === "CEILING_EXCEEDED" && <CeilingBreachList flag={f} facilityName={facilityName} />}
              {f.kind === "MISSING_SUPERVISION_LINE" && !f.resolved && (
                <p className="mt-1 text-slate-700">Only a costed version with the supervision and monitoring line clears this flag: upload the corrected costed version.</p>
              )}
              <p className="mt-1 text-[11px]">
                <FlagResolutionText flag={f} />
              </p>
              {canAck && <AcknowledgeForm proposal={proposal} flag={f} onSeparation={setAsking} />}
            </li>
          );
        })}
      </ul>
      {asking && (
        <AskOverrideDialog
          cycleId={proposal.cycleId}
          proposal={{ id: proposal.id, reference: proposal.reference, title: proposal.title }}
          code={asking}
          action={SEPARATION_ACTION_FOR_CODE[asking]}
          overrides={overrideFlagsOf(proposal.flags)}
          onClose={() => setAsking(null)}
        />
      )}
    </section>
  );
}

function AcknowledgeForm({ proposal, flag, onSeparation }: { proposal: NeedsProposalDetailDto; flag: ProposalFlagDto; onSeparation: (code: NeedsSeparationErrorCode) => void }) {
  const [open, setOpen] = useState(false);
  const resolve = useResolveProposalFlagsMutation(proposal.cycleId, proposal.id);
  const form = useZodForm(AckSchema, { defaultValues: { reason: "" } });
  const id = `ack-${flag.id}`;
  if (!open)
    return (
      <button type="button" className="mt-1 text-xs font-semibold text-brand-primary hover:underline" onClick={() => setOpen(true)}>
        Acknowledge
      </button>
    );
  const submit = form.handleSubmit((v) =>
    resolve.mutate(
      { resolutions: [{ flagId: flag.id, resolution: "ACKNOWLEDGED", reason: v.reason, mergeIntoProposalId: null }] },
      {
        onSuccess: () => setOpen(false),
        onError: (err) => {
          const code = separationCodeOf(err);
          if (code) onSeparation(code);
        },
      }
    )
  );
  return (
    <form className="mt-2 flex flex-wrap items-start gap-2" noValidate onSubmit={submit}>
      <div className="min-w-[16rem] flex-1">
        <label className="sr-only" htmlFor={id}>
          Reason for acknowledging {flag.label}
        </label>
        <input
          id={id}
          className={`${inputCls} ${invalidClass(form, "reason")}`}
          placeholder="Why the rate or cost stands (e.g. remote site, haulage)"
          {...form.register("reason")}
          {...fieldA11y(form, "reason")}
        />
        <FieldError form={form} name="reason" />
      </div>
      <button type="button" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <SubmitButton form={form} pending={resolve.isPending} pendingLabel="Saving…" showHint={false}>
        Acknowledge
      </SubmitButton>
    </form>
  );
}
