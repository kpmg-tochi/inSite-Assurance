import { api } from "../../config/apiConfig";
import type { ApiEnvelope, AuditTrailResponseDto } from "../types";

export const getProjectAuditTrail = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<AuditTrailResponseDto>>(
    `/projects/${projectId}/audit-trail`,
  );
  return data.data;
};

/** Tenant-scope chain: role, user, branding and sign-in lockout events. */
export const getTenantAuditTrail = async () => {
  const { data } = await api.get<ApiEnvelope<AuditTrailResponseDto>>(
    `/rbac/audit-trail`,
  );
  return data.data;
};
