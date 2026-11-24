import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { ProjectDocumentDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort } from "../../lib/formatters";
import {
  useDocumentTypesQuery,
  useProjectDocumentsQuery,
} from "../../queries/contracts/useContractQueries";
import {
  StandardTable,
  TableActionButton,
  TableBadge,
  type TableColumnDef,
} from "../../components/table";
import { CustomSelect } from "../../components/common";
import { DocumentDrawer } from "../../components/documents/DocumentDrawer";
import { DocumentUploadDialog } from "../../components/documents/DocumentUploadDialog";
import { useOpenDocumentMutation } from "../../mutations/contracts/useContractMutations";

/**
 * Phase 13: the project document register. Typed, versioned documents with sign-offs; filter by
 * type and contractor; a drawer per document with versions and sign-offs.
 */
export function ProjectDocumentsPage({
  project,
}: {
  project: ProjectSummaryDto;
}) {
  const { hasPermission } = useAuth();
  const canUpload = hasPermission("documents:upload");
  const [params, setParams] = useSearchParams();
  const typeCode = params.get("type") ?? "";
  const contractorId = params.get("contractor") ?? "";
  const selectedId = params.get("documentId");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const types = useDocumentTypesQuery(false);
  const docs = useProjectDocumentsQuery(project.id, {
    typeCode: typeCode || undefined,
    contractorId: contractorId || undefined,
    includeArchived,
  });
  const open = useOpenDocumentMutation(project.id);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...(docs.data ?? [])]
      .filter(
        (d) =>
          !term ||
          d.title.toLowerCase().includes(term) ||
          d.documentType.name.toLowerCase().includes(term),
      )
      .sort(
        (a, b) =>
          a.documentType.name.localeCompare(b.documentType.name) ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }, [docs.data, search]);

  const awaiting = (docs.data ?? []).filter(
    (d) => d.awaitingSignOff && !d.isArchived,
  ).length;

  const columns: TableColumnDef<ProjectDocumentDto>[] = [
    {
      id: "type",
      header: "Type",
      width: "w-48",
      cell: (d) => (
        <span className="text-xs font-semibold text-slate-700">
          {d.documentType.name}
        </span>
      ),
    },
    {
      id: "title",
      header: "Title",
      cell: (d) => (
        <div>
          <p className="text-xs font-bold text-slate-900">{d.title}</p>
          {d.isArchived && (
            <p className="text-[11px] text-slate-400">Archived</p>
          )}
        </div>
      ),
    },
    {
      id: "version",
      header: "Version",
      width: "w-20",
      align: "center",
      cell: (d) => (
        <span className="text-xs tabular-nums">v{d.currentVersion}</span>
      ),
    },
    {
      id: "contractor",
      header: "Contractor",
      width: "w-44",
      cell: (d) => (
        <span className="text-xs text-slate-600">
          {d.contractorName ?? "—"}
        </span>
      ),
    },
    {
      id: "signoff",
      header: "Sign-off",
      width: "w-40",
      tooltip: "Sign-offs on the current version",
      cell: (d) =>
        d.documentType.requiresSignOff ? (
          d.awaitingSignOff ? (
            <TableBadge variant="warning">Awaiting sign-off</TableBadge>
          ) : (
            <TableBadge variant="success">Signed ({d.signOffCount})</TableBadge>
          )
        ) : d.signOffCount > 0 ? (
          <TableBadge variant="neutral">Signed ({d.signOffCount})</TableBadge>
        ) : (
          <span className="text-[11px] text-slate-400">Not needed</span>
        ),
    },
    {
      id: "uploaded",
      header: "Uploaded",
      width: "w-44",
      cell: (d) => (
        <div className="text-[11px] text-slate-600">
          <p>{formatDateShort(d.current.uploadedAt)}</p>
          <p className="text-slate-400">
            {d.current.uploadedByName ?? d.uploadedByName ?? "—"}
          </p>
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "w-40",
      align: "right",
      cell: (d) => (
        <div className="flex justify-end gap-1.5">
          <TableActionButton
            onClick={() => open.mutate({ documentId: d.id })}
            disabled={open.isPending}
          >
            Open
          </TableActionButton>
          {d.canSign && !d.isArchived && (
            <TableActionButton
              variant="primary"
              onClick={() => setParam("documentId", d.id)}
              className="text-nowrap"
            >
              Sign off
            </TableActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Documents</h1>
        <p className="text-xs text-slate-500">
          The project register: contracts, letters, minutes and mobilisation
          documents, with versions and sign-offs.
          {awaiting > 0 ? ` ${awaiting} document(s) await sign-off.` : ""}
        </p>
      </div>

      <StandardTable<ProjectDocumentDto>
        title="Register"
        subtitle={`${rows.length} document(s)`}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search titles",
        }}
        headerActions={
          canUpload && (
            <button
              type="button"
              onClick={() => setUploading(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
            >
              <Plus className="w-3.5 h-3.5" /> Add document
            </button>
          )
        }
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <CustomSelect
                value={typeCode}
                onChange={(v) => setParam("type", v || null)}
                options={[
                  { value: "", label: "All types" },
                  ...(types.data ?? []).map((t) => ({
                    value: t.code,
                    label: t.name,
                  })),
                ]}
                size="sm"
                searchable
              />
            </div>
            {project.contractors.length > 1 && (
              <div className="w-56">
                <CustomSelect
                  value={contractorId}
                  onChange={(v) => setParam("contractor", v || null)}
                  options={[
                    { value: "", label: "All contractors" },
                    ...project.contractors.map((c) => ({
                      value: c.id,
                      label: c.organizationName,
                    })),
                  ]}
                  size="sm"
                />
              </div>
            )}
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />{" "}
              Show archived
            </label>
          </div>
        }
        columns={columns}
        data={rows}
        keyExtractor={(d) => d.id}
        onRowClick={(d) => setParam("documentId", d.id)}
        selectedId={selectedId}
        loading={docs.isLoading}
        emptyState={{
          title: "No documents",
          description:
            typeCode || contractorId
              ? "Nothing matches these filters."
              : "Documents added to the register appear here.",
        }}
      />

      {selectedId && (
        <DocumentDrawer
          projectId={project.id}
          documentId={selectedId}
          onClose={() => setParam("documentId", null)}
        />
      )}
      {uploading && (
        <DocumentUploadDialog
          projectId={project.id}
          onClose={() => setUploading(false)}
          onUploaded={(doc) => setParam("documentId", doc.id)}
        />
      )}
    </div>
  );
}
