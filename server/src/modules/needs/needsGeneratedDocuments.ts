import { Prisma } from '@prisma/client';
import { CYCLE_DOCUMENT_KIND_META, XLSX_CONTENT_TYPE, type NeedsCycleDocumentDto, type NeedsReportKind } from '@insite/shared';
import { storeTenantAreaBuffer, type InspectedUpload } from '../../utils/tenantUploads';
import { recordAuditEvent } from '../audit/audit.service';
import { cycleDocumentPrefix } from './needsCycles.service';
import { serializeCycleDocument } from './needsSerializers';

/**
 * Needs pipeline wave 3 (main thread seam): the generated cycle reports (D-N.5: Validated Project
 * List, Cost Estimate Report, Prioritised Project Portfolio), stored as generated cycle documents
 * linked to the proposals they cover. Each report is an xlsx and a PDF; a regeneration supersedes
 * the current generated document of the same kind and file type. A signed copy is uploaded as an
 * ordinary cycle document beside it.
 *
 * Two steps, as the upload does: store the files (outside the transaction), then register them in
 * the decision's transaction. A transaction that fails after the files were stored leaves objects
 * nothing points at (wave 2 item 18: the storage service has no delete; harmless).
 */

type Tx = Prisma.TransactionClient;

export const PDF_CONTENT_TYPE = 'application/pdf';

export interface GeneratedReportFile {
  buffer: Buffer;
  /** e.g. "2027 DI Validated Project List.xlsx". */
  fileName: string;
  mimeType: typeof XLSX_CONTENT_TYPE | typeof PDF_CONTENT_TYPE;
}

export interface StoredReportFile extends InspectedUpload {
  mimeType: string;
}

/** Step 1 (outside the transaction): the files go to the cycle's document area. */
export async function storeGeneratedReportFiles(tenantId: string, cycleId: string, files: readonly GeneratedReportFile[]): Promise<StoredReportFile[]> {
  const prefix = cycleDocumentPrefix(tenantId, cycleId);
  return Promise.all(files.map((f) => storeTenantAreaBuffer(prefix, f.fileName, f.buffer, f.mimeType)));
}

/**
 * Step 2 (inside the decision's transaction, under `lockCycle`): one generated document per stored
 * file, superseding the current generated one of the same kind and file type; one ledger entry
 * (`NEEDS_DOCUMENT_ADDED`, `generated: true`) for the report.
 */
export async function registerGeneratedReportInTx(
  tx: Tx,
  params: {
    tenantId: string;
    cycleId: string;
    kind: NeedsReportKind;
    title: string;
    proposalIds: readonly string[];
    files: readonly StoredReportFile[];
    by: { userId: string; name: string };
    actor: { actorType: 'WEB_USER' | 'SYSTEM'; actorId: string; actorDisplayName: string };
  }
): Promise<NeedsCycleDocumentDto[]> {
  const created = [];
  for (const file of params.files) {
    const current = await tx.needsCycleDocument.findFirst({
      where: { cycleId: params.cycleId, kind: params.kind, generated: true, mimeType: file.mimeType, supersededBy: { none: {} } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    created.push(
      await tx.needsCycleDocument.create({
        data: {
          cycleId: params.cycleId,
          kind: params.kind,
          title: params.title,
          generated: true,
          objectKey: file.objectKey,
          fileName: file.fileName,
          mimeType: file.mimeType,
          byteSize: file.byteSize,
          sha256: file.sha256,
          supersedesId: current?.id ?? null,
          coveredProposalIds: [...new Set(params.proposalIds)],
          uploadedByUserId: params.by.userId,
          uploadedByName: params.by.name,
        },
      })
    );
  }
  await recordAuditEvent(tx, {
    tenantId: params.tenantId,
    projectId: null,
    ...params.actor,
    action: 'NEEDS_DOCUMENT_ADDED',
    summaryText: `Generated the ${CYCLE_DOCUMENT_KIND_META[params.kind].label} (${params.proposalIds.length} proposed project${params.proposalIds.length === 1 ? '' : 's'}).`,
    payload: {
      cycleId: params.cycleId,
      generated: true,
      kind: params.kind,
      title: params.title,
      documentIds: created.map((d) => d.id),
      proposalIds: [...new Set(params.proposalIds)],
      sha256: created.map((d) => d.sha256),
    },
  });
  return created.map(serializeCycleDocument);
}
