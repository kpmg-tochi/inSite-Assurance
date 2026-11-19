import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load server/.env reliably whether executed from monorepo root or server/ directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const booleanEnvSchema = (defaultVal: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return defaultVal;
      if (typeof val === 'boolean') return val;
      return ['true', '1', 'yes', 'on'].includes(val.trim().toLowerCase());
    });

const DEFAULT_DEV_JWT_SECRET = 'insite-assurance-dev-jwt-secret-change-in-production-2026';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DEMO_MODE: booleanEnvSchema(false),
  ENABLE_DEMO_ENDPOINTS: booleanEnvSchema(false),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z
    .string()
    .default(
      'postgresql://postgres:postgres@localhost:5432/insite_assurance?schema=public'
    ),

  JWT_SECRET: z
    .string()
    .min(16)
    .default(DEFAULT_DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Company Azure OpenAI Sandbox (gpt-4.1 for Reasoning, Vision, Extraction & Reconciliation)
  AZURE_OPENAI_ENDPOINT: z.string().optional().default(''),
  AZURE_OPENAI_API_KEY: z.string().optional().default(''),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),
  AZURE_OPENAI_GPT_DEPLOYMENT: z.string().default('gpt-4.1'),
  AzureOpenAI__MaxTokensPerRequest: z.coerce.number().default(12000),
  AzureOpenAI__MaxOutputTokens: z.coerce.number().default(6000),
  AzureOpenAI__MaxRetries: z.coerce.number().default(2),
  AzureOpenAI__TimeoutSeconds: z.coerce.number().default(180),

  // Standalone Whisper Speech-to-Text Integration (Personal OpenAI API account)
  WHISPER_API_KEY: z.string().optional().default(''),
  WHISPER_BASE_URL: z.string().optional().default(''),
  WHISPER_MODEL: z.string().default('whisper-1'),

  // S3-Compatible Object Storage (Cloudflare R2 or AWS S3)
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET_NAME: z.string().default('insite-assurance-evidence'),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_PUBLIC_BASE_URL: z.string().optional().default(''),

  // Without S3, uploads go to this folder through signed local URLs (development only).
  LOCAL_STORAGE_DIR: z.string().optional().default(''),
  // Base URL devices use to reach this API (local storage URLs). A phone cannot reach "localhost".
  PUBLIC_API_BASE_URL: z.string().optional().default(''),

  // Expo push delivery. "none" records notifications without sending a push.
  PUSH_PROVIDER: z.enum(['expo', 'none']).optional(),
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),

  // Background sweep for omission checks that were not processed after submission.
  AI_CHECK_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),

  // Phase 8: scheduled jobs. Set false on API instances when a worker process owns the jobs.
  JOBS_ENABLED: booleanEnvSchema(true),
  // Phase 8 outbound messages (D-8.1 default: email). console = log only (development).
  MESSAGING_EMAIL_PROVIDER: z.enum(['console', 'resend', 'none']).optional(),
  MESSAGING_EMAIL_FROM: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  MESSAGING_TENANT_DAILY_CAP: z.coerce.number().int().min(0).default(500),
  MESSAGING_RECIPIENT_DAILY_CAP: z.coerce.number().int().min(0).default(5),
  // Phase 10: base URL of the web portal, used for stakeholder handover links.
  WEB_APP_BASE_URL: z.string().optional().default(''),
});

const parsedEnv = EnvSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  DEMO_MODE: parsedEnv.DEMO_MODE || parsedEnv.ENABLE_DEMO_ENDPOINTS,
  LOCAL_STORAGE_DIR:
    parsedEnv.LOCAL_STORAGE_DIR || path.resolve(__dirname, '../../.local-storage'),
  PUBLIC_API_BASE_URL: (parsedEnv.PUBLIC_API_BASE_URL || `http://localhost:${parsedEnv.PORT}`).replace(/\/+$/, ''),
  PUSH_PROVIDER: parsedEnv.PUSH_PROVIDER ?? (parsedEnv.NODE_ENV === 'test' ? 'none' : 'expo'),
  MESSAGING_EMAIL_PROVIDER:
    parsedEnv.MESSAGING_EMAIL_PROVIDER ?? (parsedEnv.NODE_ENV === 'production' ? 'none' : 'console'),
  WEB_APP_BASE_URL: (parsedEnv.WEB_APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, ''),
};

/**
 * Production safety checks. Returns the list of problems; the server refuses to start if any.
 * Exported for tests.
 */
export function findUnsafeProductionConfig(config: typeof env): string[] {
  if (config.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (config.JWT_SECRET === DEFAULT_DEV_JWT_SECRET || config.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be set to a unique value of at least 32 characters');
  }
  if (config.CORS_ORIGIN.trim() === '*' || config.CORS_ORIGIN.trim() === '') {
    problems.push('CORS_ORIGIN must list the allowed web origins explicitly');
  }
  if (config.DEMO_MODE) {
    problems.push('DEMO_MODE / ENABLE_DEMO_ENDPOINTS must be off in production');
  }
  if (!config.S3_ENDPOINT || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    problems.push('S3 storage must be configured in production (local disk storage is development only)');
  }
  if (!/^https:\/\//.test(config.WEB_APP_BASE_URL)) {
    problems.push('WEB_APP_BASE_URL must be the https address of the web portal (stakeholder handover links)');
  }
  return problems;
}

const unsafeConfig = findUnsafeProductionConfig(env);
if (unsafeConfig.length > 0) {
  throw new Error(
    `Refusing to start with unsafe production configuration:\n- ${unsafeConfig.join('\n- ')}`
  );
}
