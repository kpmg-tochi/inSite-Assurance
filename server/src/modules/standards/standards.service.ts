import { Prisma } from '@prisma/client';
import {
  NeedsAssessmentDocumentDto,
  ProjectStandardDto,
  ProjectStandardInput,
  RegisterNeedsAssessmentRequest,
  UpdateProjectStandardRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { assertProjectObjectKey } from '../../integrations/storage.service';
import { recordAuditEvent } from '../audit/audit.service';

/**
 * Project standards and needs-assessment documents (Phase 7 Step 3). Managed during the wizard
 * (the "standards" step) and afterwards under the project, with `projects:manage_standards_docs`.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type StandardRow = Prisma.ProjectStandardSpecificationGetPayload<object>;
type NeedsRow = Prisma.ProjectNeedsAssessmentDocumentGetPayload<object>;

const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;

function asStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function serializeStandard(s: StandardRow): ProjectStandardDto {
  return {
    id: s.id,
    projectId: s.projectId,
    code: s.code,
    title: s.title,
    category: s.category,
    specificationText: s.specificationText,
    documentObjectKey: s.documentObjectKey,
    applicableWbsCodes: asStrings(s.applicableWbsCodes),
    isMandatory: s.isMandatory,
    createdByUserId: s.createdByUserId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function serializeNeeds(d: NeedsRow): NeedsAssessmentDocumentDto {
  return {
    id: d.id,
    projectId: d.projectId,
    title: d.title,
    documentType: d.documentType,
    objectKey: d.objectKey,
    mimeType: d.mimeType,
    byteSize: d.byteSize,
    uploadedByUserId: d.uploadedByUserId,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

async function projectTenant(db: Db, projectId: string): Promise<string> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
  return p.tenantId;
}

// ---------------------------------------------------------------------------
// Standards
// ---------------------------------------------------------------------------

export async function listProjectStandards(projectId: string): Promise<ProjectStandardDto[]> {
  const rows = await prisma.projectStandardSpecification.findMany({ where: { projectId }, orderBy: { code: 'asc' } });
  return rows.map(serializeStandard);
}

/** Project-wide standards plus those scoped to this WBS code or one of its parents. */
function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createProjectStandard(
  projectId: string,
  webUser: WebJwtPayload,
  input: ProjectStandardInput
): Promise<ProjectStandardDto> {
  if (input.documentObjectKey) {
    assertProjectObjectKey(input.documentObjectKey, await projectTenant(prisma, projectId), projectId);
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.projectStandardSpecification.create({
        data: {
          projectId,
          code: input.code,
          title: input.title,
          category: input.category,
          specificationText: input.specificationText,
          documentObjectKey: input.documentObjectKey ?? null,
          applicableWbsCodes: input.applicableWbsCodes as unknown as Prisma.InputJsonValue,
          isMandatory: input.isMandatory,
          createdByUserId: webUser.userId,
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'PROJECT_STANDARD_CREATED',
        summaryText: `Added standard ${created.code} "${created.title}"${created.isMandatory ? ' (mandatory)' : ''}.`,
        payload: { standardId: created.id, code: created.code, applicableWbsCodes: input.applicableWbsCodes },
      });
      return created;
    });
    return serializeStandard(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`A standard with code "${input.code}" already exists on this project`, 409, 'DUPLICATE_STANDARD_CODE');
    }
    throw error;
  }
}

export async function updateProjectStandard(
  projectId: string,
  standardId: string,
  webUser: WebJwtPayload,
  input: UpdateProjectStandardRequest
): Promise<ProjectStandardDto> {
  if (input.documentObjectKey) {
    assertProjectObjectKey(input.documentObjectKey, await projectTenant(prisma, projectId), projectId);
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.projectStandardSpecification.findFirst({ where: { id: standardId, projectId } });
      if (!existing) throw new AppError('Standard not found', 404, 'STANDARD_NOT_FOUND');
      const updated = await tx.projectStandardSpecification.update({
        where: { id: standardId },
        data: {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.specificationText !== undefined ? { specificationText: input.specificationText } : {}),
          ...(input.documentObjectKey !== undefined ? { documentObjectKey: input.documentObjectKey } : {}),
          ...(input.applicableWbsCodes !== undefined
            ? { applicableWbsCodes: input.applicableWbsCodes as unknown as Prisma.InputJsonValue }
            : {}),
          ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'PROJECT_STANDARD_UPDATED',
        summaryText: `Updated standard ${updated.code} "${updated.title}".`,
        payload: { standardId, changedFields: Object.keys(input) },
      });
      return updated;
    });
    return serializeStandard(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`A standard with code "${input.code}" already exists on this project`, 409, 'DUPLICATE_STANDARD_CODE');
    }
    throw error;
  }
}

export async function deleteProjectStandard(projectId: string, standardId: string, webUser: WebJwtPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.projectStandardSpecification.findFirst({ where: { id: standardId, projectId } });
    if (!existing) throw new AppError('Standard not found', 404, 'STANDARD_NOT_FOUND');
    await tx.projectStandardSpecification.delete({ where: { id: standardId } });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_STANDARD_DELETED',
      summaryText: `Removed standard ${existing.code} "${existing.title}". Reports already checked keep their result.`,
      payload: { standardId, code: existing.code },
    });
  });
}

// ---------------------------------------------------------------------------
// Needs assessments
// ---------------------------------------------------------------------------

export async function listNeedsAssessments(projectId: string): Promise<NeedsAssessmentDocumentDto[]> {
  const rows = await prisma.projectNeedsAssessmentDocument.findMany({ where: { projectId }, orderBy: { uploadedAt: 'desc' } });
  return rows.map(serializeNeeds);
}

/**
 * Summarises a needs-assessment document: reads its text (plain text, PDF, .docx), then asks the AI
 * provider. A file with no readable text becomes UNAVAILABLE. With no provider (or a failure) the
 * document stays PENDING and can be retried. Text is never invented.
 */
export async function registerNeedsAssessment(
  projectId: string,
  webUser: WebJwtPayload,
  input: RegisterNeedsAssessmentRequest
): Promise<NeedsAssessmentDocumentDto> {
  assertProjectObjectKey(input.objectKey, await projectTenant(prisma, projectId), projectId);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.projectNeedsAssessmentDocument.create({
      data: {
        projectId,
        title: input.title,
        documentType: input.documentType,
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        uploadedByUserId: webUser.userId,
      },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'NEEDS_ASSESSMENT_UPLOADED',
      summaryText: `Uploaded needs-assessment document "${created.title}" (${created.documentType}).`,
      payload: { documentId: created.id, documentType: created.documentType, objectKey: created.objectKey, byteSize: created.byteSize },
    });
    return created;
  });
  return serializeNeeds(row);
}

export async function deleteNeedsAssessment(projectId: string, documentId: string, webUser: WebJwtPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.projectNeedsAssessmentDocument.findFirst({ where: { id: documentId, projectId } });
    if (!existing) throw new AppError('Document not found', 404, 'NEEDS_ASSESSMENT_NOT_FOUND');
    await tx.projectNeedsAssessmentDocument.delete({ where: { id: documentId } });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'NEEDS_ASSESSMENT_DELETED',
      summaryText: `Removed needs-assessment document "${existing.title}".`,
      payload: { documentId, objectKey: existing.objectKey },
    });
  });
}

export async function countStandardsDocs(db: Db, projectId: string) {
  const [standardCount, needsAssessmentCount] = await Promise.all([
    db.projectStandardSpecification.count({ where: { projectId } }),
    db.projectNeedsAssessmentDocument.count({ where: { projectId } }),
  ]);
  return { standardCount, needsAssessmentCount };
}
