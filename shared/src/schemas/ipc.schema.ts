import { z } from 'zod';
import { MediaTypeEnum, QueryStatusEnum } from '../enums';

/**
 * Supporting Document Attachment for an IPC Claim (Waybills, Mill Certs, Cube Tests)
 */
export const IpcSupportingDocumentInputSchema = z.object({
  title: z.string().min(2).max(160), // e.g., "28-Day Concrete Cube Crushing Test Report - Culvert Ch 14+200"
  mediaType: MediaTypeEnum,
  objectKey: z.string().min(3),
  fileUrl: z.string().url().optional(),
  boqItemId: z.string().uuid().nullable().optional(),
});
export type IpcSupportingDocumentInput = z.infer<
  typeof IpcSupportingDocumentInputSchema
>;

/**
 * Contractor Line-Item Progress Claim inside an Interim Payment Certificate (IPC)
 */
export const IpcLineItemClaimInputSchema = z.object({
  boqItemId: z.string().uuid(),
  claimedCumulativePct: z.number().min(0).max(100),
  claimedQuantityToDate: z.number().nonnegative().optional(),
  contractorRemarks: z.string().max(600).optional(),
});
export type IpcLineItemClaimInput = z.infer<typeof IpcLineItemClaimInputSchema>;

/**
 * Contractor IPC Drawdown Submission Request (Section 4.A Role 3)
 */
export const SubmitIpcClaimRequestSchema = z.object({
  trancheId: z.string().uuid(),
  ipcNumber: z.number().int().min(1), // e.g., IPC #1, IPC #2
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  contractorCoverNote: z.string().max(1500).optional(),
  lineItems: z.array(IpcLineItemClaimInputSchema).min(1),
  supportingDocuments: z.array(IpcSupportingDocumentInputSchema).default([]),
});
export type SubmitIpcClaimRequest = z.infer<typeof SubmitIpcClaimRequestSchema>;

/**
 * Monitor Line-Item Query & Contractor Clarification Response (Section 4.A Role 1 & Role 3)
 */
export const CreateMonitorQueryRequestSchema = z.object({
  ipcLineItemId: z.string().uuid(),
  queryReason: z.string().min(5).max(1000), // e.g., "Claimed 80% on box culvert but Hold-Point pre-pour reinforcement photo is missing."
  requestedProofTypes: z.array(MediaTypeEnum).default([]),
});
export type CreateMonitorQueryRequest = z.infer<
  typeof CreateMonitorQueryRequestSchema
>;

export const RespondMonitorQueryRequestSchema = z.object({
  contractorResponseText: z.string().min(4).max(1500),
  revisedClaimedCumulativePct: z.number().min(0).max(100).optional(),
  attachedDocuments: z.array(IpcSupportingDocumentInputSchema).default([]),
});
export type RespondMonitorQueryRequest = z.infer<
  typeof RespondMonitorQueryRequestSchema
>;

export const MonitorQueryDtoSchema = z.object({
  id: z.string().uuid(),
  ipcLineItemId: z.string().uuid(),
  boqWbsCode: z.string(),
  boqDescription: z.string(),
  status: QueryStatusEnum,
  queryReason: z.string(),
  contractorResponseText: z.string().nullable(),
  createdAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable(),
});
export type MonitorQueryDto = z.infer<typeof MonitorQueryDtoSchema>;

