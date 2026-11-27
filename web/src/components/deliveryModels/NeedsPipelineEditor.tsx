import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import {
  APPROVAL_ORGANIZATION_SCOPE_META,
  ApprovalOrganizationScopeEnum,
  NEEDS_STAGE_LABELS,
  NEEDS_STAGE_ORDER,
  NEEDS_TEMPLATE_FIELD_LABELS,
  NeedsChainTypeEnum,
  NeedsPipelineConfigSchema,
  NeedsTemplateFieldKeyEnum,
  RUBRIC_SCALE,
  SYSTEM_PERMISSIONS_CATALOG,
  ScoreDimensionEnum,
  type ApprovalOrganizationScope,
  type MonthDay,
  type NeedsChainStepConfig,
  type NeedsChainType,
  type NeedsPipelineConfig,
  type NeedsStage,
  type NeedsTemplateFieldKey,
  type RubricCriterion,
  type ScoreDimension,
} from "@insite/shared";
import { CustomSelect } from "../common/CustomSelect";
import { useFacilitiesQuery } from "../../queries/facilities/useFacilityQueries";

/**
 * Needs pipeline wave 2 (C6): the "Needs assessment" tab of the project type editor, an editor of the
 * type config key `needsPipeline` (plan 17.4). The value is read with the schema's defaults, edited
 * here and handed back whole; the type editor saves it with the rest of the type. Problems found by
 * `NeedsPipelineConfigSchema` (incl. `needsPipelineConfigIssues`) are shown next to their section. A
 * cycle keeps its own copy of these rules from the day it opens, so edits apply to cycles opened later.
 */

const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const smallInputCls = "rounded-xl border border-slate-300 px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const labelCls = "text-xs font-medium text-slate-700";
const iconButton =
  "rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:opacity-30";
const addButton = "inline-flex items-center gap-1 rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

const CHAIN_LABELS: Record<NeedsChainType, string> = {
  NEEDS_PORTFOLIO: "Portfolio approval",
  BEAP: "BEAP approval",
  OUT_OF_CYCLE: "Out-of-cycle approval",
};
const DIMENSION_LABELS: Record<ScoreDimension, string> = { IMPACT: "Impact", EASE: "Ease of implementation" };

/** Needs pipeline permissions, for stage actors and chain steps. */
const NEEDS_PERMISSIONS = SYSTEM_PERMISSIONS_CATALOG.filter((p) => p.category === "NEEDS_FUNDING" && p.key.startsWith("needs:")).map((p) => ({
  value: p.key,
  label: p.name,
  description: p.key,
}));

/** The stored value read with every default applied (no cross-field checks); null when unreadable. */
function readConfig(value: unknown): NeedsPipelineConfig | null {
  const parsed = NeedsPipelineConfigSchema.innerType().safeParse(value ?? {});
  return parsed.success ? (parsed.data as NeedsPipelineConfig) : null;
}

type Issue = { path: Array<string | number>; message: string };

export function NeedsPipelineEditor({ value, onChange }: { value: unknown; onChange: (next: NeedsPipelineConfig) => void }) {
  const config = useMemo(() => readConfig(value), [value]);
  const issues = useMemo<Issue[]>(() => {
    if (!config) return [];
    const parsed = NeedsPipelineConfigSchema.safeParse(config);
    return parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path as Array<string | number>, message: i.message }));
  }, [config]);
  const facilitiesQuery = useFacilitiesQuery(true);
  const facilityOptions = useMemo(
    () => (facilitiesQuery.data ?? []).filter((f) => !f.isRetired).map((f) => ({ value: f.code, label: f.name, description: f.code })),
    [facilitiesQuery.data]
  );
  const facilityName = (code: string) => facilitiesQuery.data?.find((f) => f.code.toUpperCase() === code.toUpperCase())?.name ?? code;

  if (!config) {
    return (
      <section className={sectionCls}>
        <h3 className="text-sm font-bold text-slate-900">Needs assessment cycle</h3>
        <p className="text-xs text-rose-700">The stored needs assessment rules of this project type cannot be read. They are kept as they are when you save.</p>
      </section>
    );
  }

  const set = (patch: Partial<NeedsPipelineConfig>) => onChange({ ...config, ...patch });
  const issuesAt = (...prefix: Array<string | number>) => issues.filter((i) => prefix.every((p, n) => i.path[n] === p));

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        A cycle keeps its own copy of these rules from the day it opens: changes saved here apply to cycles opened afterwards, never to a cycle already open.
      </p>

      {/* ------------------------------------------------------------- cycle */}
      <section className={sectionCls} aria-labelledby="np-cycle">
        <h3 id="np-cycle" className="text-sm font-bold text-slate-900">
          Cycle
        </h3>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={config.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>
            <span className="font-medium">This programme runs an annual needs assessment cycle</span>
            <span className="block text-[11px] text-slate-500">Off: its projects are created directly, without proposal, validation, costing and approval.</span>
          </span>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className={labelCls}>Becomes a project</p>
            <CustomSelect
              ariaLabel="Becomes a project"
              value={config.fundingGate}
              onChange={(v) => set({ fundingGate: v as NeedsPipelineConfig["fundingGate"] })}
              options={[
                { value: "APPROPRIATION", label: "At appropriation" },
                { value: "BEAP_APPROVAL", label: "When UBEC approves the BEAP" },
              ]}
              size="sm"
            />
          </div>
          <div>
            <p className={labelCls}>Cycles</p>
            <CustomSelect
              ariaLabel="Cycles"
              value={config.cycleScope}
              onChange={(v) => set({ cycleScope: v as NeedsPipelineConfig["cycleScope"] })}
              options={[
                { value: "NATIONAL", label: "One national cycle each year" },
                { value: "STATE", label: "One cycle per State each year" },
              ]}
              size="sm"
            />
          </div>
          <div>
            <p className={labelCls}>Reference</p>
            <CustomSelect
              ariaLabel="Reference"
              value={config.referencePrefix}
              onChange={(v) => set({ referencePrefix: v as NeedsPipelineConfig["referencePrefix"] })}
              options={[
                { value: "DI", label: "2027-DI-014", description: "<year>-DI-<number>" },
                { value: "MG", label: "2027-MG-KN-007", description: "<year>-MG-<State>-<number>" },
              ]}
              size="sm"
            />
          </div>
          <div>
            <p className={labelCls}>Opens (the year before the intervention year)</p>
            <MonthDayInput value={config.cycleOpens} onChange={(cycleOpens) => cycleOpens && set({ cycleOpens })} label="Cycle opens" />
          </div>
        </div>
        <Issues items={issuesAt("cycleOpens")} />
      </section>

      {/* ------------------------------------------------------------ stages */}
      <StagesSection config={config} set={set} issues={issuesAt("stages")} />

      {/* ----------------------------------------------------- extra dates */}
      <ExtraDeadlinesSection config={config} set={set} issues={issuesAt("extraDeadlines")} />

      {/* -------------------------------------------------- minimum fields */}
      <section className={sectionCls} aria-labelledby="np-minimum">
        <h3 id="np-minimum" className="text-sm font-bold text-slate-900">
          What a needs assessment must contain to leave each stage
        </h3>
        {config.stages.length === 0 ? (
          <p className="text-xs text-slate-500">Add the stages first.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Minimum fields per stage">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Stage
                  </th>
                  {NeedsTemplateFieldKeyEnum.options.map((f) => (
                    <th key={f} scope="col" className="px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600">
                      {NEEDS_TEMPLATE_FIELD_LABELS[f]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {config.stages.map((s) => {
                  const fields = config.minimumFields[s.stage] ?? [];
                  const toggle = (f: NeedsTemplateFieldKey, on: boolean) => {
                    const next = on ? NeedsTemplateFieldKeyEnum.options.filter((k) => k === f || fields.includes(k)) : fields.filter((k) => k !== f);
                    const minimumFields = { ...config.minimumFields };
                    if (next.length) minimumFields[s.stage] = next;
                    else delete minimumFields[s.stage];
                    set({ minimumFields });
                  };
                  return (
                    <tr key={s.stage}>
                      <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-900">
                        {s.label}
                      </th>
                      {NeedsTemplateFieldKeyEnum.options.map((f) => (
                        <td key={f} className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`${s.label}: ${NEEDS_TEMPLATE_FIELD_LABELS[f]}`}
                            checked={fields.includes(f)}
                            onChange={(e) => toggle(f, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-500">Drawings are proposal documents, checked when the proposed project is submitted; the rest are read from the needs assessment file.</p>
        <Issues items={issuesAt("minimumFields")} />
      </section>

      {/* ------------------------------------------------------------ rubric */}
      <RubricSection config={config} set={set} issues={issuesAt("rubric")} />

      {/* --------------------------------------------------- essential groups */}
      <section className={sectionCls} aria-labelledby="np-essential">
        <div>
          <h3 id="np-essential" className="text-sm font-bold text-slate-900">
            Essential facilities at every site
          </h3>
          <p className="text-[11px] text-slate-500">Each site needs work proposed, or an existing Functional facility, in every group; a gap is flagged for validation.</p>
        </div>
        {config.essentialFacilityGroups.map((g, gi) => (
          <div key={gi} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                className={inputCls}
                aria-label={`Group ${gi + 1} name`}
                value={g.label}
                maxLength={80}
                onChange={(e) =>
                  set({ essentialFacilityGroups: config.essentialFacilityGroups.map((x, i) => (i === gi ? { ...x, label: e.target.value } : x)) })
                }
              />
              <button
                type="button"
                className={iconButton}
                aria-label={`Remove group ${g.label || gi + 1}`}
                onClick={() => set({ essentialFacilityGroups: config.essentialFacilityGroups.filter((_, i) => i !== gi) })}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {g.facilityCodes.map((code) => (
                <span key={code} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-800">
                  {facilityName(code)}
                  <button
                    type="button"
                    className="rounded-full text-slate-500 hover:text-rose-700"
                    aria-label={`Remove ${facilityName(code)} from ${g.label}`}
                    onClick={() =>
                      set({
                        essentialFacilityGroups: config.essentialFacilityGroups.map((x, i) => (i === gi ? { ...x, facilityCodes: x.facilityCodes.filter((c) => c !== code) } : x)),
                      })
                    }
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <div className="w-56">
                <CustomSelect
                  ariaLabel={`Add a facility to ${g.label || `group ${gi + 1}`}`}
                  value=""
                  placeholder="Add a facility"
                  onChange={(code) =>
                    code &&
                    set({
                      essentialFacilityGroups: config.essentialFacilityGroups.map((x, i) =>
                        i === gi && !x.facilityCodes.includes(code) ? { ...x, facilityCodes: [...x.facilityCodes, code] } : x
                      ),
                    })
                  }
                  options={facilityOptions.filter((o) => !g.facilityCodes.includes(o.value))}
                  size="sm"
                  searchable
                />
              </div>
            </div>
            <Issues items={issuesAt("essentialFacilityGroups", gi)} />
          </div>
        ))}
        <button type="button" className={addButton} onClick={() => set({ essentialFacilityGroups: [...config.essentialFacilityGroups, { label: "", facilityCodes: [] }] })}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add group
        </button>
      </section>

      {/* ---------------------------------------------------------- checks */}
      <section className={sectionCls} aria-labelledby="np-checks">
        <h3 id="np-checks" className="text-sm font-bold text-slate-900">
          Checks
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label="Rate tolerance against the costing standard (%)"
            value={config.rateVarianceTolerancePct}
            min={0}
            max={100}
            onChange={(rateVarianceTolerancePct) => set({ rateVarianceTolerancePct })}
          />
          <NumberField
            label="Possible duplicate within (metres)"
            value={config.duplicateRadiusMeters}
            min={0}
            max={5000}
            integer
            onChange={(duplicateRadiusMeters) => set({ duplicateRadiusMeters })}
          />
          <NumberField
            label="Look back for duplicates (years)"
            value={config.duplicateLookbackYears}
            min={0}
            max={20}
            integer
            onChange={(duplicateLookbackYears) => set({ duplicateLookbackYears })}
          />
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={config.requireSiteVerification} onChange={(e) => set({ requireSiteVerification: e.target.checked })} />
          <span className="font-medium">Validation needs a site verification for every proposed project</span>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={config.requireCounterpartEvidenceBeforeActivation}
            onChange={(e) => set({ requireCounterpartEvidenceBeforeActivation: e.target.checked })}
          />
          <span className="font-medium">A project from this cycle cannot start until the counterpart funding evidence is recorded</span>
        </label>
        <Issues items={[...issuesAt("rateVarianceTolerancePct"), ...issuesAt("duplicateRadiusMeters"), ...issuesAt("duplicateLookbackYears")]} />
      </section>

      {/* ---------------------------------------------------------- chains */}
      <section className={sectionCls} aria-labelledby="np-chains">
        <div>
          <h3 id="np-chains" className="text-sm font-bold text-slate-900">
            Approval chains
          </h3>
          <p className="text-[11px] text-slate-500">
            Steps in order. "Owning organisation" is the cycle's owner (UBEC HQ for a national cycle, the State's SUBEB for a State cycle).
          </p>
        </div>
        {NeedsChainTypeEnum.options.map((chain) => (
          <ChainEditor
            key={chain}
            chain={chain}
            steps={config.approvalChains[chain]}
            onChange={(steps) => set({ approvalChains: { ...config.approvalChains, [chain]: steps } })}
            issues={issuesAt("approvalChains", chain)}
            optional={chain === "BEAP" && config.fundingGate !== "BEAP_APPROVAL"}
          />
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

function StagesSection({ config, set, issues }: { config: NeedsPipelineConfig; set: (p: Partial<NeedsPipelineConfig>) => void; issues: Issue[] }) {
  const missing = NEEDS_STAGE_ORDER.filter((s) => !config.stages.some((x) => x.stage === s));
  const [toAdd, setToAdd] = useState<NeedsStage | "">("");
  useEffect(() => setToAdd(""), [config.stages.length]);
  const update = (i: number, patch: Partial<NeedsPipelineConfig["stages"][number]>) =>
    set({ stages: config.stages.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
  const add = (stage: NeedsStage) => {
    const next = [...config.stages, { stage, label: NEEDS_STAGE_LABELS[stage], actorPermissionKey: null, deadline: null }];
    next.sort((a, b) => NEEDS_STAGE_ORDER.indexOf(a.stage) - NEEDS_STAGE_ORDER.indexOf(b.stage));
    set({ stages: next });
  };
  const remove = (i: number) => {
    const stage = config.stages[i].stage;
    const minimumFields = { ...config.minimumFields };
    delete minimumFields[stage];
    set({ stages: config.stages.filter((_, n) => n !== i), minimumFields });
  };

  return (
    <section className={sectionCls} aria-labelledby="np-stages">
      <div>
        <h3 id="np-stages" className="text-sm font-bold text-slate-900">
          Stages and deadlines
        </h3>
        <p className="text-[11px] text-slate-500">
          In process order. Every cycle needs Identification, Validation, Costing, Prioritisation, Approval and Funding; the design stage is optional.
        </p>
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Stages">
        <table className="min-w-[760px] w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-2 py-1.5">Stage</th>
              <th scope="col" className="px-2 py-1.5">Name shown</th>
              <th scope="col" className="px-2 py-1.5">Who moves it on</th>
              <th scope="col" className="px-2 py-1.5">Deadline</th>
              <th scope="col" className="px-2 py-1.5">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {config.stages.map((s, i) => (
              <tr key={s.stage}>
                <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-900">{NEEDS_STAGE_LABELS[s.stage]}</td>
                <td className="px-2 py-1.5">
                  <input className={inputCls} aria-label={`${NEEDS_STAGE_LABELS[s.stage]} name`} value={s.label} maxLength={80} onChange={(e) => update(i, { label: e.target.value })} />
                </td>
                <td className="w-64 px-2 py-1.5">
                  <CustomSelect
                    ariaLabel={`${NEEDS_STAGE_LABELS[s.stage]}: who moves it on`}
                    value={s.actorPermissionKey ?? ""}
                    onChange={(v) => update(i, { actorPermissionKey: v || null })}
                    options={[{ value: "", label: "An approval chain", description: "No single permission" }, ...NEEDS_PERMISSIONS]}
                    size="sm"
                    searchable
                  />
                </td>
                <td className="px-2 py-1.5">
                  <MonthDayInput value={s.deadline} onChange={(deadline) => update(i, { deadline })} label={`${NEEDS_STAGE_LABELS[s.stage]} deadline`} allowNone />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" className={iconButton} aria-label={`Remove the ${s.label} stage`} onClick={() => remove(i)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-60">
            <CustomSelect
              ariaLabel="Stage to add"
              value={toAdd}
              onChange={(v) => setToAdd(v as NeedsStage)}
              options={missing.map((s) => ({ value: s, label: NEEDS_STAGE_LABELS[s] }))}
              placeholder="Choose a stage to add"
              size="sm"
            />
          </div>
          <button type="button" className={addButton} disabled={!toAdd} onClick={() => toAdd && add(toAdd)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add stage
          </button>
        </div>
      )}
      <Issues items={issues} />
    </section>
  );
}

function ExtraDeadlinesSection({ config, set, issues }: { config: NeedsPipelineConfig; set: (p: Partial<NeedsPipelineConfig>) => void; issues: Issue[] }) {
  const update = (i: number, patch: Partial<NeedsPipelineConfig["extraDeadlines"][number]>) =>
    set({ extraDeadlines: config.extraDeadlines.map((d, n) => (n === i ? { ...d, ...patch } : d)) });
  const stageOptions = (config.stages.length ? config.stages.map((s) => s.stage) : NEEDS_STAGE_ORDER).map((s) => ({
    value: s,
    label: config.stages.find((x) => x.stage === s)?.label ?? NEEDS_STAGE_LABELS[s],
  }));
  return (
    <section className={sectionCls} aria-labelledby="np-extra">
      <div>
        <h3 id="np-extra" className="text-sm font-bold text-slate-900">
          Other dates
        </h3>
        <p className="text-[11px] text-slate-500">Dated events that are not the end of a stage, e.g. "Budget submission to the Ministry". The key never changes once a cycle uses it.</p>
      </div>
      {config.extraDeadlines.map((d, i) => (
        <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[10rem_1fr_12rem_auto_auto]">
          <label className={labelCls}>
            Key
            <input className={inputCls} value={d.key} maxLength={48} placeholder="budget-submission" onChange={(e) => update(i, { key: e.target.value.toLowerCase() })} />
          </label>
          <label className={labelCls}>
            Label
            <input className={inputCls} value={d.label} maxLength={120} onChange={(e) => update(i, { label: e.target.value })} />
          </label>
          <div>
            <p className={labelCls}>Stage</p>
            <CustomSelect ariaLabel={`${d.label || "Date"} stage`} value={d.stage} onChange={(v) => update(i, { stage: v as NeedsStage })} options={stageOptions} size="sm" />
          </div>
          <div>
            <p className={labelCls}>Date</p>
            <MonthDayInput value={d.deadline} onChange={(deadline) => deadline && update(i, { deadline })} label={`${d.label || "Date"} date`} />
          </div>
          <button type="button" className={iconButton} aria-label={`Remove ${d.label || "this date"}`} onClick={() => set({ extraDeadlines: config.extraDeadlines.filter((_, n) => n !== i) })}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={addButton}
        onClick={() =>
          set({
            extraDeadlines: [
              ...config.extraDeadlines,
              { key: "", label: "", stage: config.stages[0]?.stage ?? "IDENTIFICATION", deadline: { month: 1, day: 1 } },
            ],
          })
        }
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add date
      </button>
      <Issues items={issues} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

function RubricSection({ config, set, issues }: { config: NeedsPipelineConfig; set: (p: Partial<NeedsPipelineConfig>) => void; issues: Issue[] }) {
  const rubric = config.rubric;
  const setRubric = (patch: Partial<NeedsPipelineConfig["rubric"]>) => set({ rubric: { ...rubric, ...patch } });
  const dimension = (key: ScoreDimension) => rubric.dimensions.find((d) => d.key === key);
  const setDimension = (key: ScoreDimension, patch: Partial<{ label: string; weight: number }>) => {
    const existing = dimension(key) ?? { key, label: DIMENSION_LABELS[key], weight: 0 };
    const others = rubric.dimensions.filter((d) => d.key !== key);
    const next = [...others, { ...existing, ...patch }].sort((a, b) => ScoreDimensionEnum.options.indexOf(a.key) - ScoreDimensionEnum.options.indexOf(b.key));
    setRubric({ dimensions: next });
  };
  const updateCriterion = (i: number, patch: Partial<RubricCriterion>) => setRubric({ criteria: rubric.criteria.map((c, n) => (n === i ? { ...c, ...patch } : c)) });
  const weightTotal = rubric.dimensions.reduce((s, d) => s + d.weight, 0);

  return (
    <section className={sectionCls} aria-labelledby="np-rubric">
      <div>
        <h3 id="np-rubric" className="text-sm font-bold text-slate-900">
          Scoring rubric
        </h3>
        <p className="text-[11px] text-slate-500">
          Committee members score every criterion from 1 to {RUBRIC_SCALE}; criteria weigh the same inside a dimension. Each score has a descriptor so members
          score alike.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ScoreDimensionEnum.options.map((key) => {
          const d = dimension(key);
          return (
            <div key={key} className="grid grid-cols-[1fr_6rem] gap-2">
              <label className={labelCls}>
                {DIMENSION_LABELS[key]}: name
                <input className={inputCls} value={d?.label ?? ""} maxLength={80} onChange={(e) => setDimension(key, { label: e.target.value })} />
              </label>
              <NumberField label="Weight %" value={d?.weight ?? 0} min={0} max={100} onChange={(weight) => setDimension(key, { weight })} />
            </div>
          );
        })}
      </div>
      <p className={`text-[11px] ${Math.abs(weightTotal - 100) > 0.001 ? "font-semibold text-rose-700" : "text-slate-500"}`}>Weights add up to {weightTotal}% (must be 100%).</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField
          label="Scores this many points apart are flagged"
          value={rubric.divergenceThreshold}
          min={1}
          max={RUBRIC_SCALE - 1}
          integer
          onChange={(divergenceThreshold) => setRubric({ divergenceThreshold })}
        />
        <NumberField label="Fewest score sheets to close a proposed project" value={rubric.quorum} min={1} max={50} integer onChange={(quorum) => setRubric({ quorum })} />
      </div>

      {ScoreDimensionEnum.options.map((dim) => (
        <div key={dim} className="space-y-2">
          <h4 className="text-xs font-bold text-slate-900">{dimension(dim)?.label || DIMENSION_LABELS[dim]} criteria</h4>
          {rubric.criteria.map((c, i) =>
            c.dimension !== dim ? null : (
              <details key={i} className="group rounded-xl border border-slate-200 p-3" open={!c.key || !c.label}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900">{c.label || "New criterion"}</span>
                  <span className="text-[11px] text-brand-primary group-open:hidden">Edit</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_auto]">
                    <label className={labelCls}>
                      Key
                      <input className={inputCls} value={c.key} maxLength={48} placeholder="severity_of_need" onChange={(e) => updateCriterion(i, { key: e.target.value.toLowerCase() })} />
                    </label>
                    <label className={labelCls}>
                      Criterion
                      <input className={inputCls} value={c.label} maxLength={120} onChange={(e) => updateCriterion(i, { label: e.target.value })} />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={`Remove the criterion ${c.label || c.key}`}
                        onClick={() => setRubric({ criteria: rubric.criteria.filter((_, n) => n !== i) })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <ol className="space-y-1">
                    {Array.from({ length: RUBRIC_SCALE }, (_, n) => (
                      <li key={n} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 text-[11px] font-semibold text-slate-600">Score {n + 1}</span>
                        <input
                          className={inputCls}
                          aria-label={`${c.label || "Criterion"}: what score ${n + 1} means`}
                          value={c.descriptors[n] ?? ""}
                          maxLength={300}
                          onChange={(e) => {
                            const descriptors = Array.from({ length: RUBRIC_SCALE }, (_, k) => (k === n ? e.target.value : c.descriptors[k] ?? ""));
                            updateCriterion(i, { descriptors });
                          }}
                        />
                      </li>
                    ))}
                  </ol>
                  <Issues items={issues.filter((x) => x.path[1] === "criteria" && x.path[2] === i)} />
                </div>
              </details>
            )
          )}
          <button
            type="button"
            className={addButton}
            onClick={() => setRubric({ criteria: [...rubric.criteria, { key: "", dimension: dim, label: "", descriptors: Array.from({ length: RUBRIC_SCALE }, () => "") }] })}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add {DIMENSION_LABELS[dim].toLowerCase()} criterion
          </button>
        </div>
      ))}
      <Issues items={issues.filter((x) => !(x.path[1] === "criteria" && typeof x.path[2] === "number"))} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

function ChainEditor({
  chain,
  steps,
  onChange,
  issues,
  optional,
}: {
  chain: NeedsChainType;
  steps: NeedsChainStepConfig[];
  onChange: (steps: NeedsChainStepConfig[]) => void;
  issues: Issue[];
  optional: boolean;
}) {
  const update = (i: number, patch: Partial<NeedsChainStepConfig>) => onChange(steps.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    onChange(next);
  };
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      <h4 className="text-xs font-bold text-slate-900">
        {CHAIN_LABELS[chain]}
        {optional && <span className="ml-1 font-normal text-slate-500">(used only when the project is created at UBEC's BEAP approval)</span>}
      </h4>
      {steps.length === 0 && <p className="text-xs text-slate-500">No steps.</p>}
      {steps.map((s, i) => (
        <div key={i} className="grid grid-cols-1 items-end gap-2 lg:grid-cols-[1.5rem_1fr_14rem_12rem_auto_auto]">
          <span className="text-xs font-semibold text-slate-500">{i + 1}.</span>
          <label className={labelCls}>
            Step
            <input className={inputCls} value={s.label} maxLength={120} onChange={(e) => update(i, { label: e.target.value })} />
          </label>
          <div>
            <p className={labelCls}>Permission</p>
            <CustomSelect
              ariaLabel={`${s.label || `Step ${i + 1}`} permission`}
              value={s.requiredPermissionKey}
              onChange={(v) => update(i, { requiredPermissionKey: v })}
              options={NEEDS_PERMISSIONS}
              placeholder="Choose the permission"
              size="sm"
              searchable
            />
          </div>
          <div>
            <p className={labelCls}>Organisation</p>
            <CustomSelect
              ariaLabel={`${s.label || `Step ${i + 1}`} organisation`}
              value={s.organizationScope}
              onChange={(v) => update(i, { organizationScope: v as ApprovalOrganizationScope })}
              options={ApprovalOrganizationScopeEnum.options.map((o) => ({ value: o, label: APPROVAL_ORGANIZATION_SCOPE_META[o].label }))}
              size="sm"
            />
          </div>
          <div>
            <p className={labelCls}>By</p>
            <MonthDayInput value={s.deadline} onChange={(deadline) => update(i, { deadline })} label={`${s.label || `Step ${i + 1}`} deadline`} allowNone />
          </div>
          <div className="flex items-center">
            <button type="button" className={iconButton} aria-label={`Move ${s.label || `step ${i + 1}`} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={iconButton} aria-label={`Move ${s.label || `step ${i + 1}`} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={iconButton} aria-label={`Remove ${s.label || `step ${i + 1}`}`} onClick={() => onChange(steps.filter((_, n) => n !== i))}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className={addButton}
        onClick={() => onChange([...steps, { label: "", requiredPermissionKey: NEEDS_PERMISSIONS[0]?.value ?? "needs:view", organizationScope: "PROJECT_OWNER", deadline: null }])}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add step
      </button>
      <Issues items={issues} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Month and day; with `allowNone`, a "No fixed date" choice. */
function MonthDayInput({
  value,
  onChange,
  label,
  allowNone = false,
}: {
  value: MonthDay | null;
  onChange: (next: MonthDay | null) => void;
  label: string;
  allowNone?: boolean;
}) {
  const monthOptions = allowNone ? [{ value: "", label: "No fixed date" }, ...MONTH_OPTIONS] : MONTH_OPTIONS;
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        max={31}
        aria-label={`${label}: day`}
        className={`${smallInputCls} w-16`}
        value={value?.day ?? ""}
        disabled={!value}
        onChange={(e) => {
          const day = Math.round(Number(e.target.value));
          if (value && Number.isFinite(day) && day >= 1 && day <= 31) onChange({ ...value, day });
        }}
      />
      <div className="w-36">
        <CustomSelect
          ariaLabel={`${label}: month`}
          value={value ? String(value.month) : ""}
          onChange={(v) => onChange(v ? { month: Number(v), day: value?.day ?? 1 } : null)}
          options={monthOptions}
          size="sm"
        />
      </div>
    </div>
  );
}

/** A number typed as text; only finite numbers in range are passed on. */
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  integer = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  integer?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text.replace(/,/g, ""));
  const bad = text.trim() === "" || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n));
  return (
    <label className={labelCls}>
      {label}
      <input
        inputMode={integer ? "numeric" : "decimal"}
        className={`${inputCls} ${bad ? "border-rose-400" : ""}`}
        value={text}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value.replace(/,/g, ""));
          if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v))) onChange(v);
        }}
        onBlur={() => setText(String(value))}
      />
      {bad && (
        <span className="mt-0.5 block text-[11px] font-medium text-rose-700">
          Enter {integer ? "a whole number" : "a number"} from {min} to {max}.
        </span>
      )}
    </label>
  );
}

function Issues({ items }: { items: Issue[] }) {
  if (items.length === 0) return null;
  return (
    <ul role="alert" className="list-disc rounded-xl border border-rose-200 bg-rose-50 p-2 pl-6 text-[11px] text-rose-700">
      {items.map((i, n) => (
        <li key={`${n}-${i.message}`}>{i.message}</li>
      ))}
    </ul>
  );
}
