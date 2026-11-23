import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HANDOVER_UPLOAD_POLICY, MediaType } from '@insite/shared';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';

export interface PresignedUploadResult {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
  storageMode: 'S3_COMPATIBLE' | 'LOCAL_DEV_SIMULATED';
}

export interface StoredObjectInfo {
  byteSize: number;
  contentType: string | null;
}

const MB = 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const DOC_TYPES = ['application/pdf', ...IMAGE_TYPES];

/** Allowed content types and size cap per media type (Phase 2 Step 8). */
export const MEDIA_UPLOAD_POLICY: Record<MediaType, { mimeTypes: string[]; maxBytes: number }> = {
  SITE_PHOTO: { mimeTypes: IMAGE_TYPES, maxBytes: 15 * MB },
  VOICE_NOTE: {
    mimeTypes: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'],
    maxBytes: 25 * MB,
  },
  WAYBILL_DOCUMENT: { mimeTypes: DOC_TYPES, maxBytes: 20 * MB },
  LAB_CUBE_TEST_CERT: { mimeTypes: DOC_TYPES, maxBytes: 20 * MB },
  MILL_CERTIFICATE: { mimeTypes: DOC_TYPES, maxBytes: 20 * MB },
  BOQ_SPREADSHEET: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ],
    maxBytes: 10 * MB,
  },
  VALUATION_REPORT_PDF: { mimeTypes: ['application/pdf'], maxBytes: 20 * MB },
  IDENTITY_DOCUMENT: { mimeTypes: DOC_TYPES, maxBytes: 15 * MB },
  IDENTITY_SELFIE: { mimeTypes: IMAGE_TYPES, maxBytes: 15 * MB },
  // Phase 7: needs assessments and standards reference documents.
  PROJECT_DOCUMENT: {
    mimeTypes: [
      ...DOC_TYPES,
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ],
    maxBytes: 25 * MB,
  },
};

export const MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(MEDIA_UPLOAD_POLICY).map((p) => p.maxBytes),
  // Phase 10: stakeholder audio and video.
  ...Object.values(HANDOVER_UPLOAD_POLICY).map((p) => p.maxBytes)
);

/**
 * Phase 10: stakeholder handover uploads live under this prefix inside the project namespace. They
 * are quarantined: never registered as captures and never counted as field evidence.
 */
export function handoverObjectPrefix(tenantId: string, projectId: string, linkId: string): string {
  return `${projectObjectPrefix(tenantId, projectId)}handover/${linkId}/`;
}

export function isHandoverObjectKey(objectKey: string, tenantId: string, projectId: string): boolean {
  return objectKey.startsWith(`${projectObjectPrefix(tenantId, projectId)}handover/`);
}

/** Every object for a project lives under this prefix. */
export function projectObjectPrefix(tenantId: string, projectId: string): string {
  return `tenants/${tenantId}/projects/${projectId}/`;
}

/**
 * Throws unless `objectKey` is a plain key inside the given project's namespace. Rejects URLs,
 * device-local URIs, data URIs and path traversal.
 */
export function assertProjectObjectKey(objectKey: string, tenantId: string, projectId: string): string {
  const prefix = projectObjectPrefix(tenantId, projectId);
  if (
    typeof objectKey !== 'string' ||
    !objectKey.startsWith(prefix) ||
    objectKey.includes('..') ||
    objectKey.includes('//') ||
    !/^[A-Za-z0-9/._-]+$/.test(objectKey)
  ) {
    throw new AppError(
      'File reference must be an object key issued for this project',
      400,
      'INVALID_OBJECT_KEY'
    );
  }
  return objectKey;
}

export function isProjectObjectKey(objectKey: string | null | undefined, tenantId: string, projectId: string) {
  if (!objectKey) return false;
  try {
    assertProjectObjectKey(objectKey, tenantId, projectId);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Local development storage: files on disk, reached through HMAC-signed URLs with an expiry.
// Same trust model as an S3 presigned URL (only the API issues them, after its own access
// checks). Never used when S3 is configured; production refuses to start without S3.
// ---------------------------------------------------------------------------

type LocalUrlPurpose = 'put' | 'get';

function safeDispositionName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'download';
}

function localSignature(purpose: LocalUrlPurpose, key: string, expires: number, extra: string): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`local-storage:${purpose}:${key}:${expires}:${extra}`)
    .digest('hex');
}

export function signLocalStorageUrl(params: {
  purpose: LocalUrlPurpose;
  objectKey: string;
  expiresInSeconds: number;
  contentType?: string;
  byteSize?: number;
  /** get only: serve as a download with this file name (Content-Disposition: attachment). */
  attachmentName?: string;
}): string {
  const expires = Math.floor(Date.now() / 1000) + params.expiresInSeconds;
  const attachment = params.attachmentName ? safeDispositionName(params.attachmentName) : '';
  const extra = params.purpose === 'put' ? `${params.contentType}:${params.byteSize}` : attachment;
  const sig = localSignature(params.purpose, params.objectKey, expires, extra);
  const q = new URLSearchParams({ key: params.objectKey, expires: String(expires), sig });
  if (params.purpose === 'put') {
    q.set('contentType', params.contentType ?? '');
    q.set('byteSize', String(params.byteSize ?? 0));
  }
  if (params.purpose === 'get' && attachment) q.set('attachment', attachment);
  const route = params.purpose === 'put' ? 'upload' : 'file';
  return `${env.PUBLIC_API_BASE_URL}/api/v1/storage/local-dev/${route}?${q.toString()}`;
}

/** Throws unless the query carries a valid, unexpired signature for this purpose. */
export function verifyLocalStorageUrl(
  purpose: LocalUrlPurpose,
  query: Record<string, unknown>
): { objectKey: string; contentType: string; byteSize: number; attachmentName: string | null } {
  const key = String(query.key ?? '');
  const expires = Number(query.expires ?? 0);
  const sig = String(query.sig ?? '');
  const contentType = String(query.contentType ?? '');
  const byteSize = Number(query.byteSize ?? 0);
  const attachment = purpose === 'get' ? String(query.attachment ?? '') : '';
  const extra = purpose === 'put' ? `${contentType}:${byteSize}` : attachment;
  const expected = localSignature(purpose, key, expires, extra);
  const valid =
    key.length > 0 &&
    Number.isFinite(expires) &&
    expires * 1000 >= Date.now() &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) {
    throw new AppError('Storage link is invalid or has expired', 403, 'STORAGE_URL_INVALID');
  }
  if (key.includes('..') || !/^[A-Za-z0-9/._-]+$/.test(key)) {
    throw new AppError('Invalid object key', 400, 'INVALID_OBJECT_KEY');
  }
  return { objectKey: key, contentType, byteSize, attachmentName: attachment || null };
}

/** Phase 10: local multipart parts live next to the object until completion. */
function localPartsDir(objectKey: string, uploadId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new AppError('Invalid upload', 400, 'INVALID_UPLOAD_ID');
  return `${localPathFor(objectKey)}.parts/${uploadId}`;
}

function localPartSignature(key: string, uploadId: string, partNumber: number, maxBytes: number, expires: number): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`local-storage:part:${key}:${uploadId}:${partNumber}:${maxBytes}:${expires}`)
    .digest('hex');
}

export function signLocalPartUrl(params: {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  maxBytes: number;
  expiresInSeconds: number;
}): string {
  const expires = Math.floor(Date.now() / 1000) + params.expiresInSeconds;
  const sig = localPartSignature(params.objectKey, params.uploadId, params.partNumber, params.maxBytes, expires);
  const q = new URLSearchParams({
    key: params.objectKey,
    uploadId: params.uploadId,
    partNumber: String(params.partNumber),
    maxBytes: String(params.maxBytes),
    expires: String(expires),
    sig,
  });
  return `${env.PUBLIC_API_BASE_URL}/api/v1/storage/local-dev/part?${q.toString()}`;
}

export function verifyLocalPartUrl(query: Record<string, unknown>) {
  const key = String(query.key ?? '');
  const uploadId = String(query.uploadId ?? '');
  const partNumber = Number(query.partNumber ?? 0);
  const maxBytes = Number(query.maxBytes ?? 0);
  const expires = Number(query.expires ?? 0);
  const sig = String(query.sig ?? '');
  const expected = localPartSignature(key, uploadId, partNumber, maxBytes, expires);
  const valid =
    key.length > 0 &&
    Number.isInteger(partNumber) &&
    partNumber > 0 &&
    expires * 1000 >= Date.now() &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) throw new AppError('Storage link is invalid or has expired', 403, 'STORAGE_URL_INVALID');
  if (key.includes('..') || !/^[A-Za-z0-9/._-]+$/.test(key)) throw new AppError('Invalid object key', 400, 'INVALID_OBJECT_KEY');
  return { objectKey: key, uploadId, partNumber, maxBytes };
}

function localPathFor(objectKey: string): string {
  const root = path.resolve(env.LOCAL_STORAGE_DIR);
  const full = path.resolve(root, objectKey);
  if (!full.startsWith(root + path.sep)) {
    throw new AppError('Invalid object key', 400, 'INVALID_OBJECT_KEY');
  }
  return full;
}

class StorageService {
  private s3Client: S3Client | null = null;

  constructor() {
    if (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
      this.s3Client = new S3Client({
        region: env.S3_REGION || 'auto',
        endpoint: env.S3_ENDPOINT,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      });
    }
  }

  public isCloudConfigured(): boolean {
    return this.s3Client !== null;
  }

  /**
   * Issues a presigned PUT for one file. Content type and exact size are part of the signature,
   * so the client cannot upload a different type or a larger file than it declared.
   */
  public async createPresignedUpload(params: {
    tenantId: string;
    projectId: string;
    mediaType: MediaType;
    fileName: string;
    mimeType: string;
    byteSize: number;
  }): Promise<PresignedUploadResult> {
    const policy = MEDIA_UPLOAD_POLICY[params.mediaType];
    const mimeType = params.mimeType.toLowerCase();
    if (!policy.mimeTypes.includes(mimeType)) {
      throw new AppError(
        `Content type ${params.mimeType} is not allowed for ${params.mediaType}`,
        415,
        'UNSUPPORTED_MEDIA_TYPE'
      );
    }
    if (!Number.isInteger(params.byteSize) || params.byteSize <= 0 || params.byteSize > policy.maxBytes) {
      throw new AppError(
        `File size must be between 1 byte and ${Math.round(policy.maxBytes / MB)} MB for ${params.mediaType}`,
        413,
        'FILE_TOO_LARGE'
      );
    }

    const safeFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const objectKey = `${projectObjectPrefix(params.tenantId, params.projectId)}${params.mediaType.toLowerCase()}/${Date.now()}-${crypto.randomUUID()}-${safeFileName}`;
    return this.presignPutAt({ objectKey, mimeType, byteSize: params.byteSize });
  }

  /**
   * Presigned PUT for an exact key. Callers validate the type, size and key namespace first
   * (Phase 10 handover uploads use their own allow-list).
   */
  public async presignPutAt(params: { objectKey: string; mimeType: string; byteSize: number }): Promise<PresignedUploadResult> {
    const { objectKey, byteSize } = params;
    const mimeType = params.mimeType.toLowerCase();
    const expiresInSeconds = 900; // 15 minutes

    if (!this.s3Client) {
      return {
        objectKey,
        uploadUrl: signLocalStorageUrl({
          purpose: 'put',
          objectKey,
          expiresInSeconds,
          contentType: mimeType,
          byteSize,
        }),
        expiresInSeconds,
        storageMode: 'LOCAL_DEV_SIMULATED',
      };
    }

    const putCommand = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: byteSize,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, putCommand, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    return { objectKey, uploadUrl, expiresInSeconds, storageMode: 'S3_COMPATIBLE' };
  }

  /** Short-lived signed read URL. Callers must have checked access to the object's project. */
  public async getPresignedReadUrl(
    objectKey: string,
    expiresInSeconds = 300,
    options: { attachmentName?: string } = {}
  ): Promise<string> {
    if (!this.s3Client) {
      return signLocalStorageUrl({ purpose: 'get', objectKey, expiresInSeconds, attachmentName: options.attachmentName });
    }
    const getCommand = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: objectKey,
      ...(options.attachmentName
        ? { ResponseContentDisposition: `attachment; filename="${safeDispositionName(options.attachmentName)}"` }
        : {}),
    });
    return getSignedUrl(this.s3Client, getCommand, { expiresIn: expiresInSeconds });
  }

  /** Reads an object's bytes. Returns null when the object does not exist. */
  public async getObjectBuffer(objectKey: string, maxBytes = 30 * MB): Promise<Buffer | null> {
    if (!this.s3Client) {
      try {
        const full = localPathFor(objectKey);
        const stat = await fs.stat(full);
        if (stat.size > maxBytes) {
          throw new AppError('Stored object is too large to process', 413, 'FILE_TOO_LARGE');
        }
        return await fs.readFile(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    }
    try {
      const res = await this.s3Client.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: objectKey })
      );
      if (res.ContentLength && res.ContentLength > maxBytes) {
        throw new AppError('Stored object is too large to process', 413, 'FILE_TOO_LARGE');
      }
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }

  /** Size and content type of a stored object, or null if it does not exist. */
  public async headObject(objectKey: string): Promise<StoredObjectInfo | null> {
    if (!this.s3Client) {
      try {
        const full = localPathFor(objectKey);
        const stat = await fs.stat(full);
        const contentType = await fs.readFile(`${full}.content-type`, 'utf8').catch(() => null);
        return { byteSize: stat.size, contentType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    }
    try {
      const res = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: objectKey })
      );
      return { byteSize: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return null;
      throw error;
    }
  }

  /** Local development only: writes uploaded bytes to disk. */
  public async putLocalObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3Client) {
      throw new AppError('Local storage is disabled when S3 is configured', 404, 'NOT_FOUND');
    }
    const full = localPathFor(objectKey);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    await fs.writeFile(`${full}.content-type`, contentType, 'utf8');
  }

  /**
   * Phase 15: stores a file the server produced itself (generated PDFs, closure packs). Works in
   * both modes. Callers choose a key inside the project namespace.
   */
  public async putServerObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.s3Client) {
      await this.putLocalObject(objectKey, body, contentType);
      return;
    }
    await this.s3Client.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: objectKey, Body: body, ContentType: contentType, ContentLength: body.length })
    );
  }

  /** Phase 15: same, streaming from a local file (large closure packs never sit in memory whole). */
  public async putServerObjectFromFile(objectKey: string, filePath: string, contentType: string): Promise<void> {
    const stat = await fs.stat(filePath);
    if (!this.s3Client) {
      const full = localPathFor(objectKey);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.copyFile(filePath, full);
      await fs.writeFile(`${full}.content-type`, contentType, 'utf8');
      return;
    }
    const { createReadStream } = await import('fs');
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: objectKey,
        Body: createReadStream(filePath),
        ContentType: contentType,
        ContentLength: stat.size,
      })
    );
  }

  /** Local development only: reads a file with its stored content type. */
  public async readLocalObject(objectKey: string): Promise<{ body: Buffer; contentType: string } | null> {
    if (this.s3Client) return null;
    const body = await this.getObjectBuffer(objectKey, MAX_UPLOAD_BYTES);
    if (!body) return null;
    const contentType = await fs
      .readFile(`${localPathFor(objectKey)}.content-type`, 'utf8')
      .catch(() => 'application/octet-stream');
    return { body, contentType };
  }

  // -------------------------------------------------------------------------
  // Phase 10: resumable (multipart) uploads. S3 multipart in production; in local development the
  // parts are files under `<object>.parts/<uploadId>/` and are joined on completion. Callers check
  // the key namespace, type and size before starting.
  // -------------------------------------------------------------------------

  public async startMultipartUpload(params: { objectKey: string; mimeType: string }): Promise<string> {
    if (!this.s3Client) {
      const uploadId = crypto.randomUUID();
      const dir = localPartsDir(params.objectKey, uploadId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'content-type'), params.mimeType.toLowerCase(), 'utf8');
      return uploadId;
    }
    const res = await this.s3Client.send(
      new CreateMultipartUploadCommand({ Bucket: env.S3_BUCKET_NAME, Key: params.objectKey, ContentType: params.mimeType.toLowerCase() })
    );
    if (!res.UploadId) throw new AppError('Storage did not start the upload', 502, 'MULTIPART_START_FAILED');
    return res.UploadId;
  }

  /** Signed URL for one part. `maxBytes` is enforced locally; on S3 the part sizes are checked at completion. */
  public async presignUploadPart(params: { objectKey: string; uploadId: string; partNumber: number; maxBytes: number }): Promise<string> {
    const expiresInSeconds = 900;
    if (!this.s3Client) return signLocalPartUrl({ ...params, expiresInSeconds });
    return getSignedUrl(
      this.s3Client,
      new UploadPartCommand({ Bucket: env.S3_BUCKET_NAME, Key: params.objectKey, UploadId: params.uploadId, PartNumber: params.partNumber }),
      { expiresIn: expiresInSeconds }
    );
  }

  /** Parts received so far (part number, size and ETag). */
  public async listUploadedParts(params: { objectKey: string; uploadId: string }): Promise<Array<{ partNumber: number; size: number; etag: string }>> {
    if (!this.s3Client) {
      const dir = localPartsDir(params.objectKey, params.uploadId);
      const names = await fs.readdir(dir).catch(() => null);
      if (!names) throw new AppError('This upload is no longer available. Start it again.', 404, 'MULTIPART_NOT_FOUND');
      const parts = [];
      for (const name of names) {
        if (!/^\d+\.part$/.test(name)) continue;
        const stat = await fs.stat(path.join(dir, name));
        parts.push({ partNumber: Number(name.split('.')[0]), size: stat.size, etag: `local-${name}` });
      }
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    }
    const parts: Array<{ partNumber: number; size: number; etag: string }> = [];
    let marker: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const res = await this.s3Client
        .send(new ListPartsCommand({ Bucket: env.S3_BUCKET_NAME, Key: params.objectKey, UploadId: params.uploadId, PartNumberMarker: marker }))
        .catch((error) => {
          if ((error as { name?: string }).name === 'NoSuchUpload') {
            throw new AppError('This upload is no longer available. Start it again.', 404, 'MULTIPART_NOT_FOUND');
          }
          throw error;
        });
      for (const p of res.Parts ?? []) {
        if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, size: p.Size ?? 0, etag: p.ETag });
      }
      if (!res.IsTruncated) break;
      marker = res.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  /** Joins the parts into the object. The caller has checked every part is present with the right size. */
  public async completeMultipartUpload(params: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Promise<void> {
    if (!this.s3Client) {
      const dir = localPartsDir(params.objectKey, params.uploadId);
      const contentType = await fs.readFile(path.join(dir, 'content-type'), 'utf8');
      const buffers = [];
      for (const p of params.parts) buffers.push(await fs.readFile(path.join(dir, `${p.partNumber}.part`)));
      await this.putLocalObject(params.objectKey, Buffer.concat(buffers), contentType);
      await fs.rm(dir, { recursive: true, force: true });
      return;
    }
    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: params.objectKey,
        UploadId: params.uploadId,
        MultipartUpload: { Parts: params.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      })
    );
  }

  /** Local development only: stores one part (the URL was signed for this upload, part and size cap). */
  public async putLocalPart(params: { objectKey: string; uploadId: string; partNumber: number; body: Buffer }): Promise<void> {
    if (this.s3Client) throw new AppError('Local storage is disabled when S3 is configured', 404, 'NOT_FOUND');
    const dir = localPartsDir(params.objectKey, params.uploadId);
    const exists = await fs.stat(dir).then(() => true, () => false);
    if (!exists) throw new AppError('This upload is no longer available', 404, 'MULTIPART_NOT_FOUND');
    await fs.writeFile(path.join(dir, `${params.partNumber}.part`), params.body);
  }
}

export const storageService = new StorageService();
