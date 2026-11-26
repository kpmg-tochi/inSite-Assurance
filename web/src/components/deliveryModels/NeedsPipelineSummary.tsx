import React, { useMemo } from "react";
import {
  APPROVAL_ORGANIZATION_SCOPE_META,
  NEEDS_TEMPLATE_FIELD_LABELS,
  NeedsChainTypeEnum,
  NeedsPipelineConfigSchema,
  SYSTEM_PERMISSIONS_CATALOG,
  type MonthDay,
  type NeedsChainType,
  type NeedsPipelineConfig,
  type ScoreDimension,
} from "@insite/shared";

/**
 * Needs pipeline (N1): the "Needs assessment" tab of the project type editor. Read-only for now: it
 * shows the type's stages, deadlines, scoring rubric, checks and approval chains as stored. The
 * value is kept untouched on save (the editor passes unknown config keys through).
 */

const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const thCls = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const tdCls = "px-3 py-2 align-top text-xs text-slate-700";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthDay = (d: MonthDay | null) => (d ? `${d.day} ${MONTHS[d.month - 1]}` : "No fixed date");

const PERMISSION_NAMES = new Map(SYSTEM_PERMISSIONS_CATALOG.map((p) => [p.key, p.name]));
const permissionName = (key: string | null) => (key ? PERMISSION_NAMES.get(key) ?? key : "Approval chain");

const CHAIN_LABELS: Record<NeedsChainType, string> = {
  NEEDS_PORTFOLIO: "Portfolio approval",
  BEAP: "BEAP approval",
  OUT_OF_CYCLE: "Out-of-cycle approval",
};

const DIMENSION_LABELS: Record<ScoreDimension, string> = { IMPACT: "Impact", EASE: "Ease of implementation" };

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-900">{value}</dd>
    </div>
  );
}

export function NeedsPipelineSummary({ value }: { value: unknown }) {
  const config = useMemo<NeedsPipelineConfig | null>(() => {
    const parsed = NeedsPipelineConfigSchema.safeParse(value ?? {});
    return parsed.success ? parsed.data : null;
  }, [value]);

  if (!config) {
    return (
      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Needs assessment cycle</h3>
        <p className="text-xs text-rose-700">The stored needs assessment rules of this project type cannot be read. They are kept as they are when you save.</p>
      </section>
    );
  }

  if (!config.enabled) {
    return (
      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Needs assessment cycle</h3>
        <p className="text-xs text-slate-600">
          This project type has no needs assessment cycle. Its projects are not proposed, validated, costed and approved on the platform before they are created.
        </p>
      </section>
    );
  }

  const reference = config.referencePrefix === "MG" ? "<year>-MG-<State>-<number>, e.g. 2027-MG-KN-007" : "<year>-DI-<number>, e.g. 2027-DI-014";

  return (
    <>
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        These rules are shown for reference and cannot be edited here yet. A cycle keeps its own copy from the day it opens, so later changes apply to new cycles only.
      </p>

      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Cycle</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Cycles" value={config.cycleScope === "STATE" ? "One per State each year" : "One national cycle each year"} />
          <Fact label="Opens" value={`${monthDay(config.cycleOpens)}, the year before the intervention year`} />
          <Fact
            label="Becomes a project"
            value={config.fundingGate === "BEAP_APPROVAL" ? "When UBEC approves the State's BEAP" : "At appropriation"}
          />
          <Fact label="Reference" value={reference} />
        </dl>
      </section>

      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Stages and deadlines</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr>
                <th scope="col" className={thCls}>Stage</th>
                <th scope="col" className={thCls}>Who moves it on</th>
                <th scope="col" className={thCls}>Deadline</th>
                <th scope="col" className={thCls}>Needs assessment must have</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {config.stages.map((s, i) => (
                <tr key={s.stage}>
                  <td className={`${tdCls} font-medium text-slate-900`}>
                    {i + 1}. {s.label}
                  </td>
                  <td className={tdCls}>{permissionName(s.actorPermissionKey)}</td>
                  <td className={tdCls}>{monthDay(s.deadline)}</td>
                  <td className={tdCls}>
                    {(config.minimumFields[s.stage] ?? []).map((f) => NEEDS_TEMPLATE_FIELD_LABELS[f]).join(", ") || "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {config.extraDeadlines.length > 0 && (
          <ul className="space-y-1 text-xs text-slate-700">
            {config.extraDeadlines.map((d) => (
              <li key={d.key}>
                <span className="font-medium">{monthDay(d.deadline)}:</span> {d.label}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Scoring rubric</h3>
        <p className="text-xs text-slate-600">
          Each committee member scores every criterion from 1 to {config.rubric.scale}. Scores {config.rubric.divergenceThreshold} or more points apart on a
          criterion are flagged. The chair can close a proposed project with at least {config.rubric.quorum} score sheets.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {config.rubric.dimensions.map((d) => (
            <div key={d.key}>
              <h4 className="text-xs font-bold text-slate-900">
                {d.label || DIMENSION_LABELS[d.key]} · {d.weight}%
              </h4>
              <ul className="mt-1 space-y-2">
                {config.rubric.criteria
                  .filter((c) => c.dimension === d.key)
                  .map((c) => (
                    <li key={c.key} className="text-xs text-slate-700">
                      <span className="font-medium text-slate-900">{c.label}</span>
                      <span className="block text-[11px] text-slate-500">
                        1: {c.descriptors[0]} · {config.rubric.scale}: {c.descriptors[c.descriptors.length - 1]}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Checks</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact
            label="Essential facilities at every site"
            value={config.essentialFacilityGroups.map((g) => g.label).join(", ") || "None"}
          />
          <Fact label="Rate tolerance against the costing standard" value={`± ${config.rateVarianceTolerancePct}%`} />
          <Fact
            label="Possible duplicate"
            value={`Same school, or within ${config.duplicateRadiusMeters} m, in the last ${config.duplicateLookbackYears} year(s)`}
          />
          <Fact label="Site verification before validation" value={config.requireSiteVerification ? "Required" : "Not required"} />
          <Fact
            label="Counterpart funding evidence before activation"
            value={config.requireCounterpartEvidenceBeforeActivation ? "Required" : "Not required"}
          />
        </dl>
      </section>

      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Approval chains</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {NeedsChainTypeEnum.options
            .filter((chain) => config.approvalChains[chain].length > 0)
            .map((chain) => (
              <div key={chain}>
                <h4 className="text-xs font-bold text-slate-900">{CHAIN_LABELS[chain]}</h4>
                <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-slate-700">
                  {config.approvalChains[chain].map((step, i) => (
                    <li key={`${chain}-${i}`}>
                      <span className="font-medium text-slate-900">{step.label}</span>
                      <span className="block text-[11px] text-slate-500">
                        {permissionName(step.requiredPermissionKey)} · {APPROVAL_ORGANIZATION_SCOPE_META[step.organizationScope].label}
                        {step.deadline ? ` · by ${monthDay(step.deadline)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
        </div>
      </section>
    </>
  );
}
