import React from "react";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import Loader from "../../components/Loader";
import { TabPanel, Tabs, useUrlTab, type TabItem } from "../../components/common/Tabs";
import { CompletionSection } from "../../components/closure/CompletionSection";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { CLOSURE_VIEW_PERMISSIONS, DEFECT_VIEW_PERMISSIONS, HANDOVER_VIEW_PERMISSIONS } from "./completionPermissions";
import { HandoverTab } from "./HandoverTab";
import { DefectsTab } from "./DefectsTab";
import { ClosureTab } from "./ClosureTab";

type CompletionPageTab = "certificate" | "handover" | "defects" | "closure";

/**
 * Redesign R6b (D-R6.16): completion, handover, defects and closure on one page. Tabs in the URL
 * (`?tab=certificate|handover|defects|closure`); `/handover`, `/retention` (with `?ticket=`) and
 * `/closure` redirect here. The route admits COMPLETION_PAGE_PERMISSIONS; each tab keeps the gate of
 * the page it came from, and Handover / Defects exist only when their module is on.
 */
export function CompletionHandoverPage({ project }: { project: ProjectSummaryDto }) {
  const { hasAnyPermission } = useAuth();
  const process = useProjectProcess(project.id);
  const config = process.data?.config;

  const tabs: TabItem<CompletionPageTab>[] = [
    { id: "certificate", label: "Certificate" },
    ...(config?.enableHandoverModule && hasAnyPermission(...HANDOVER_VIEW_PERMISSIONS) ? [{ id: "handover" as const, label: "Handover" }] : []),
    ...(config?.enableRetentionModule && hasAnyPermission(...DEFECT_VIEW_PERMISSIONS) ? [{ id: "defects" as const, label: "Defects" }] : []),
    ...(hasAnyPermission(...CLOSURE_VIEW_PERMISSIONS) ? [{ id: "closure" as const, label: "Closure" }] : []),
  ];
  const [active, setActive] = useUrlTab(tabs.map((t) => t.id));

  // Wait for the module switches so a ?tab=handover link is not bounced to the first tab.
  if (process.isLoading) return <Loader />;
  const tab = active ?? "certificate";

  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={tab} onChange={setActive} label="Completion and handover" idPrefix="completion" />
      <TabPanel idPrefix="completion" id={tab}>
        {tab === "certificate" && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">The Certificate of Completion: draft, signatures and issue. It comes before the handover ceremony.</p>
            <CompletionSection projectId={project.id} />
          </div>
        )}
        {tab === "handover" && <HandoverTab project={project} />}
        {tab === "defects" && <DefectsTab project={project} />}
        {tab === "closure" && <ClosureTab project={project} />}
      </TabPanel>
    </div>
  );
}
