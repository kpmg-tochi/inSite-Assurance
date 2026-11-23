import React from "react";
import { ProcessConfigEditor } from "./ProcessConfigEditor";
import { ApprovalChainEditor, type RoleOption } from "./ApprovalChainEditor";
import type { ProcessDraft, ProcessIssues } from "./processState";

function Block({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-bold text-slate-900">{title}</h3>
        {description && <div className="text-[11px] text-slate-500 mt-0.5">{description}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * The process switches and the report approval chain. Shared by the wizard's "Workflow and process"
 * step, project settings and the workflow-template editor.
 */
export function ProcessEditor({
  draft,
  onChange,
  issues,
  roles,
  disabled,
  chainNote,
}: {
  draft: ProcessDraft;
  onChange: (next: ProcessDraft) => void;
  issues: ProcessIssues;
  roles: RoleOption[];
  disabled?: boolean;
  /** Shown above the chains (e.g. "applies to new items only"). */
  chainNote?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <ProcessConfigEditor
        value={draft.config}
        onChange={(config) => onChange({ ...draft, config })}
        disabled={disabled}
      />

      {chainNote}

      <Block
        title="Report approval chain"
        description={
          draft.config.requireReportApproval
            ? "Each submitted report goes through these steps in order before it counts as evidence. One person cannot act on two steps in a row."
            : "Report approval is off, so this chain is not used until it is turned on."
        }
      >
        <ApprovalChainEditor
          chainType="REPORT"
          steps={draft.reportChain}
          onChange={(reportChain) => onChange({ ...draft, reportChain })}
          disabled={disabled}
          roles={roles}
          issues={issues.report}
        />
      </Block>

    </div>
  );
}
