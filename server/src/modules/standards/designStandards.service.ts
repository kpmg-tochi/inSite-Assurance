import { Prisma } from '@prisma/client';
import {
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  type DesignStandardDocumentDto,
  type DesignStandardDocumentKind,
  type NeedsDocumentPresignRequest,
  type NeedsFileLinkDto,
  type NeedsPresignedUploadDto,
  type RegisterDesignStandardDocumentRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { storageService } from '../../integrations/storage.service';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { inspectTenantAreaUpload, presignTenantAreaUpload, tenantAreaPrefix } from '../../utils/tenantUploads';
import { recordAuditEvent } from '../audit/audit.service';
import { ensureFacilities } from '../facilities/facilities.service';

/**
 * Needs pipeline wave 2 (N2): design standard documents (standard drawings, specifications,
 * guidelines) on the Standards page. Files go up through a presigned PUT under
 * `tenants/<tenantId>/standards/design_document/`; registering reads size, type and SHA-256 from
 * storage. A new version supersedes the current document (the earlier one stays, `isCurrent: false`).
 * Audited DESIGN_STANDARD_DOCUMENT_ADDED on the tenant ledger.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type DocRow = Prisma.DesignStandardDocumentGetPayload<object>;

const LINK_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const designPrefix = (tenantId: string) => tenantAreaPrefix(tenantId, 'standards/design_document');

function serialize(row: DocRow, supersededIds: ReadonlySet<string>): DesignStandardDocumentDto {
  return {
    id: row.id,
    kind: row.kind as DesignStandardDocumentKind,
    title: row.title,
    facilityCodes: row.facilityCodes,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    supersedesId: row.supersedesId,
    isCurrent: !supersededIds.has(row.id),
    uploadedByName: row.uploadedByName,
    uploadedAt: row.createdAt.toISOString(),
  };
}

/** Every design standard document of the tenant: current ones first, newest first within each. */
export async function listDesignStandardDocuments(tenantId: string, db: Db = prisma): Promise<DesignStandardDocumentDto[]> {
  const rows = await db.designStandardDocument.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  const superseded = new Set(rows.map((r) => r.supersedesId).filter((id): id is string => Boolean(id)));
  const dtos = rows.map((r) => serialize(r, superseded));
  return [...dtos.filter((d) => d.isCurrent), ...dtos.filter((d) => !d.isCurrent)];
}

export async function presignDesignStandardDocument(webUser: WebJwtPayload, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  return presignTenantAreaUpload({
    prefix: designPrefix(webUser.tenantId),
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    policy: NEEDS_DOCUMENT_UPLOAD_POLICY,
  });
}

export async function registerDesignStandardDocument(webUser: WebJwtPayload, input: RegisterDesignStandardDocumentRequest): Promise<DesignStandardDocumentDto> {
  const tenantId = webUser.tenantId;
  const facilityCodes = [...new Set(input.facilityCodes)];
  if (facilityCodes.length) {
    await ensureFacilities(prisma, tenantId);
    const found = await prisma.facility.findMany({ where: { tenantId, code: { in: facilityCodes } }, select: { code: true } });
    const known = new Set(found.map((f) => f.code));
    const unknown = facilityCodes.filter((c) => !known.has(c));
    if (unknown.length) throw new AppError(`Not a facility code of this workspace: ${unknown.join(', ')}`, 422, 'UNKNOWN_FACILITY_CODE', { facilityCodes: unknown });
  }
  // Size, type and SHA-256 come from storage (key checked against the tenant's area).
  const file = await inspectTenantAreaUpload(input.objectKey, designPrefix(tenantId), NEEDS_DOCUMENT_UPLOAD_POLICY);

  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`design-standards:${tenantId}`}))`;
    if (await tx.designStandardDocument.findFirst({ where: { tenantId, objectKey: file.objectKey }, select: { id: true } })) {
      throw new AppError('This file is already registered', 409, 'DESIGN_STANDARD_DOCUMENT_EXISTS');
    }
    let supersedes: DocRow | null = null;
    if (input.supersedesId) {
      supersedes = await tx.designStandardDocument.findFirst({ where: { id: input.supersedesId, tenantId } });
      if (!supersedes) throw new AppError('The document to replace was not found', 404, 'DESIGN_STANDARD_DOCUMENT_NOT_FOUND');
      if (await tx.designStandardDocument.findFirst({ where: { supersedesId: supersedes.id }, select: { id: true } })) {
        throw new AppError('That document has already been replaced: replace its current version instead.', 409, 'DESIGN_STANDARD_DOCUMENT_SUPERSEDED');
      }
    }
    const created = await tx.designStandardDocument.create({
      data: {
        tenantId,
        kind: input.kind,
        title: input.title,
        facilityCodes,
        objectKey: file.objectKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sha256: file.sha256,
        supersedesId: supersedes?.id ?? null,
        uploadedByUserId: webUser.userId,
        uploadedByName: webUser.fullName,
      },
    });
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'DESIGN_STANDARD_DOCUMENT_ADDED',
      summaryText: supersedes
        ? `Added a new version of the design standard "${supersedes.title}": "${created.title}" (${created.fileName}).`
        : `Added the design standard "${created.title}" (${created.fileName}).`,
      payload: {
        designStandardDocumentId: created.id,
        kind: created.kind,
        title: created.title,
        facilityCodes,
        fileName: created.fileName,
        mimeType: created.mimeType,
        byteSize: created.byteSize,
        sha256: created.sha256,
        supersedesId: created.supersedesId,
      },
    });
    return created;
  });
  return serialize(row, new Set());
}

/** A 5-minute signed link to a design standard document of the caller's tenant (404 otherwise). */
export async function designStandardDocumentLink(tenantId: string, documentId: string): Promise<NeedsFileLinkDto> {
  const row = UUID_RE.test(documentId)
    ? await prisma.designStandardDocument.findFirst({ where: { id: documentId, tenantId }, select: { objectKey: true, fileName: true } })
    : null;
  if (!row) throw new AppError('Design standard document not found', 404, 'DESIGN_STANDARD_DOCUMENT_NOT_FOUND');
  const url = await storageService.getPresignedReadUrl(row.objectKey, LINK_SECONDS, { attachmentName: row.fileName });
  return { url, expiresInSeconds: LINK_SECONDS, fileName: row.fileName };
}
