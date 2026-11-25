import React, { useMemo, useState } from "react";
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {types.length > 0 && (
        <div className="w-48">
          <CustomSelect
            value={filters.projectTypeId ?? ""}
            onChange={set("projectTypeId")}
            ariaLabel="Filter by project type"
            options={[{ value: "", label: "All project types" }, ...types.map((t) => ({ value: t.id, label: t.name }))]}
            size="sm"
          />
        </div>
      )}
      {register && (
        <>
          <div className="w-40">
            <CustomSelect value={filters.zone ?? ""} onChange={setZone} ariaLabel="Filter by zone" options={zones} size="sm" />
          </div>
          <div className="w-44">
            <CustomSelect
              value={filters.stateCode ?? ""}
              onChange={setState}
              ariaLabel="Filter by state"
              options={states}
              size="sm"
              searchable={states.length > 8}
            />
          </div>
          {filters.stateCode && (
            <div className="w-48">
              <CustomSelect
                value={filters.lgaCode ?? ""}
                onChange={set("lgaCode")}
                ariaLabel="Filter by LGA"
                options={lgaCodes}
                size="sm"
                searchable={lgaCodes.length > 8}
              />
            </div>
          )}
        </>
      )}
      {showRegions && (
        <div className="w-48">
          <CustomSelect
            value={filters.regionId ?? ""}
            onChange={set("regionId")}
            ariaLabel={register ? "Filter by programme zone (workspace list)" : "Filter by zone / state"}
            options={[{ value: "", label: register ? "All programme zones" : "All zones / states" }, ...regionOptions]}
            size="sm"
            searchable={regionOptions.length > 8}
          />
        </div>
      )}
      {uniqueOwners.length > 0 && (
        <div className="w-56">
          <CustomSelect
            value={filters.owningOrganizationId ?? ""}
            onChange={set("owningOrganizationId")}
            ariaLabel="Filter by owner"
            options={[{ value: "", label: "All owners" }, ...uniqueOwners]}
            size="sm"
            searchable={uniqueOwners.length > 8}
          />
        </div>
      )}
      {showTextLgas && (
        <div className="w-48">
          <CustomSelect
            value={filters.lga ?? ""}
            onChange={set("lga")}
            ariaLabel="Filter by LGA as recorded"
            options={[
              { value: "", label: "All LGAs" },
              ...lgas.map((l) => ({ value: l, label: l })),
              ...(filters.lga && !lgas.includes(filters.lga) ? [{ value: filters.lga, label: filters.lga }] : []),
            ]}
            size="sm"
            searchable={lgas.length > 8}
          />
        </div>
      )}
      {contractors.length > 0 && (
        <div className="w-56">
          <CustomSelect
            value={filters.contractorOrganizationId ?? ""}
            onChange={set("contractorOrganizationId")}
            ariaLabel="Filter by contractor"
            options={[{ value: "", label: "All contractors" }, ...contractors.map((c) => ({ value: c.id, label: c.name }))]}
            size="sm"
            searchable={contractors.length > 8}
          />
        </div>
      )}
      {years.length > 0 && (
        <div className="w-48">
          <CustomSelect
            value={filters.interventionYear !== undefined ? String(filters.interventionYear) : ""}
            onChange={(v) => onChange({ ...filters, interventionYear: v ? Number(v) : undefined })}
            ariaLabel="Filter by intervention year"
            options={[{ value: "", label: "All intervention years" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
            size="sm"
          />
        </div>
      )}
      {register && (
        <div className="w-56">
          <CustomSelect
            value={filters.fundingSourceCode ?? ""}
            onChange={set("fundingSourceCode")}
            ariaLabel="Filter by funding source"
            options={[{ value: "", label: "All funding sources" }, ...FUNDING_SOURCES.map((f) => ({ value: f.code, label: f.label }))]}
            size="sm"
          />
        </div>
      )}
      {showTextFunding && (
        <div className="w-56">
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
        </div>
      )}
    </div>
  );
}
