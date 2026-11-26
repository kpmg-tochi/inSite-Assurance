import React from "react";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import Loader from "../../components/Loader";
import { TabPanel, Tabs, useUrlTab, type TabItem } from "../../components/common/Tabs";
import { CompletionSection } from "../../components/closure/CompletionSection";
import { ProjectStageTabs } from "../../components/projects/ProjectStageTabs";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { CLOSURE_VIEW_PERMISSIONS, DEFECT_VIEW_PERMISSIONS, HANDOVER_VIEW_PERMISSIONS } from "./completionPermissions";
import { useCompletionTabHints } from "./completionTabHints";
import { HandoverTab } from "./HandoverTab";
import { DefectsTab } from "./DefectsTab";
import { ClosureTab } from "./ClosureTab";

type CompletionPageTab = "certificate" | "handover" | "defects" | "closure";

/**
 * Redesign R6b (D-R6.16): completion, handover, defects and closure on one page. Tabs in the URL
 * (`?tab=certificate|handover|defects|closure`); `/handover`, `/retention` (with `?ticket=`) and
 * `/closure` redirect here. The route admits COMPLETION_PAGE_PERMISSIONS; each tab keeps the gate of
 * the page it came from, and Handover / Defects exist only when their module is on.
 *
 * Design round 2026-11-26: the tab bar sits under the project cycle stepper, left-aligned, and each
 * tab carries a short state ("Draft · 0 of 3 signed", "2 open") from the queries the tabs use.
 */
export function CompletionHandoverPage({ project }: { project: ProjectSummaryDto }) {
  const { hasAnyPermission } = useAuth();
  const process = useProjectProcess(project.id);
  const config = process.data?.config;

  const visible = {
    handover: Boolean(config?.enableHandoverModule) && hasAnyPermission(...HANDOVER_VIEW_PERMISSIONS),
    defects: Boolean(config?.enableRetentionModule) && hasAnyPermission(...DEFECT_VIEW_PERMISSIONS),
    closure: hasAnyPermission(...CLOSURE_VIEW_PERMISSIONS),
  };
  const hints = useCompletionTabHints(project, visible);

  const ids: CompletionPageTab[] = [
    "certificate",
    ...(visible.handover ? (["handover"] as const) : []),
    ...(visible.defects ? (["defects"] as const) : []),
    ...(visible.closure ? (["closure"] as const) : []),
  ];
  const [active, setActive] = useUrlTab(ids);
  const tab = active ?? "certificate";

  const LABELS: Record<CompletionPageTab, string> = {
    certificate: "Certificate",
    handover: "Handover",
    defects: "Defects",
    closure: "Project closure",
  };
  const tabs: TabItem<CompletionPageTab>[] = ids.map((id) => ({
    id,
    label: (
      <span className="flex flex-col items-start text-left leading-tight">
        <span>{LABELS[id]}</span>
        {hints[id] && (
          <span className={`mt-0.5 text-[11px] font-normal ${id === tab ? "text-white" : "text-slate-600"}`}>
            <span className="sr-only">, </span>
            {hints[id]}
          </span>
        )}
      </span>
    ),
  }));

  // Wait for the module switches so a ?tab=handover link is not bounced to the first tab.
  if (process.isLoading) return <Loader />;

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <ProjectStageTabs projectId={project.id} stage={project.stage} />
        <Tabs tabs={tabs} active={tab} onChange={setActive} label="Completion and handover" idPrefix="completion" />
      </div>
      <TabPanel idPrefix="completion" id={tab}>
        {tab === "certificate" && <CompletionSection projectId={project.id} />}
        {tab === "handover" && <HandoverTab project={project} />}
        {tab === "defects" && <DefectsTab project={project} />}
        {tab === "closure" && <ClosureTab project={project} />}
      </TabPanel>
    </div>
  );
}
