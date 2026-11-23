import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  AddDocumentVersionRequest,
  defaultSignOffStatement,
  documentMimeAllowed,
  DocumentDownloadDto,
  ProjectDocumentDetailDto,
  ProjectDocumentDto,
  RegisterProjectDocumentRequest,
  SignProjectDocumentRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { assertProjectObjectKey, projectObjectPrefix, storageService } from '../../integrations/storage.service';
import { recordAuditEvent } from '../audit/audit.service';
import { provisionDefaultDocumentTypes } from './documentTypes.service';

/**
 * Phase 13: the project document register. A document has a type, versions (each one an object in
 * storage whose size, type and SHA-256 the server reads itself) and sign-offs (authenticated
 * acknowledgements of one version).
 *
 * Visibility: the monitoring side sees every document. A web user whose organisation is a
 * contractor on the project (the contractor side, as for defects) sees documents of types shared
 * with contractors that are project-wide or tied to its own contractor, plus what it uploaded.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export interface DocumentViewer {
  webUser: WebJwtPayload;
  /** The viewer's contractor on the project; null = monitoring side (sees everything). */
  contractorId: string | null;
}

export async function documentViewerFor(db: Db, projectId: string, webUser: WebJwtPayload): Promise<DocumentViewer> {
  if (webUser.isPlatformSuperAdmin) return { webUser, contractorId: null };
  const pc = await db.projectContractor.findFirst({
    where: { projectId, organizationId: webUser.organizationId },
    select: { id: true },
  });
  return { webUser, contractorId: pc?.id ?? null };
}

export function documentVisibilityWhere(viewer: DocumentViewer): Prisma.ProjectDocumentWhereInput {
  if (!viewer.contractorId) return {};
  return {
    OR: [
      { uploadedByUserId: viewer.webUser.userId },
      {
        documentType: { visibleToContractors: true },
        OR: [{ projectContractorId: null }, { projectContractorId: viewer.contractorId }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const DOCUMENT_INCLUDE = {
  documentType: true,
  versions: { orderBy: { version: 'desc' } },
  signOffs: { orderBy: { signedAt: 'asc' } },
  projectContractor: { select: { organization: { select: { name: true } } } },
} satisfies Prisma.ProjectDocumentInclude;

type DocumentRow = Prisma.ProjectDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

async function peopleFor(db: Db, rows: DocumentRow[]) {
  const userIds = new Set<string>();
  for (const d of rows) {
    if (d.uploadedByUserId) userIds.add(d.uploadedByUserId);
    for (const v of d.versions) if (v.uploadedByUserId) userIds.add(v.uploadedByUserId);
    for (const s of d.signOffs) userIds.add(s.userId);
  }
  const users = userIds.size
    ? await db.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, fullName: true, role: { select: { name: true } }, organization: { select: { name: true } } },
      })
    : [];
  return new Map(users.map((u) => [u.id, u]));
}

/** Whether the user may sign documents of this type (its sign-off permission, if any). */
function holdsSignOffPermission(webUser: WebJwtPayload, type: { signOffPermissionKey: string | null }) {
  return !type.signOffPermissionKey || hasWebPermission(webUser, type.signOffPermissionKey);
}

function serializeBase(d: DocumentRow, people: Awaited<ReturnType<typeof peopleFor>>, viewer: WebJwtPayload | null): ProjectDocumentDto {
  const current = d.versions.find((v) => v.version === d.currentVersion) ?? d.versions[0];
  const currentSignOffs = d.signOffs.filter((s) => s.version === d.currentVersion);
  const signedByMe = Boolean(viewer && currentSignOffs.some((s) => s.userId === viewer.userId));
  return {
    id: d.id,
    projectId: d.projectId,
    documentType: {
      id: d.documentType.id,
      code: d.documentType.code,
      name: d.documentType.name,
      requiresSignOff: d.documentType.requiresSignOff,
      visibleToContractors: d.documentType.visibleToContractors,
      signOffPermissionKey: d.documentType.signOffPermissionKey,
    },
    title: d.title,
    currentVersion: d.currentVersion,
    current: {
      version: current.version,
      mimeType: current.mimeType,
      byteSize: current.byteSize,
      sha256: current.sha256,
      uploadedByUserId: current.uploadedByUserId,
      uploadedByName: current.uploadedByUserId ? people.get(current.uploadedByUserId)?.fullName ?? null : null,
      uploadedAt: current.uploadedAt.toISOString(),
      note: current.note,
    },
    uploadedByUserId: d.uploadedByUserId,
    uploadedByName: d.uploadedByUserId ? people.get(d.uploadedByUserId)?.fullName ?? null : null,
    projectContractorId: d.projectContractorId,
    contractorName: d.projectContractor?.organization.name ?? null,
    linkedMilestoneId: d.linkedMilestoneId,
    isArchived: d.isArchived,
    createdAt: d.createdAt.toISOString(),
    signOffCount: currentSignOffs.length,
    signedByMe,
    awaitingSignOff: d.documentType.requiresSignOff && currentSignOffs.length === 0,
    canSign: Boolean(viewer) && !d.isArchived && !signedByMe && holdsSignOffPermission(viewer!, d.documentType),
  };
}

function serializeDetail(d: DocumentRow, people: Awaited<ReturnType<typeof peopleFor>>, viewer: WebJwtPayload | null): ProjectDocumentDetailDto {
  return {
    ...serializeBase(d, people, viewer),
    versions: d.versions.map((v) => ({
      version: v.version,
      mimeType: v.mimeType,
      byteSize: v.byteSize,
      sha256: v.sha256,
      uploadedByUserId: v.uploadedByUserId,
      uploadedByName: v.uploadedByUserId ? people.get(v.uploadedByUserId)?.fullName ?? null : null,
      uploadedAt: v.uploadedAt.toISOString(),
      note: v.note,
    })),
    signOffs: d.signOffs.map((s) => {
      const u = people.get(s.userId);
      return {
        id: s.id,
        version: s.version,
        userId: s.userId,
        userName: u?.fullName ?? null,
        roleName: u?.role.name ?? null,
        organizationName: u?.organization.name ?? null,
        statement: s.statement,
        statementHash: s.statementHash,
        signedAt: s.signedAt.toISOString(),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listProjectDocuments(params: {
  projectId: string;
  webUser: WebJwtPayload;
  typeCode?: string;
  contractorId?: string;
  includeArchived?: boolean;
}): Promise<ProjectDocumentDto[]> {
  const viewer = await documentViewerFor(prisma, params.projectId, params.webUser);
  const rows = await prisma.projectDocument.findMany({
    where: {
      AND: [
        { projectId: params.projectId },
        params.includeArchived ? {} : { isArchived: false },
        params.typeCode ? { documentType: { code: params.typeCode } } : {},
        params.contractorId ? { projectContractorId: params.contractorId } : {},
        documentVisibilityWhere(viewer),
      ],
    },
    include: DOCUMENT_INCLUDE,
    orderBy: [{ createdAt: 'desc' }],
  });
  const people = await peopleFor(prisma, rows);
  return rows.map((d) => serializeBase(d, people, params.webUser));
}

async function loadVisibleDocument(db: Db, projectId: string, documentId: string, viewer: DocumentViewer): Promise<DocumentRow> {
  const doc = await db.projectDocument.findFirst({
    where: { AND: [{ id: documentId, projectId }, documentVisibilityWhere(viewer)] },
    include: DOCUMENT_INCLUDE,
  });
  // Same answer whether it does not exist or is not visible.
  if (!doc) throw new AppError('Document not found', 404, 'DOCUMENT_NOT_FOUND');
  return doc;
}

export async function getProjectDocument(projectId: string, documentId: string, webUser: WebJwtPayload): Promise<ProjectDocumentDetailDto> {
  const viewer = await documentViewerFor(prisma, projectId, webUser);
  const doc = await loadVisibleDocument(prisma, projectId, documentId, viewer);
  return serializeDetail(doc, await peopleFor(prisma, [doc]), webUser);
}

/** A register document of this project (for CP evidence, kick-off agenda and minutes). */
export async function assertProjectDocument(db: Db, projectId: string, documentId: string) {
  const doc = await db.projectDocument.findFirst({
    where: { id: documentId, projectId },
    select: { id: true, title: true, isArchived: true, documentType: { select: { code: true } } },
  });
  if (!doc) throw new AppError('Document not found on this project', 404, 'DOCUMENT_NOT_FOUND');
  if (doc.isArchived) throw new AppError(`"${doc.title}" is archived`, 409, 'DOCUMENT_ARCHIVED');
  return doc;
}

export async function getDocumentDownload(
  projectId: string,
  documentId: string,
  webUser: WebJwtPayload,
  version?: number
): Promise<DocumentDownloadDto> {
  const viewer = await documentViewerFor(prisma, projectId, webUser);
  const doc = await loadVisibleDocument(prisma, projectId, documentId, viewer);
  const v = doc.versions.find((x) => x.version === (version ?? doc.currentVersion));
  if (!v) throw new AppError('Version not found', 404, 'DOCUMENT_VERSION_NOT_FOUND');
  const ext = v.objectKey.includes('.') ? v.objectKey.slice(v.objectKey.lastIndexOf('.')) : '';
  const fileName = `${doc.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60)}-v${v.version}${ext}`;
  const expiresInSeconds = 300;
  const url = await storageService.getPresignedReadUrl(v.objectKey, expiresInSeconds, { attachmentName: fileName });
  return { url, expiresInSeconds, fileName };
}

/**
 * The media endpoint serves any object key of a project to anyone with project access. A key that
 * belongs to a register document must also pass the document rules. Returns false for other keys.
 */
export async function assertDocumentObjectReadable(projectId: string, objectKey: string, webUser: WebJwtPayload | undefined): Promise<boolean> {
  const version = await prisma.projectDocumentVersion.findUnique({
    where: { objectKey },
    select: { document: { select: { id: true, projectId: true } } },
  });
  if (!version) return false;
  const denied = new AppError('File reference must be an object key issued for this project', 400, 'INVALID_OBJECT_KEY');
  if (!webUser || version.document.projectId !== projectId || !hasWebPermission(webUser, 'documents:view')) throw denied;
  const viewer = await documentViewerFor(prisma, projectId, webUser);
  const visible = await prisma.projectDocument.count({
    where: { AND: [{ id: version.document.id }, documentVisibilityWhere(viewer)] },
  });
  if (!visible) throw denied;
  return true;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Reads size, type and SHA-256 of an uploaded object from storage (never from the client). */
async function inspectUpload(projectId: string, tenantId: string, objectKey: string) {
  const key = assertProjectObjectKey(objectKey, tenantId, projectId);
  if (!key.startsWith(`${projectObjectPrefix(tenantId, projectId)}project_document/`)) {
    throw new AppError('Upload the file as a project document first', 400, 'INVALID_OBJECT_KEY');
  }
  const head = await storageService.headObject(key);
  if (!head) throw new AppError('The uploaded file was not found. Upload it again.', 422, 'UPLOAD_NOT_FOUND');
  const body = await storageService.getObjectBuffer(key, MAX_DOCUMENT_BYTES);
  if (!body) throw new AppError('The uploaded file was not found. Upload it again.', 422, 'UPLOAD_NOT_FOUND');
  const mimeType = (head.contentType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  return { objectKey: key, mimeType, byteSize: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
}

async function loadProjectTenant(db: Db, projectId: string) {
  return db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, tenantId: true } });
}

function uniqueKeyConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function registerProjectDocument(
  projectId: string,
  webUser: WebJwtPayload,
  input: RegisterProjectDocumentRequest
): Promise<ProjectDocumentDetailDto> {
  const project = await loadProjectTenant(prisma, projectId);
  if ((await prisma.documentType.count({ where: { tenantId: project.tenantId } })) === 0) {
    await provisionDefaultDocumentTypes(prisma, project.tenantId);
  }
  const type = await prisma.documentType.findFirst({ where: { id: input.documentTypeId, tenantId: project.tenantId } });
  if (!type) throw new AppError('Document type not found', 404, 'DOCUMENT_TYPE_NOT_FOUND');
  if (type.isArchived) throw new AppError(`"${type.name}" is archived and cannot be used`, 409, 'DOCUMENT_TYPE_ARCHIVED');
  const viewer = await documentViewerFor(prisma, projectId, webUser);

  // The contractor side files documents for its own contractor only.
  let projectContractorId = input.projectContractorId ?? null;
  if (viewer.contractorId) {
    if (projectContractorId && projectContractorId !== viewer.contractorId) {
      throw new AppError('You can only file documents for your own organisation', 403, 'FORBIDDEN_CONTRACTOR');
    }
    projectContractorId = viewer.contractorId;
  } else if (projectContractorId) {
    const pc = await prisma.projectContractor.count({ where: { id: projectContractorId, projectId } });
    if (!pc) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
  }
  if (input.linkedMilestoneId) {
    const m = await prisma.projectContractMilestone.count({ where: { id: input.linkedMilestoneId, projectId } });
    if (!m) throw new AppError('Milestone not found on this project', 404, 'MILESTONE_NOT_FOUND');
  }

  const file = await inspectUpload(projectId, project.tenantId, input.objectKey);
  if (!documentMimeAllowed(type, file.mimeType)) {
    throw new AppError(`${file.mimeType} files are not allowed for "${type.name}"`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }

  try {
    const id = await prisma.$transaction(async (tx) => {
      const doc = await tx.projectDocument.create({
        data: {
          projectId,
          documentTypeId: type.id,
          title: input.title,
          currentVersion: 1,
          uploadedByUserId: webUser.userId,
          projectContractorId,
          linkedMilestoneId: input.linkedMilestoneId ?? null,
          versions: { create: { version: 1, ...file, uploadedByUserId: webUser.userId, note: input.note ?? null } },
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'DOCUMENT_UPLOADED',
        summaryText: `Filed ${type.name.toLowerCase()} "${input.title}" (version 1).`,
        payload: { documentId: doc.id, documentTypeCode: type.code, sha256: file.sha256, byteSize: file.byteSize, projectContractorId },
      });
      return doc.id;
    });
    return getProjectDocument(projectId, id, webUser);
  } catch (error) {
    if (uniqueKeyConflict(error)) throw new AppError('This file is already in the register', 409, 'OBJECT_ALREADY_REGISTERED');
    throw error;
  }
}

/** The contractor side may change only what it uploaded. */
function assertMayChange(doc: DocumentRow, viewer: DocumentViewer) {
  if (viewer.contractorId && doc.uploadedByUserId !== viewer.webUser.userId) {
    throw new AppError('Only the monitoring side or the uploader can change this document', 403, 'FORBIDDEN_DOCUMENT');
  }
}

export async function addDocumentVersion(
  projectId: string,
  documentId: string,
  webUser: WebJwtPayload,
  input: AddDocumentVersionRequest
): Promise<ProjectDocumentDetailDto> {
  const project = await loadProjectTenant(prisma, projectId);
  const viewer = await documentViewerFor(prisma, projectId, webUser);
  const doc = await loadVisibleDocument(prisma, projectId, documentId, viewer);
  assertMayChange(doc, viewer);
  if (doc.isArchived) throw new AppError('This document is archived', 409, 'DOCUMENT_ARCHIVED');
  const file = await inspectUpload(projectId, project.tenantId, input.objectKey);
  if (!documentMimeAllowed(doc.documentType, file.mimeType)) {
    throw new AppError(`${file.mimeType} files are not allowed for "${doc.documentType.name}"`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "project_documents" WHERE id = ${documentId}::uuid FOR UPDATE`;
      const locked = await tx.projectDocument.findUniqueOrThrow({ where: { id: documentId }, select: { currentVersion: true } });
      const version = locked.currentVersion + 1;
      await tx.projectDocumentVersion.create({
        data: { documentId, version, ...file, uploadedByUserId: webUser.userId, note: input.note ?? null },
      });
      await tx.projectDocument.update({ where: { id: documentId }, data: { currentVersion: version } });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'DOCUMENT_VERSIONED',
        summaryText: `Filed version ${version} of "${doc.title}". Sign-offs of earlier versions stay with those versions.`,
        payload: { documentId, version, sha256: file.sha256, byteSize: file.byteSize },
      });
    });
  } catch (error) {
    if (uniqueKeyConflict(error)) throw new AppError('This file is already in the register', 409, 'OBJECT_ALREADY_REGISTERED');
    throw error;
  }
  return getProjectDocument(projectId, documentId, webUser);
}

export function signOffStatementHash(p: { documentId: string; version: number; versionSha256: string; userId: string; statement: string }) {
  return crypto
    .createHash('sha256')
    .update(`${p.documentId}|${p.version}|${p.versionSha256}|${p.userId}|${p.statement}`)
    .digest('hex');
}

export async function signProjectDocument(
  projectId: string,
  documentId: string,
  webUser: WebJwtPayload,
  input: SignProjectDocumentRequest
): Promise<ProjectDocumentDetailDto> {
  const viewer = await documentViewerFor(prisma, projectId, webUser);
  const doc = await loadVisibleDocument(prisma, projectId, documentId, viewer);
  if (doc.isArchived) throw new AppError('This document is archived', 409, 'DOCUMENT_ARCHIVED');
  if (input.version !== doc.currentVersion) {
    throw new AppError(`Version ${input.version} has been replaced by version ${doc.currentVersion}. Sign the current version.`, 409, 'VERSION_SUPERSEDED');
  }
  if (!holdsSignOffPermission(webUser, doc.documentType)) {
    throw new AppError(`Signing "${doc.documentType.name}" needs ${doc.documentType.signOffPermissionKey}`, 403, 'SIGN_OFF_PERMISSION_REQUIRED');
  }
  const version = doc.versions.find((v) => v.version === input.version)!;
  const statement = input.statement ?? defaultSignOffStatement(doc.title, input.version);
  const statementHash = signOffStatementHash({ documentId, version: input.version, versionSha256: version.sha256, userId: webUser.userId, statement });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.projectDocumentSignOff.create({
        data: {
          documentId,
          version: input.version,
          userId: webUser.userId,
          roleId: webUser.roleId,
          organizationId: webUser.organizationId,
          statement,
          statementHash,
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'DOCUMENT_SIGNED',
        summaryText: `Signed off "${doc.title}" (version ${input.version}).`,
        payload: { documentId, version: input.version, versionSha256: version.sha256, statementHash },
      });
    });
  } catch (error) {
    if (uniqueKeyConflict(error)) throw new AppError('You have already signed this version', 409, 'ALREADY_SIGNED');
    throw error;
  }
  return getProjectDocument(projectId, documentId, webUser);
}

export async function archiveProjectDocument(projectId: string, documentId: string, webUser: WebJwtPayload, reason: string) {
  const viewer = await documentViewerFor(prisma, projectId, webUser);
  const doc = await loadVisibleDocument(prisma, projectId, documentId, viewer);
  assertMayChange(doc, viewer);
  if (doc.isArchived) throw new AppError('This document is already archived', 409, 'DOCUMENT_ARCHIVED');
  await prisma.$transaction(async (tx) => {
    await tx.projectDocument.update({ where: { id: documentId }, data: { isArchived: true, archivedReason: reason } });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'DOCUMENT_ARCHIVED',
      summaryText: `Archived "${doc.title}": ${reason}`,
      payload: { documentId, reason },
    });
  });
  return getProjectDocument(projectId, documentId, webUser);
}

// ---------------------------------------------------------------------------
// Phase 15: documents the server produces (certificates, closure packs)
// ---------------------------------------------------------------------------

export interface GeneratedFile {
  /** Small files: the bytes. */
  body?: Buffer;
  /** Large files: a local file already hashed by the caller. */
  filePath?: string;
  byteSize?: number;
  sha256?: string;
  mimeType: string;
  extension: string;
}

/**
 * Stores a server-generated file and files it in the register as version 1 of a new document.
 * `signOffs` records sign-offs by people who genuinely signed what the file shows (e.g. the CoC
 * signatories), hashed like any other sign-off. Runs inside the caller's transaction; the caller
 * records the audit entry that explains the document.
 */
export async function storeGeneratedDocument(
  tx: Tx,
  p: {
    projectId: string;
    tenantId: string;
    typeCode: string;
    title: string;
    file: GeneratedFile;
    uploadedByUserId: string | null;
    note: string | null;
    projectContractorId?: string | null;
    signOffs?: Array<{ userId: string; roleId: string | null; organizationId: string | null; statement: string }>;
  }
): Promise<{ documentId: string; objectKey: string; sha256: string; byteSize: number }> {
  if ((await tx.documentType.count({ where: { tenantId: p.tenantId } })) === 0) await provisionDefaultDocumentTypes(tx, p.tenantId);
  const type = await tx.documentType.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code: p.typeCode } } });
  if (!type) throw new AppError(`The document type ${p.typeCode} is missing for this tenant`, 409, 'DOCUMENT_TYPE_NOT_FOUND');
  const objectKey = `${projectObjectPrefix(p.tenantId, p.projectId)}project_document/generated-${crypto.randomUUID()}.${p.file.extension}`;
  let sha256: string;
  let byteSize: number;
  if (p.file.body) {
    sha256 = crypto.createHash('sha256').update(p.file.body).digest('hex');
    byteSize = p.file.body.length;
    await storageService.putServerObject(objectKey, p.file.body, p.file.mimeType);
  } else if (p.file.filePath && p.file.sha256 && p.file.byteSize !== undefined) {
    sha256 = p.file.sha256;
    byteSize = p.file.byteSize;
    await storageService.putServerObjectFromFile(objectKey, p.file.filePath, p.file.mimeType);
  } else {
    throw new Error('storeGeneratedDocument: give a body or a hashed file');
  }
  const doc = await tx.projectDocument.create({
    data: {
      projectId: p.projectId,
      documentTypeId: type.id,
      title: p.title,
      currentVersion: 1,
      uploadedByUserId: p.uploadedByUserId,
      projectContractorId: p.projectContractorId ?? null,
      versions: { create: { version: 1, objectKey, mimeType: p.file.mimeType, byteSize, sha256, uploadedByUserId: p.uploadedByUserId, note: p.note } },
    },
  });
  for (const s of p.signOffs ?? []) {
    await tx.projectDocumentSignOff.create({
      data: {
        documentId: doc.id,
        version: 1,
        userId: s.userId,
        roleId: s.roleId,
        organizationId: s.organizationId,
        statement: s.statement,
        statementHash: signOffStatementHash({ documentId: doc.id, version: 1, versionSha256: sha256, userId: s.userId, statement: s.statement }),
      },
    });
  }
  return { documentId: doc.id, objectKey, sha256, byteSize };
}

/**
 * Phase 15: registers a file the caller uploaded through the presign (type checked here), inside
 * the caller's transaction. Used for the beneficiary's signed paper certificate.
 */
export async function registerUploadedDocumentTx(
  tx: Tx,
  p: { projectId: string; tenantId: string; typeCode: string; title: string; objectKey: string; note: string | null; uploadedByUserId: string }
): Promise<{ documentId: string; sha256: string }> {
  const file = await inspectUpload(p.projectId, p.tenantId, p.objectKey);
  if ((await tx.documentType.count({ where: { tenantId: p.tenantId } })) === 0) await provisionDefaultDocumentTypes(tx, p.tenantId);
  const type = await tx.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: p.tenantId, code: p.typeCode } } });
  if (!documentMimeAllowed(type, file.mimeType)) {
    throw new AppError(`${file.mimeType} files are not allowed for "${type.name}"`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (await tx.projectDocumentVersion.count({ where: { objectKey: file.objectKey } })) {
    throw new AppError('This file is already in the register', 409, 'OBJECT_ALREADY_REGISTERED');
  }
  const doc = await tx.projectDocument.create({
    data: {
      projectId: p.projectId,
      documentTypeId: type.id,
      title: p.title,
      currentVersion: 1,
      uploadedByUserId: p.uploadedByUserId,
      versions: { create: { version: 1, ...file, uploadedByUserId: p.uploadedByUserId, note: p.note } },
    },
  });
  return { documentId: doc.id, sha256: file.sha256 };
}

// ---------------------------------------------------------------------------
// Evidence for milestones and requirements
// ---------------------------------------------------------------------------

export interface RegisterEvidence {
  documentId: string;
  title: string;
  typeCode: string;
  projectContractorId: string | null;
  requiresSignOff: boolean;
  /** Users who signed the current version. */
  currentSignerIds: string[];
}

/** Non-archived documents of the given type codes, with the signers of each current version. */
export async function registerEvidence(db: Db, projectId: string, typeCodes: string[]): Promise<RegisterEvidence[]> {
  if (typeCodes.length === 0) return [];
  const docs = await db.projectDocument.findMany({
    where: { projectId, isArchived: false, documentType: { code: { in: typeCodes } } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      currentVersion: true,
      projectContractorId: true,
      documentType: { select: { code: true, requiresSignOff: true } },
      signOffs: { select: { version: true, userId: true } },
    },
  });
  return docs.map((d) => ({
    documentId: d.id,
    title: d.title,
    typeCode: d.documentType.code,
    projectContractorId: d.projectContractorId,
    requiresSignOff: d.documentType.requiresSignOff,
    currentSignerIds: d.signOffs.filter((s) => s.version === d.currentVersion).map((s) => s.userId),
  }));
}

/** Of `userIds`, those whose role (web or mobile) holds `permissionKey`. */
export async function usersHoldingPermission(db: Db, userIds: string[], permissionKey: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const holds = { rolePermissions: { some: { permission: { key: permissionKey } } } };
  const users = await db.user.findMany({
    where: { id: { in: userIds }, OR: [{ role: holds }, { mobileRole: holds }] },
    select: { id: true },
  });
  return new Set(users.map((u) => u.id));
}

/** Documents of the type codes per contractor scope: for a contractor, its own or project-wide ones. */
export function evidenceFor(evidence: RegisterEvidence[], typeCode: string, projectContractorId: string | null) {
  return evidence.filter(
    (e) => e.typeCode === typeCode && (e.projectContractorId === null || projectContractorId === null || e.projectContractorId === projectContractorId)
  );
}

export type { Tx as DocumentsTx };
