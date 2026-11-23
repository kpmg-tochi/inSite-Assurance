import { z } from "zod";
import { AuditActionTypeEnum, AuditActorTypeEnum } from "../enums";

/** One entry of the immutable, hash-chained audit ledger. */
export const AuditLogEntryDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  seq: z.number().int().positive(),
  actorType: AuditActorTypeEnum,
  actorId: z.string(),
  actorDisplayName: z.string(),
  action: AuditActionTypeEnum,
  summaryText: z.string(),
  payload: z.record(z.unknown()),
  previousHash: z.string(),
  entryHash: z.string(),
  createdAt: z.string().datetime(),
});
export type AuditLogEntryDto = z.infer<typeof AuditLogEntryDtoSchema>;
