import type { ProjectSummaryDto } from '@insite/shared';

/** Redesign R6c (D-R6.22): the project summary DTO is the shared `ProjectSummaryDtoSchema`. */
export type { ProjectSummaryDto };

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** Server contract for GET /projects/:projectId/evidence (Phase 4). */
export type { CaptureListItemDto } from "@insite/shared";

export interface AuditTrailResponseDto {
  tenantId?: string;
  projectId: string | null;
  chainIntegrityVerified: boolean;
  totalEntries: number;
  brokenAtEntryId: string | null;
  latestHash: string | null;
  entries: Array<{
    id: string;
    tenantId: string;
    projectId: string | null;
    seq: number;
    actorType: string;
    actorId: string;
    actorDisplayName: string;
    action: string;
    summaryText: string;
    payload: Record<string, unknown>;
    previousHash: string;
    entryHash: string;
    createdAt: string;
  }>;
}

export type {
  PermissionDto,
  RoleDto,
  TenantDto,
  TenantUserDto,
  FieldSessionRosterDto,
} from '@insite/shared';
