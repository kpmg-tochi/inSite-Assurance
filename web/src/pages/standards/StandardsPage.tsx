import React, { useMemo } from "react";
import { Tabs, TabPanel, useUrlTab } from "../../components/common/Tabs";
import { CostingStandardPanel } from "../../components/standards/CostingStandardPanel";
import { DesignStandardsPanel } from "../../components/standards/DesignStandardsPanel";
import { MonitoringStandardsPanel } from "../../components/standards/MonitoringStandardsPanel";
import { useStandardsOverviewQuery } from "../../queries/needs/useStandardsQueries";
import { useFacilitiesQuery } from "../../queries/facilities/useFacilityQueries";
import { useAuth } from "../../lib/auth-context";

type TabId = "costing" | "design" | "monitoring";
const TAB_IDS: readonly TabId[] = ["costing", "design", "monitoring"];
const TABS = [
  { id: "costing" as const, label: "Costing" },
  { id: "design" as const, label: "Design" },
  { id: "monitoring" as const, label: "Monitoring" },
];
const TAB_PREFIX = "standards";

/**
 * Needs pipeline wave 2 (C1): the Standards page (`/app/standards`, any web user; changes need
 * `standards:manage`). Costing: the versioned costing standard (rates, zone factors, percentages,
 * ceilings; Excel template and upload). Design: standard drawings and specifications, and each
 * programme's essential facility groups. Monitoring: the form library, read-only.
 */
export function StandardsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("standards:manage");
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const active = tab ?? "costing";
  const query = useStandardsOverviewQuery();
  const facilitiesQuery = useFacilitiesQuery(true);
  const facilityNames = useMemo(() => new Map((facilitiesQuery.data ?? []).map((f) => [f.code.toUpperCase(), f.name])), [facilitiesQuery.data]);
  const facilityName = useMemo(() => (code: string) => facilityNames.get(code.toUpperCase()) ?? code, [facilityNames]);
  const activeFacilities = useMemo(
    () => (facilitiesQuery.data ?? []).filter((f) => !f.isRetired).map((f) => ({ code: f.code, name: f.name })),
    [facilitiesQuery.data]
  );
  const data = query.data;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Standards</h2>
        <p className="text-xs text-slate-500">The rates, designs and monitoring forms every proposed project and project is measured against.</p>
      </div>

      <Tabs tabs={TABS} active={active} onChange={setTab} label="Standards" idPrefix={TAB_PREFIX} />

      {query.isLoading && (
        <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
          <span className="sr-only">Loading the standards…</span>
        </div>
      )}
      {query.isError && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          The standards could not be loaded.
        </p>
      )}

      {data && (
        <TabPanel idPrefix={TAB_PREFIX} id={active}>
          {active === "costing" && (
            <CostingStandardPanel current={data.costing.current} versions={data.costing.versions} canManage={canManage} facilityName={facilityName} />
          )}
          {active === "design" && (
            <DesignStandardsPanel
              documents={data.design.documents}
              essentialGroups={data.design.essentialGroups}
              canManage={canManage}
              facilities={activeFacilities}
              facilityName={facilityName}
            />
          )}
          {active === "monitoring" && <MonitoringStandardsPanel library={data.monitoring} />}
        </TabPanel>
      )}
    </div>
  );
}
