import { z } from 'zod';
import {
  EvidenceLogStatusEnum,
  IndependenceTierEnum,
  MediaTypeEnum,
} from '../enums';
import { GeofenceVerificationResultSchema } from './geofence.schema';

/**
 * Extracted Material / Work Quantity Item (Section 4.B Mandatory Confirmation Bubble)
 * e.g., { materialOrWork: "bags of cement", quantity: 40, unit: "bags", isWorkProgress: false }
 */
export const ExtractedQuantityItemSchema = z.object({
  materialOrWork: z.string().min(1).max(160), // e.g., "Drainage culvert cast", "Cement used"
  quantity: z.number().nonnegative(),
  unit: z.string().min(1).max(32),            // e.g., "m", "bags", "trips", "m3", "tons"
  boqWbsCodeHint: z.string().nullable().optional(),
});
export type ExtractedQuantityItem = z.infer<typeof ExtractedQuantityItemSchema>;

/**
 * Azure OpenAI (Whisper + GPT-4o) Field Voice/Text Extraction Schema
 * Used directly with Structured Outputs to populate the Mobile Mandatory Confirmation Bubble.
 */
export const AiFieldNoteExtractionSchema = z.object({
  normalizedSummary: z.string(), // e.g., "Cast 12m of drainage culvert. 40 bags of cement used. Blocker: Granite delivery delayed."
  extractedQuantities: z.array(ExtractedQuantityItemSchema),
  siteBlockers: z.array(z.string()),
  matchedBoqWbsCodes: z.array(z.string()),
  visionObservationSummary: z.string().nullable(),
});
export type AiFieldNoteExtraction = z.infer<typeof AiFieldNoteExtractionSchema>;

/**
 * Hardware Capture Provenance & Sensor Metadata (Section 4.B & Section 7.4)
 */
export const CaptureHardwareMetadataSchema = z.object({
  clientCaptureId: z.string().uuid(), // Deterministic offline outbox UUID
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitudeMeters: z.number().nullable().optional(),
  gpsAccuracyMeters: z.number().nonnegative(),
  isMockLocation: z.boolean().default(false),
  devicePitchDeg: z.number().nullable().optional(),
  deviceRollDeg: z.number().nullable().optional(),
  deviceAzimuthDeg: z.number().nullable().optional(),
  capturedAtDevice: z.string().datetime(),
  deviceSignatureHash: z.string().min(16).max(256), // SHA-256 of (clientCaptureId + coords + timestamp + mediaHashes)
});
export type CaptureHardwareMetadata = z.infer<typeof CaptureHardwareMetadataSchema>;

/**
 * Media Attachment Item in a Field Capture Bundle
 */
export const EvidenceMediaAttachmentInputSchema = z.object({
  mediaType: MediaTypeEnum,
  objectKey: z.string().min(3),
  publicOrSignedUrl: z.string().url().optional(),
  mimeType: z.string().min(3),
  byteSize: z.number().int().positive(),
  sha256FileHash: z.string().min(16).max(128),
  durationSeconds: z.number().nonnegative().nullable().optional(),
});
export type EvidenceMediaAttachmentInput = z.infer<
  typeof EvidenceMediaAttachmentInputSchema
>;

/**
 * Step 1 (Online Sync): Submit synced media + hardware metadata for AI Extraction & Integrity Verification
 */
export const SubmitEvidenceForExtractionRequestSchema = z.object({
  boqItemId: z.string().uuid().nullable().optional(),
  rawTextNote: z.string().max(2000).nullable().optional(),
  offlineManualQuantities: z.array(ExtractedQuantityItemSchema).default([]),
  hardwareMetadata: CaptureHardwareMetadataSchema,
  mediaAttachments: z.array(EvidenceMediaAttachmentInputSchema).min(1),
});
export type SubmitEvidenceForExtractionRequest = z.infer<
  typeof SubmitEvidenceForExtractionRequestSchema
>;

/**
 * Step 2: Mandatory Human Confirmation Bubble Payload returned to the Mobile App
 */
export const EvidenceConfirmationDraftResponseSchema = z.object({
  evidenceLogId: z.string().uuid(),
  clientCaptureId: z.string().uuid(),
  status: EvidenceLogStatusEnum,
  independenceTier: IndependenceTierEnum,
  geofenceVerification: GeofenceVerificationResultSchema,
  integrityPassed: z.boolean(),
  integrityFlags: z.array(z.string()), // e.g., ["DUPLICATE_PHOTO_PHASH", "MOCK_GPS_DETECTED"]
  rawWhisperTranscript: z.string().nullable(),
  proposedExtraction: AiFieldNoteExtractionSchema,
  capturedAtDevice: z.string().datetime(),
});
export type EvidenceConfirmationDraftResponse = z.infer<
  typeof EvidenceConfirmationDraftResponseSchema
>;

/**
 * Step 3: Field Agent taps [✅ Confirm & Sign Log] or [✏️ Edit Quantities]
 */
export const ConfirmEvidenceLogRequestSchema = z.object({
  confirmedBoqItemId: z.string().uuid().nullable().optional(),
  confirmedSummary: z.string().min(2).max(2000),
  confirmedQuantities: z.array(ExtractedQuantityItemSchema),
  confirmedSiteBlockers: z.array(z.string()).default([]),
  wasEditedByAgent: z.boolean().default(false),
  confirmationSignatureHash: z.string().min(8).max(256),
});
export type ConfirmEvidenceLogRequest = z.infer<
  typeof ConfirmEvidenceLogRequestSchema
>;

