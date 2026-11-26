import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FileUp } from "lucide-react";
import type { ProjectDocumentDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import type { DocumentFilters } from "../../api/contracts/contractsApi";
import Loader from "../Loader";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort } from "../../lib/formatters";
import { useDocumentTypesQuery, useProjectDocumentsQuery } from "../../queries/contracts/useContractQueries";
import { closureChecklistKey } from "../../queries/closure/useClosureQueries";
import { useOpenDocumentMutation } from "../../mutations/contracts/useContractMutations";
import { DocumentUploadDialog } from "../documents/DocumentUploadDialog";
import { DocumentDrawer } from "../documents/DocumentDrawer";
import { primaryButton, secondaryButton } from "../contracts/contractUi";
import { CollapsibleSection } from "./closureUi";

/**
 * UBEC: the closeout report replaces lessons learned on the project. It is a `CLOSEOUT_REPORT`
 * document in the project register (final evaluation summary, lessons learned, beneficiary
 * feedback), uploaded through the register's own flow. Used by the Closure tab (`CloseoutReportCard`)
 * and the project overview (`CloseoutReportPrompt`).
 */

export const CLOSEOUT_REPORT_TYPE_CODE = "CLOSEOUT_REPORT";
const CLOSEOUT_FILTER: DocumentFilters = { typeCode: CLOSEOUT_REPORT_TYPE_CODE };
const COMPLETED_PHASES = new Set(["RETENTION_PERIOD", "COMPLETED_CLOSED"]);

const CLOSEOUT_REPORT_HOLDS = "the final evaluation summary, lessons learned and beneficiary feedback";

/** The project's current closeout report (latest upload), plus what the caller may do with it. */
export function useCloseoutReport(projectId: string, enabled = true) {
  const { hasPermission } = useAuth();
  const canView = hasPermission("documents:view");
  const canUpload = hasPermission("documents:upload");
  const docs = useProjectDocumentsQuery(projectId, CLOSEOUT_FILTER, enabled && canView);
  const types = useDocumentTypesQuery(false, enabled && canUpload);
  const reports: ProjectDocumentDto[] = [...(docs.data ?? [])].sort((a, b) => b.current.uploadedAt.localeCompare(a.current.uploadedAt));
  const typeAvailable = types.data ? types.data.some((t) => t.code === CLOSEOUT_REPORT_TYPE_CODE && !t.isArchived) : null;
  return {
    report: reports[0] ?? null,
    otherCount: Math.max(0, reports.length - 1),
    canView,
    canUpload,
    /** null while the types load (or the caller cannot upload). */
    typeAvailable,
    isLoading: docs.isLoading,
    isError: docs.isError,
    refetch: docs.refetch,
  };
}

/** The register's upload dialog, fixed to the closeout report type. */
export function CloseoutReportUploadDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <DocumentUploadDialog
      projectId={projectId}
      defaultTypeCode={CLOSEOUT_REPORT_TYPE_CODE}
      lockType
      defaultTitle="Lessons learned report"
      // The before-archive checklist item reads the register.
      onUploaded={() => qc.invalidateQueries({ queryKey: closureChecklistKey(projectId) })}
      onClose={onClose}
    />
  );
}

/** Closure tab: the closeout report, or the way to upload it. Read-only on archived projects. */
export function CloseoutReportCard({ project }: { project: ProjectSummaryDto }) {
  const archived = project.status === "ARCHIVED";
  const closeout = useCloseoutReport(project.id);
  const open = useOpenDocumentMutation(project.id);
  const [uploading, setUploading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (!closeout.canView) return null;

  const { report } = closeout;
  const canUploadHere = closeout.canUpload && !archived;

  let body: React.ReactNode;
  if (closeout.isLoading) {
    body = <Loader />;
  } else if (closeout.isError) {
    body = (
      <p className="text-xs text-rose-700">
        The lessons learned report could not be loaded.{" "}
        <button type="button" onClick={() => closeout.refetch()} className="font-semibold underline">
          Try again
        </button>
      </p>
    );
  } else if (report) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="block truncate text-left text-sm font-semibold text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded"
            >
              {report.title}
            </button>
            <p className="text-[11px] text-slate-500">
              Uploaded {formatDateShort(report.current.uploadedAt)}
              {report.current.uploadedByName ? ` by ${report.current.uploadedByName}` : ""}
              {report.currentVersion > 1 ? ` · version ${report.currentVersion}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} disabled={open.isPending} onClick={() => open.mutate({ documentId: report.id })}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> {open.isPending ? "Opening…" : "Open report"}
          </button>
          <button type="button" className={secondaryButton} onClick={() => setDrawerOpen(true)}>
            Versions and details
          </button>
        </div>
      </div>
    );
  } else if (archived) {
    body = <p className="text-xs text-slate-500">No lessons learned report was uploaded before the project was archived.</p>;
  } else if (!closeout.canUpload) {
    body = <p className="text-xs text-slate-500">No lessons learned report has been uploaded yet.</p>;
  } else if (closeout.typeAvailable === false) {
    body = (
      <p className="text-xs text-slate-500">
        No lessons learned report has been uploaded yet, and this workspace has no "Lessons learned report" document type to file it under. Ask an
        administrator to add it.
      </p>
    );
  } else {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">No lessons learned report has been uploaded yet.</p>
        <button type="button" className={primaryButton} onClick={() => setUploading(true)}>
          <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload lessons learned report
        </button>
      </div>
    );
  }

  // Design round 2026-11-26: a collapsible sub-section of the Project closure tab, open when the
  // caller has the report to upload. Remounted once the register has loaded so it opens then.
  const needsUpload = !report && canUploadHere && closeout.typeAvailable !== false;
  const hint = closeout.isLoading
    ? undefined
    : report
      ? `Uploaded ${formatDateShort(report.current.uploadedAt)}${report.currentVersion > 1 ? ` · version ${report.currentVersion}` : ""}`
      : "Not uploaded yet";

  return (
    <CollapsibleSection
      key={closeout.isLoading ? "loading" : "ready"}
      id="closeout-report"
      title="Lessons learned report"
      hint={hint}
      defaultOpen={!closeout.isLoading && needsUpload}
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-600">One document with {CLOSEOUT_REPORT_HOLDS}, filed in the project register.</p>
        {body}
        {report && closeout.otherCount > 0 && (
          <p className="text-[11px] text-slate-500">
            {closeout.otherCount} earlier lessons learned report{closeout.otherCount === 1 ? " is" : "s are"} in the{" "}
            <Link to={`/app/projects/${project.id}/documents`} className="font-semibold text-brand-primary hover:underline">
              documents register
            </Link>
            .
          </p>
        )}
        {canUploadHere && uploading && <CloseoutReportUploadDialog projectId={project.id} onClose={() => setUploading(false)} />}
        {report && drawerOpen && <DocumentDrawer projectId={project.id} documentId={report.id} onClose={() => setDrawerOpen(false)} />}
      </div>
    </CollapsibleSection>
  );
}

/**
 * Project overview: once construction is complete (liability period or closed) and no closeout
 * report is in the register, ask a user who can upload documents to add it. Others see nothing.
 */
export function CloseoutReportPrompt({ project }: { project: ProjectSummaryDto }) {
  const due = COMPLETED_PHASES.has(project.constructionPhase) && project.status === "ACTIVE";
  const closeout = useCloseoutReport(project.id, due);
  const [uploading, setUploading] = useState(false);
  if (!due || !closeout.canView || !closeout.canUpload) return null;
  if (closeout.isLoading || closeout.isError || closeout.report || closeout.typeAvailable !== true) return null;

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-primary/30 bg-brand-primary/5 p-4"
      aria-labelledby="closeout-prompt-heading"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
        <div>
          <h2 id="closeout-prompt-heading" className="text-sm font-bold text-slate-900">
            Upload the lessons learned report
          </h2>
          <p className="text-xs text-slate-600">
            It holds {CLOSEOUT_REPORT_HOLDS}.{" "}
            <Link to={`/app/projects/${project.id}/completion?tab=closure`} className="font-semibold text-brand-primary hover:underline">
              See the closure checklist
            </Link>
          </p>
        </div>
      </div>
      <button type="button" className={primaryButton} onClick={() => setUploading(true)}>
        Upload lessons learned report
      </button>
      {uploading && <CloseoutReportUploadDialog projectId={project.id} onClose={() => setUploading(false)} />}
    </section>
  );
}
