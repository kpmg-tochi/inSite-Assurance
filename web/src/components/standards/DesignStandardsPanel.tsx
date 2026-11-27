import React, { useMemo, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { DESIGN_STANDARD_DOCUMENT_KIND_LABELS, type DesignStandardDocumentDto, type ProgrammeEssentialGroups } from "@insite/shared";
import { StandardTable, TableBadge, type TableColumnDef } from "../table";
import { primaryButton } from "../contracts/contractUi";
import { cardCls, formatBytes } from "../needs/needsUi";
import { getDesignStandardDocumentLink } from "../../api/needsStandards";
import { useOpenNeedsFileMutation } from "../../mutations/needs/useNeedsMutations";
import { formatDateTimeShort } from "../../lib/formatters";
import { DesignDocumentDialog } from "./DesignDocumentDialog";

/**
 * Needs pipeline wave 2 (C1): the Design tab of the Standards page. Standard drawings and
 * specifications (current first, superseded muted below) and each programme's essential facility
 * groups (D-N.17, from the project type's needs pipeline rules, read-only here).
 */
export function DesignStandardsPanel({
  documents,
  essentialGroups,
  canManage,
  facilities,
  facilityName,
}: {
  documents: DesignStandardDocumentDto[];
  essentialGroups: ProgrammeEssentialGroups[];
  canManage: boolean;
  facilities: Array<{ code: string; name: string }>;
  facilityName: (code: string) => string;
}) {
  const openFile = useOpenNeedsFileMutation();
  const [dialog, setDialog] = useState<{ supersedes: DesignStandardDocumentDto | null } | null>(null);
  const rows = useMemo(
    () => [...documents].sort((a, b) => Number(!a.isCurrent) - Number(!b.isCurrent) || b.uploadedAt.localeCompare(a.uploadedAt)),
    [documents]
  );
  const muted = (d: DesignStandardDocumentDto) => (d.isCurrent ? "text-slate-800" : "text-slate-400");

  const columns: TableColumnDef<DesignStandardDocumentDto>[] = [
    { id: "kind", header: "Kind", cell: (d) => <span className={`whitespace-nowrap ${muted(d)}`}>{DESIGN_STANDARD_DOCUMENT_KIND_LABELS[d.kind]}</span> },
    {
      id: "title",
      header: "Title",
      cell: (d) => (
        <span className={muted(d)}>
          <span className="font-semibold">{d.title}</span>
          {!d.isCurrent && (
            <span className="ml-2">
              <TableBadge variant="neutral">Superseded</TableBadge>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "facilities",
      header: "Facilities",
      cell: (d) => (
        <span className={`block max-w-[16rem] ${muted(d)}`}>{d.facilityCodes.length ? d.facilityCodes.map(facilityName).join(", ") : "All facilities"}</span>
      ),
    },
    {
      id: "file",
      header: "File",
      cell: (d) => (
        <span className={`block max-w-[12rem] truncate ${muted(d)}`} title={d.fileName}>
          {d.fileName} <span className="text-slate-400">· {formatBytes(d.byteSize)}</span>
        </span>
      ),
    },
    {
      id: "uploaded",
      header: "Uploaded",
      cell: (d) => (
        <span className={`whitespace-nowrap ${muted(d)}`}>
          {formatDateTimeShort(d.uploadedAt)}
          <span className="block text-[11px] text-slate-500">{d.uploadedByName}</span>
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (d) => (
        <span className="flex justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            className="text-xs font-semibold text-brand-primary hover:underline disabled:opacity-50"
            disabled={openFile.isPending}
            onClick={() => openFile.mutate(() => getDesignStandardDocumentLink(d.id))}
            aria-label={`Open ${d.title}`}
          >
            Open
          </button>
          {canManage && d.isCurrent && (
            <button type="button" className="text-xs font-semibold text-slate-700 hover:underline" onClick={() => setDialog({ supersedes: d })} aria-label={`Upload a new version of ${d.title}`}>
              New version
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <StandardTable<DesignStandardDocumentDto>
        title="Standard drawings and specifications"
        subtitle={`${documents.filter((d) => d.isCurrent).length} current`}
        headerActions={
          canManage ? (
            <button type="button" className={primaryButton} onClick={() => setDialog({ supersedes: null })}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Add document
            </button>
          ) : undefined
        }
        columns={columns}
        data={rows}
        keyExtractor={(d) => d.id}
        minWidth="min-w-[860px]"
        emptyState={{
          title: "No design standards yet",
          description: canManage ? "Add the standard classroom, toilet and other drawings and specifications." : "Standard drawings and specifications appear here once they are added.",
        }}
      />

      <section className={cardCls} aria-labelledby="essential-groups">
        <h3 id="essential-groups" className="text-sm font-bold text-slate-900">
          Essential facilities at every school
        </h3>
        <p className="text-[11px] text-slate-500">
          Each site of a proposed project needs work proposed, or an existing Functional facility, in every group. Set per programme in its project type
          (Settings → Project types → Needs assessment).
        </p>
        {essentialGroups.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No programme has a needs assessment cycle yet.</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            {essentialGroups.map((p) => (
              <div key={p.projectTypeId}>
                <h4 className="text-xs font-bold text-slate-900">{p.projectTypeName}</h4>
                {p.groups.length === 0 ? (
                  <p className="text-xs text-slate-500">No essential groups.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-slate-700">
                    {p.groups.map((g) => (
                      <li key={g.label}>
                        <span className="font-semibold text-slate-900">{g.label}:</span> {g.facilityNames.length ? g.facilityNames.join(", ") : g.facilityCodes.join(", ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {dialog && <DesignDocumentDialog facilities={facilities} supersedes={dialog.supersedes} onClose={() => setDialog(null)} />}
    </div>
  );
}
