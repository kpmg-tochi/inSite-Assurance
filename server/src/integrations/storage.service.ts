import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MediaType } from '@insite/shared';
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
};

export const MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(MEDIA_UPLOAD_POLICY).map((p) => p.maxBytes)
);

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
}): string {
  const expires = Math.floor(Date.now() / 1000) + params.expiresInSeconds;
  const extra = params.purpose === 'put' ? `${params.contentType}:${params.byteSize}` : '';
  const sig = localSignature(params.purpose, params.objectKey, expires, extra);
  const q = new URLSearchParams({ key: params.objectKey, expires: String(expires), sig });
  if (params.purpose === 'put') {
    q.set('contentType', params.contentType ?? '');
    q.set('byteSize', String(params.byteSize ?? 0));
  }
  const route = params.purpose === 'put' ? 'upload' : 'file';
  return `${env.PUBLIC_API_BASE_URL}/api/v1/storage/local-dev/${route}?${q.toString()}`;
}

/** Throws unless the query carries a valid, unexpired signature for this purpose. */
export function verifyLocalStorageUrl(
  purpose: LocalUrlPurpose,
  query: Record<string, unknown>
): { objectKey: string; contentType: string; byteSize: number } {
  const key = String(query.key ?? '');
  const expires = Number(query.expires ?? 0);
  const sig = String(query.sig ?? '');
  const contentType = String(query.contentType ?? '');
  const byteSize = Number(query.byteSize ?? 0);
  const extra = purpose === 'put' ? `${contentType}:${byteSize}` : '';
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
  return { objectKey: key, contentType, byteSize };
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
    const expiresInSeconds = 900; // 15 minutes

    if (!this.s3Client) {
      return {
        objectKey,
        uploadUrl: signLocalStorageUrl({
          purpose: 'put',
          objectKey,
          expiresInSeconds,
          contentType: mimeType,
          byteSize: params.byteSize,
        }),
        expiresInSeconds,
        storageMode: 'LOCAL_DEV_SIMULATED',
      };
    }

    const putCommand = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: params.byteSize,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, putCommand, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    return { objectKey, uploadUrl, expiresInSeconds, storageMode: 'S3_COMPATIBLE' };
  }

  /** Short-lived signed read URL. Callers must have checked access to the object's project. */
  public async getPresignedReadUrl(objectKey: string, expiresInSeconds = 300): Promise<string> {
    if (!this.s3Client) {
      return signLocalStorageUrl({ purpose: 'get', objectKey, expiresInSeconds });
    }
    const getCommand = new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: objectKey });
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
}

export const storageService = new StorageService();
