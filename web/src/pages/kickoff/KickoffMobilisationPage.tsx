import React from "react";
import type { ProjectSummaryDto } from "../../api/types";
import { TabPanel, Tabs, useUrlTab, type TabItem } from "../../components/common/Tabs";
import { KickoffTab } from "./KickoffTab";
import { MilestonesTab } from "./MilestonesTab";
import { MobilisationTab } from "./MobilisationTab";

type KickoffPageTab = "kickoff" | "milestones" | "mobilisation";

const TABS: readonly TabItem<KickoffPageTab>[] = [
  { id: "kickoff", label: "Kick-off" },
  { id: "milestones", label: "Milestones" },
  { id: "mobilisation", label: "Mobilisation" },
];
const TAB_IDS = TABS.map((t) => t.id);

/**
 * Redesign R6b (D-R6.15): one page for the time between contract award and the contractor working
 * on site. Tabs in the URL (`?tab=kickoff|milestones|mobilisation`); `/milestones` redirects here.
 * Gate: MILESTONE_VIEW_PERMISSIONS (the route), the same for every tab.
 */
import { ProjectStageTabs } from "../../components/projects/ProjectStageTabs";

export function KickoffMobilisationPage({ project }: { project: ProjectSummaryDto }) {
  const [active, setActive] = useUrlTab(TAB_IDS);
  const tab = active ?? "kickoff";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectStageTabs projectId={project.id} stage={project.stage} />
        <Tabs tabs={TABS} active={tab} onChange={setActive} label="Kick-off and mobilisation" idPrefix="kickoff" />
      </div>
      <TabPanel idPrefix="kickoff" id={tab}>
        {tab === "kickoff" && <KickoffTab project={project} />}
        {tab === "milestones" && <MilestonesTab project={project} />}
        {tab === "mobilisation" && <MobilisationTab project={project} />}
      </TabPanel>
    </div>
  );
}
