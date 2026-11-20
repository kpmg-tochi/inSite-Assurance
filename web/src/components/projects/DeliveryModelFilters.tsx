import React, { useMemo, useState } from "react";
import type { ProjectDeliveryModelFields, ProjectListFilters, ProjectTypeSummary, RegionDto } from "@insite/shared";

const NO_REGIONS: RegionDto[] = [];
import { CustomSelect } from "../common";
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
 */
export function DeliveryModelFilters({
  filters,
  onChange,
  owners,
}: {
  filters: ProjectListFilters;
  onChange: (next: ProjectListFilters) => void;
  /** Owning organisations present in the list being filtered. */
  owners: Array<{ id: string; name: string }>;
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
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [owners]);

  if (types.length === 0 && regions.length === 0 && uniqueOwners.length === 0) return null;
  const set = (key: keyof ProjectListFilters) => (v: string) => onChange({ ...filters, [key]: v || undefined });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {types.length > 0 && (
        <div className="w-48">
          <CustomSelect
            value={filters.projectTypeId ?? ""}
            onChange={set("projectTypeId")}
            options={[{ value: "", label: "All project types" }, ...types.map((t) => ({ value: t.id, label: t.name }))]}
            size="sm"
          />
        </div>
      )}
      {regions.length > 0 && (
        <div className="w-48">
          <CustomSelect
            value={filters.regionId ?? ""}
            onChange={set("regionId")}
            options={[{ value: "", label: "All regions" }, ...regionOptions]}
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
            options={[{ value: "", label: "All owners" }, ...uniqueOwners]}
            size="sm"
            searchable={uniqueOwners.length > 8}
          />
        </div>
      )}
    </div>
  );
}
