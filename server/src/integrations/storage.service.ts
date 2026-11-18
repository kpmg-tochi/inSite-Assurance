import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
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
};

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
      const mockBase = `http://localhost:${env.PORT}/api/v1/storage/local-dev`;
      return {
        objectKey,
        uploadUrl: `${mockBase}/upload?key=${encodeURIComponent(objectKey)}`,
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
      return `http://localhost:${env.PORT}/api/v1/storage/local-dev/file?key=${encodeURIComponent(objectKey)}`;
    }
    const getCommand = new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: objectKey });
    return getSignedUrl(this.s3Client, getCommand, { expiresIn: expiresInSeconds });
  }

  /** Reads an object from the configured bucket. Returns null when storage is not configured. */
  public async getObjectBuffer(objectKey: string, maxBytes = 30 * MB): Promise<Buffer | null> {
    if (!this.s3Client) return null;
    const res = await this.s3Client.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: objectKey })
    );
    if (res.ContentLength && res.ContentLength > maxBytes) {
      throw new AppError('Stored object is too large to process', 413, 'FILE_TOO_LARGE');
    }
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  }
}

export const storageService = new StorageService();
