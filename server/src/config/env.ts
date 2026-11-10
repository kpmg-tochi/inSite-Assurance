import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z
    .string()
    .default(
      'postgresql://postgres:postgres@localhost:5432/insite_assurance?schema=public'
    ),

  JWT_SECRET: z
    .string()
    .min(16)
    .default('insite-assurance-dev-jwt-secret-change-in-production-2026'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  AZURE_OPENAI_ENDPOINT: z.string().optional().default(''),
  AZURE_OPENAI_API_KEY: z.string().optional().default(''),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),
  AZURE_OPENAI_GPT_DEPLOYMENT: z.string().default('gpt-4o'),
  AZURE_OPENAI_WHISPER_DEPLOYMENT: z.string().default('whisper'),

  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET_NAME: z.string().default('insite-assurance-evidence'),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_PUBLIC_BASE_URL: z.string().optional().default(''),
});

export const env = EnvSchema.parse(process.env);

