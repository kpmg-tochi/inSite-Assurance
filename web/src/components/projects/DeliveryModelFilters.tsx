import React, { useId, useMemo, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  FUNDING_SOURCES,
  stateByCode,
  type NigeriaZoneCode,
  type ProjectDeliveryModelFields,
  type ProjectListFilters,
  type ProjectRegisterFilterOptionsDto,
  type ProjectTypeSummary,
  type RegionDto,
} from "@insite/shared";

const NO_REGIONS: RegionDto[] = [];
import { CustomSelect } from "../common";
import { lgaOptions, stateOptions, zoneOptions } from "../common/AdminAreaSelect";
import { useProjectTypesQuery, useRegionsQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";

/** Phase 11: the delivery-model chip on project cards and rows. */
export function ProjectTypeChip({ type }: { type: ProjectTypeSummary | null | undefined }) {
  if (!type) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700"
      title={`${type.name} (version ${type.version})`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: type.colour ?? "#94a3b8" }} />
      {type.name}
    </span>
  );
}

export function useDeliveryModelFilters() {
  const [filters, setFilters] = useState<ProjectListFilters>({});
  const regionsQuery = useRegionsQuery(true);
  /** A region filter matches the region itself and its areas. */
  const matches = useMemo(() => {
    const regions = regionsQuery.data ?? [];
    return (p: ProjectDeliveryModelFields) => {
      if (filters.projectTypeId && p.projectType?.id !== filters.projectTypeId) return false;
      if (filters.owningOrganizationId && p.owningOrganization?.id !== filters.owningOrganizationId) return false;
      if (filters.regionId) {
        const r = p.region ? regions.find((x) => x.id === p.region!.id) : null;
        if (!r || (r.id !== filters.regionId && r.parentRegionId !== filters.regionId)) return false;
      }
      return true;
    };
  }, [filters, regionsQuery.data]);
  return { filters, setFilters, matches };
}

/**
 * The project filter bar (design round 2026-11-26): the everyday filters in one row of compact
 * selects, the rest behind "More filters" (its badge counts the ones in use), "Clear filters" while
 * any is set. Two columns on a tablet, one on a phone.
 *
 * Type, region and owning organisation filters. Each select appears only when it has something to
 * choose from, so tenants without delivery models see nothing new.
 *
 * Client demo updates (wave 1), with `register`: the project register's location filters are the
 * national zone → state → LGA lists (codes; the LGA list follows the state), and the funding source
 * is the fixed list. The programme-region select and the free-text LGA and funding filters stay for
 * links that already carry them (the free-text LGA list also shows while no state is chosen, for
 * older projects without codes).
 */
export function DeliveryModelFilters({
  filters,
  onChange,
  owners,
  registerOptions,
  register = false,
}: {
  filters: ProjectListFilters;
  onChange: (next: ProjectListFilters) => void;
  /** Owning organisations present in the list being filtered. */
  owners: Array<{ id: string; name: string }>;
  /**
   * UBEC IRL: the project register's extra filters (LGA, contractor, intervention year, funding
   * source), from GET /projects/register/options. Left out (e.g. the KPI page): not shown.
   */
  registerOptions?: ProjectRegisterFilterOptionsDto | null;
  /** The project register (home page): zone, state, LGA and funding source code filters. */
  register?: boolean;
}) {
  const types = useProjectTypesQuery(true).data ?? [];
  const regions = useRegionsQuery(true).data ?? NO_REGIONS;
  const moreId = useId();
  // A link that carries a filter kept behind "More filters" opens it, so the filter in use is visible.
  const [moreOpen, setMoreOpen] = useState(() =>
    Boolean(
      register &&
        (filters.owningOrganizationId ||
          filters.contractorOrganizationId ||
          filters.fundingSourceCode ||
          filters.fundingSource ||
          filters.regionId ||
          (filters.stateCode && filters.lga))
    )
  );
  const regionOptions = useMemo(() => {
    const top = regions.filter((r) => !r.parentRegionId);
    return top.flatMap((r) => [
      { value: r.id, label: r.name },
      ...regions.filter((a) => a.parentRegionId === r.id).map((a) => ({ value: a.id, label: `${r.name} › ${a.name}` })),
    ]);
  }, [regions]);
  const uniqueOwners = useMemo(() => {
    const seen = new Map<string, string>();
    owners.forEach((o) => seen.set(o.id, o.name));
    registerOptions?.owners.forEach((o) => seen.set(o.id, o.name));
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [owners, registerOptions]);
  const zones = useMemo(() => zoneOptions("All zones"), []);
  const states = useMemo(() => stateOptions(filters.zone ?? null, "All states"), [filters.zone]);
  const lgaCodes = useMemo(() => lgaOptions(filters.stateCode ?? null, "All LGAs"), [filters.stateCode]);
  const lgas = registerOptions?.lgas ?? [];
  const contractors = registerOptions?.contractors ?? [];
  const years = registerOptions?.interventionYears ?? [];
  const fundingSources = registerOptions?.fundingSources ?? [];
  const hasRegisterFilters = register || lgas.length + contractors.length + years.length + fundingSources.length > 0;
  // In the register the national lists replace the programme regions; a link that carries one keeps it clearable.
  const showRegions = regions.length > 0 && (!register || Boolean(filters.regionId));
  // The free-text LGA list: older projects without an LGA code, while no state is chosen (or a link that carries one).
  const showTextLgas = (lgas.length > 0 && !(register && filters.stateCode)) || Boolean(filters.lga);
  const showTextFunding = register ? Boolean(filters.fundingSource) : fundingSources.length > 0;

  if (types.length === 0 && regions.length === 0 && uniqueOwners.length === 0 && !hasRegisterFilters) return null;
  const set = (key: keyof ProjectListFilters) => (v: string) => onChange({ ...filters, [key]: v || undefined });
  const setZone = (v: string) => {
    const zone = (v || undefined) as NigeriaZoneCode | undefined;
    const keepState = !zone || stateByCode(filters.stateCode)?.zone === zone;
    onChange({
      ...filters,
      zone,
      stateCode: keepState ? filters.stateCode : undefined,
      lgaCode: keepState ? filters.lgaCode : undefined,
    });
  };
  const setState = (v: string) =>
    onChange({ ...filters, stateCode: v || undefined, lgaCode: undefined, lga: v ? undefined : filters.lga });

  // One slot per filter. The everyday ones (zone, state, LGA, year, type) stay in the bar; owner,
  // contractor and funding source sit behind "More filters". With four filters or fewer, all show.
  const slots: FilterSlot[] = [];
  if (register) {
    slots.push({
      key: "zone",
      primary: true,
      width: "lg:w-36",
      active: Boolean(filters.zone),
      node: <CustomSelect value={filters.zone ?? ""} onChange={setZone} ariaLabel="Filter by zone" options={zones} size="sm" />,
    });
    slots.push({
      key: "state",
      primary: true,
      width: "lg:w-40",
      active: Boolean(filters.stateCode),
      node: (
        <CustomSelect
          value={filters.stateCode ?? ""}
          onChange={setState}
          ariaLabel="Filter by state"
          options={states}
          size="sm"
          searchable={states.length > 8}
        />
      ),
    });
    // The LGA slot keeps its place: the state's LGAs, else the LGAs as recorded, else waiting for a state.
    if (filters.stateCode) {
      slots.push({
        key: "lgaCode",
        primary: true,
        width: "lg:w-40",
        active: Boolean(filters.lgaCode),
        node: (
          <CustomSelect
            value={filters.lgaCode ?? ""}
            onChange={set("lgaCode")}
            ariaLabel="Filter by LGA"
            options={lgaCodes}
            size="sm"
            searchable={lgaCodes.length > 8}
          />
        ),
      });
    } else if (!showTextLgas) {
      slots.push({
        key: "lgaCode",
        primary: true,
        width: "lg:w-40",
        active: false,
        node: (
          <div title="Choose a state first">
            <CustomSelect value="" onChange={() => undefined} ariaLabel="Filter by LGA (choose a state first)" options={[{ value: "", label: "All LGAs" }]} size="sm" disabled />
          </div>
        ),
      });
    }
  }
  if (showTextLgas) {
    slots.push({
      key: "lga",
      // Beside a chosen state's LGA list, the recorded-text list (from a link) moves behind "More filters".
      primary: !(register && filters.stateCode),
      width: "lg:w-40",
      active: Boolean(filters.lga),
      node: (
        <CustomSelect
          value={filters.lga ?? ""}
          onChange={set("lga")}
          ariaLabel="Filter by LGA as recorded"
          options={[
            { value: "", label: register && filters.stateCode ? "All LGAs as recorded" : "All LGAs" },
            ...lgas.map((l) => ({ value: l, label: l })),
            ...(filters.lga && !lgas.includes(filters.lga) ? [{ value: filters.lga, label: filters.lga }] : []),
          ]}
          size="sm"
          searchable={lgas.length > 8}
        />
      ),
    });
  }
  if (years.length > 0) {
    slots.push({
      key: "interventionYear",
      primary: true,
      width: "lg:w-32",
      active: filters.interventionYear !== undefined,
      node: (
        <CustomSelect
          value={filters.interventionYear !== undefined ? String(filters.interventionYear) : ""}
          onChange={(v) => onChange({ ...filters, interventionYear: v ? Number(v) : undefined })}
          ariaLabel="Filter by intervention year"
          options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: String(y), label: `Year ${y}` }))]}
          size="sm"
        />
      ),
    });
  }
  if (types.length > 0) {
    slots.push({
      key: "projectTypeId",
      primary: true,
      width: "lg:w-40",
      active: Boolean(filters.projectTypeId),
      node: (
        <CustomSelect
          value={filters.projectTypeId ?? ""}
          onChange={set("projectTypeId")}
          ariaLabel="Filter by project type"
          options={[{ value: "", label: "All project types" }, ...types.map((t) => ({ value: t.id, label: t.name }))]}
          size="sm"
        />
      ),
    });
  }
  if (showRegions) {
    slots.push({
      key: "regionId",
      // Outside the register this is the zone filter; in the register only a link carries it.
      primary: !register,
      width: "lg:w-48",
      active: Boolean(filters.regionId),
      node: (
        <CustomSelect
          value={filters.regionId ?? ""}
          onChange={set("regionId")}
          ariaLabel={register ? "Filter by workspace zone (KPI grouping)" : "Filter by zone / state"}
          options={[{ value: "", label: register ? "All workspace zones" : "All zones / states" }, ...regionOptions]}
          size="sm"
          searchable={regionOptions.length > 8}
        />
      ),
    });
  }
  if (uniqueOwners.length > 0) {
    slots.push({
      key: "owningOrganizationId",
      primary: false,
      width: "lg:w-56",
      active: Boolean(filters.owningOrganizationId),
      node: (
        <CustomSelect
          value={filters.owningOrganizationId ?? ""}
          onChange={set("owningOrganizationId")}
          ariaLabel="Filter by owner"
          options={[{ value: "", label: "All owners" }, ...uniqueOwners]}
          size="sm"
          searchable={uniqueOwners.length > 8}
        />
      ),
    });
  }
  if (contractors.length > 0) {
    slots.push({
      key: "contractorOrganizationId",
      primary: false,
      width: "lg:w-56",
      active: Boolean(filters.contractorOrganizationId),
      node: (
        <CustomSelect
          value={filters.contractorOrganizationId ?? ""}
          onChange={set("contractorOrganizationId")}
          ariaLabel="Filter by contractor"
          options={[{ value: "", label: "All contractors" }, ...contractors.map((c) => ({ value: c.id, label: c.name }))]}
          size="sm"
          searchable={contractors.length > 8}
        />
      ),
    });
  }
  if (register) {
    slots.push({
      key: "fundingSourceCode",
      primary: false,
      width: "lg:w-56",
      active: Boolean(filters.fundingSourceCode),
      node: (
        <CustomSelect
          value={filters.fundingSourceCode ?? ""}
          onChange={set("fundingSourceCode")}
          ariaLabel="Filter by funding source"
          options={[{ value: "", label: "All funding sources" }, ...FUNDING_SOURCES.map((f) => ({ value: f.code, label: f.label }))]}
          size="sm"
        />
      ),
    });
  }
  if (showTextFunding) {
    slots.push({
      key: "fundingSource",
      primary: false,
      width: "lg:w-56",
      active: Boolean(filters.fundingSource),
      node: (
        <CustomSelect
          value={filters.fundingSource ?? ""}
          onChange={set("fundingSource")}
          ariaLabel="Filter by funding source as recorded"
          options={[
            { value: "", label: register ? "Any recorded funding text" : "All funding sources" },
            ...fundingSources.map((f) => ({ value: f, label: f })),
            ...(filters.fundingSource && !fundingSources.includes(filters.fundingSource)
              ? [{ value: filters.fundingSource, label: filters.fundingSource }]
              : []),
          ]}
          size="sm"
          searchable={fundingSources.length > 8}
        />
      ),
    });
  }

  const allInline = slots.length <= 4;
  const shown = allInline ? slots : slots.filter((s) => s.primary);
  const hidden = allInline ? [] : slots.filter((s) => !s.primary);
  const hiddenActive = hidden.filter((s) => s.active).length;
  const anyActive = (Object.keys(filters) as Array<keyof ProjectListFilters>).some((k) => filters[k] !== undefined && filters[k] !== "");
  const showMore = hidden.length > 0 && moreOpen;
  const renderSlot = (s: FilterSlot) => (
    <div key={s.key} className={`min-w-0 ${s.width}`}>
      {s.node}
    </div>
  );

  return (
    <div role="group" aria-label="Filter projects" className="w-full lg:w-auto space-y-2">
      <div className={ROW_CLASS}>
        {shown.map(renderSlot)}
        {(hidden.length > 0 || anyActive) && (
          <div className="flex items-center gap-3 sm:col-span-2">
            {hidden.length > 0 && (
              <button
                type="button"
                aria-expanded={showMore}
                aria-controls={showMore ? moreId : undefined}
                onClick={() => setMoreOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                More filters
                {hiddenActive > 0 && (
                  <span className="rounded-full bg-brand-primary px-1.5 text-[10px] font-bold leading-4 text-white tabular-nums">
                    {hiddenActive}
                    <span className="sr-only"> in use</span>
                  </span>
                )}
                <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${showMore ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            )}
            {anyActive && (
              <button
                type="button"
                onClick={() => onChange({})}
                className="whitespace-nowrap rounded text-[11px] font-semibold text-brand-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      {showMore && (
        <div id={moreId} className={ROW_CLASS}>
          {hidden.map(renderSlot)}
        </div>
      )}
    </div>
  );
}

type FilterSlot = { key: string; primary: boolean; width: string; active: boolean; node: React.ReactNode };

/** Phone: one column; tablet: two; desktop: one wrapping row of compact selects. */
const ROW_CLASS = "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center";
