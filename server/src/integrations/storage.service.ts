import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MediaType } from '@insite/shared';
import { env } from '../config/env';

export interface PresignedUploadResult {
  objectKey: string;
  uploadUrl: string;
  publicOrReadUrl: string;
  expiresInSeconds: number;
  storageMode: 'S3_COMPATIBLE' | 'LOCAL_DEV_SIMULATED';
}

class StorageService {
  private s3Client: S3Client | null = null;

  constructor() {
    if (
      env.S3_ENDPOINT &&
      env.S3_ACCESS_KEY_ID &&
      env.S3_SECRET_ACCESS_KEY
    ) {
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

  public async createPresignedUpload(params: {
    projectId: string;
    mediaType: MediaType;
    fileName: string;
    mimeType: string;
  }): Promise<PresignedUploadResult> {
    const safeFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueSuffix = crypto.randomUUID().slice(0, 8);
    const objectKey = `projects/${params.projectId}/${params.mediaType.toLowerCase()}/${Date.now()}-${uniqueSuffix}-${safeFileName}`;
    const expiresInSeconds = 900; // 15 minutes

    if (!this.s3Client) {
      const mockBase = `http://localhost:${env.PORT}/api/v1/storage/local-dev`;
      return {
        objectKey,
        uploadUrl: `${mockBase}/upload?key=${encodeURIComponent(objectKey)}`,
        publicOrReadUrl: `${mockBase}/file?key=${encodeURIComponent(objectKey)}`,
        expiresInSeconds,
        storageMode: 'LOCAL_DEV_SIMULATED',
      };
    }

    const putCommand = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: objectKey,
      ContentType: params.mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, putCommand, {
      expiresIn: expiresInSeconds,
    });

    const publicOrReadUrl = env.S3_PUBLIC_BASE_URL
      ? `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`
      : await this.getPresignedReadUrl(objectKey);

    return {
      objectKey,
      uploadUrl,
      publicOrReadUrl,
      expiresInSeconds,
      storageMode: 'S3_COMPATIBLE',
    };
  }

  public async getPresignedReadUrl(
    objectKey: string,
    expiresInSeconds = 3600
  ): Promise<string> {
    if (!this.s3Client) {
      return `http://localhost:${env.PORT}/api/v1/storage/local-dev/file?key=${encodeURIComponent(objectKey)}`;
    }

    const getCommand = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: objectKey,
    });

    return getSignedUrl(this.s3Client, getCommand, {
      expiresIn: expiresInSeconds,
    });
  }
}

export const storageService = new StorageService();

