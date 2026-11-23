import { Prisma } from '@prisma/client';
import {
  DEFAULT_DOCUMENT_TYPES,
  DocumentTypeDto,
  SaveDocumentTypeRequest,
  SYSTEM_PERMISSIONS_CATALOG,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

/**
 * Phase 13: tenant document types. Every tenant starts with DEFAULT_DOCUMENT_TYPES (codes are
 * stable: project types and milestones refer to them); tenants change names, sign-off and
 * visibility, add their own and archive the ones they do not use.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const KNOWN_PERMISSIONS = new Set(SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key));

export async function provisionDefaultDocumentTypes(db: Db, tenantId: string): Promise<void> {
  await db.documentType.createMany({
    data: DEFAULT_DOCUMENT_TYPES.map((t) => ({ tenantId, ...t })),
    skipDuplicates: true,
  });
}

type TypeRow = Prisma.DocumentTypeGetPayload<{ include: { _count: { select: { documents: true } } } }>;

function serialize(t: TypeRow): DocumentTypeDto {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    visibleToContractors: t.visibleToContractors,
    requiresSignOff: t.requiresSignOff,
    signOffPermissionKey: t.signOffPermissionKey,
    allowedMimeTypes: t.allowedMimeTypes,
    isArchived: t.isArchived,
    documentCount: t._count.documents,
  };
}

export async function listDocumentTypes(tenantId: string, includeArchived = false): Promise<DocumentTypeDto[]> {
  // Tenants created before Phase 13 (or by an older seed) get the defaults on first use.
  if ((await prisma.documentType.count({ where: { tenantId } })) === 0) {
    await provisionDefaultDocumentTypes(prisma, tenantId);
  }
  const rows = await prisma.documentType.findMany({
    where: { tenantId, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { documents: true } } },
  });
  return rows.map(serialize);
}

async function save(webUser: WebJwtPayload, input: SaveDocumentTypeRequest, typeId: string | null): Promise<DocumentTypeDto> {
  const tenantId = webUser.tenantId;
  if (input.signOffPermissionKey && !KNOWN_PERMISSIONS.has(input.signOffPermissionKey)) {
    throw new AppError(`Unknown permission "${input.signOffPermissionKey}"`, 422, 'UNKNOWN_PERMISSION');
  }
  try {
    const id = await prisma.$transaction(async (tx) => {
      const before = typeId ? await tx.documentType.findFirst({ where: { id: typeId, tenantId } }) : null;
      if (typeId && !before) throw new AppError('Document type not found', 404, 'DOCUMENT_TYPE_NOT_FOUND');
      if (before && before.code !== input.code) {
        // Project types and milestones refer to types by code.
        throw new AppError('The code of a document type cannot change.', 409, 'DOCUMENT_TYPE_CODE_LOCKED');
      }
      const data = {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        visibleToContractors: input.visibleToContractors,
        requiresSignOff: input.requiresSignOff,
        signOffPermissionKey: input.signOffPermissionKey ?? null,
        allowedMimeTypes: input.allowedMimeTypes,
        isArchived: input.isArchived ?? before?.isArchived ?? false,
      };
      const saved = before
        ? await tx.documentType.update({ where: { id: before.id }, data })
        : await tx.documentType.create({ data: { tenantId, ...data } });
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
        action: 'DOCUMENT_TYPE_SAVED',
        summaryText: `${before ? 'Updated' : 'Added'} document type "${saved.name}" (${saved.code})${saved.isArchived ? ', archived' : ''}.`,
        payload: { documentTypeId: saved.id, ...data },
      });
      return saved.id;
    });
    const row = await prisma.documentType.findUniqueOrThrow({ where: { id }, include: { _count: { select: { documents: true } } } });
    return serialize(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(`A document type with code "${input.code}" already exists`, 409, 'DOCUMENT_TYPE_CODE_EXISTS');
    }
    throw error;
  }
}

export const createDocumentType = (webUser: WebJwtPayload, input: SaveDocumentTypeRequest) => save(webUser, input, null);
export const updateDocumentType = (webUser: WebJwtPayload, typeId: string, input: SaveDocumentTypeRequest) => save(webUser, input, typeId);
