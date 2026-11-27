import crypto from 'crypto';
import { AppError } from '../middleware/error.middleware';
import { PresignedUploadResult, storageService } from '../integrations/storage.service';

/**
 * Needs pipeline wave 2: files that belong to a tenant area rather than a project (cycle and proposal
 * documents, needs assessment versions, design standard documents). The project helpers in
 * `storage.service.ts` key everything under a project; these key under
 * `tenants/<tenantId>/<area>/`, with the same trust model: the server issues the key, checks it on
 * registration and reads size, type and SHA-256 from storage, never from the client.
 *
 * Areas used: `needs/cycles/<cycleId>/` (presign kind NEEDS_DOCUMENT: `needs_document/`; versions:
 * `versions/`) and `standards/design_document/`.
 */

export function tenantAreaPrefix(tenantId: string, area: string): string {
  const clean = area.replace(/^\/+|\/+$/g, '');
  return `tenants/${tenantId}/${clean}/`;
}

/** Throws 400 INVALID_OBJECT_KEY unless `objectKey` is a plain key under `prefix`. */
export function assertTenantAreaObjectKey(objectKey: string, prefix: string): string {
  if (
    typeof objectKey !== 'string' ||
    !objectKey.startsWith(prefix) ||
    objectKey.includes('..') ||
    objectKey.includes('//') ||
    !/^[A-Za-z0-9/._-]+$/.test(objectKey)
  ) {
    throw new AppError('File reference must be an object key issued for this upload', 400, 'INVALID_OBJECT_KEY');
  }
  return objectKey;
}

const safeName = (fileName: string) => fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';

/** A new key under `prefix` for a file name. */
export function newTenantAreaObjectKey(prefix: string, fileName: string): string {
  return `${prefix}${Date.now()}-${crypto.randomUUID()}-${safeName(fileName)}`;
}

/**
 * Presigned PUT under `prefix` after checking type and size against `policy`
 * (415 UNSUPPORTED_MEDIA_TYPE, 413 FILE_TOO_LARGE).
 */
export async function presignTenantAreaUpload(params: {
  prefix: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  policy: { mimeTypes: readonly string[]; maxBytes: number };
}): Promise<PresignedUploadResult> {
  const mimeType = params.mimeType.toLowerCase();
  if (!params.policy.mimeTypes.includes(mimeType)) {
    throw new AppError(`Files of type ${params.mimeType} cannot be uploaded here`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (!Number.isInteger(params.byteSize) || params.byteSize <= 0 || params.byteSize > params.policy.maxBytes) {
    throw new AppError(`The file must be between 1 byte and ${Math.round(params.policy.maxBytes / (1024 * 1024))} MB`, 413, 'FILE_TOO_LARGE');
  }
  return storageService.presignPutAt({ objectKey: newTenantAreaObjectKey(params.prefix, params.fileName), mimeType, byteSize: params.byteSize });
}

export interface InspectedUpload {
  objectKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

/**
 * Reads an uploaded object (key checked against `prefix`): size, type and SHA-256 from storage.
 * 422 UPLOAD_NOT_FOUND when nothing was uploaded; 415 when the stored type is not allowed.
 */
export async function inspectTenantAreaUpload(
  objectKey: string,
  prefix: string,
  policy: { mimeTypes: readonly string[]; maxBytes: number }
): Promise<InspectedUpload> {
  const key = assertTenantAreaObjectKey(objectKey, prefix);
  const head = await storageService.headObject(key);
  if (!head) throw new AppError('The uploaded file was not found. Upload it again.', 422, 'UPLOAD_NOT_FOUND');
  const body = await storageService.getObjectBuffer(key, policy.maxBytes);
  if (!body) throw new AppError('The uploaded file was not found. Upload it again.', 422, 'UPLOAD_NOT_FOUND');
  const mimeType = (head.contentType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!policy.mimeTypes.includes(mimeType)) throw new AppError(`Files of type ${mimeType} cannot be uploaded here`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  const stored = key.slice(key.lastIndexOf('/') + 1);
  // Key form: <ms>-<uuid>-<name>; the uuid has four dashes.
  const fileName = stored.split('-').slice(6).join('-') || stored;
  return { objectKey: key, fileName, mimeType, byteSize: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
}

/** Stores a buffer the server already holds (an uploaded needs assessment) under `prefix`. */
export async function storeTenantAreaBuffer(prefix: string, fileName: string, body: Buffer, contentType: string): Promise<InspectedUpload> {
  const objectKey = newTenantAreaObjectKey(prefix, fileName);
  await storageService.putServerObject(objectKey, body, contentType);
  return { objectKey, fileName, mimeType: contentType, byteSize: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
}
