import type {
  FieldAgentSessionProfile,
  ProjectGeofence,
  ReportingCadence,
} from '@insite/shared';

export const MOBILE_API_BASE_URL = 'http://localhost:4000/api/v1';

export interface MobileBaselinePack {
  projectId: string;
  name: string;
  codePrefix: string;
  stateLocation: string;
  reportingCadence: ReportingCadence;
  geofenceMode: 'RADIAL' | 'LINEAR_CORRIDOR';
  geofence: ProjectGeofence;
  boqItems: Array<{
    id: string;
    wbsCode: string;
    section: string;
    description: string;
    unit: string;
    totalQuantity: number;
    budgetedCostNgn: number;
    isHoldPoint: boolean;
    holdPointInstruction: string | null;
    cumulativeCertifiedPct: number;
  }>;
  holdPoints: Array<{
    id: string;
    wbsCode: string;
    section: string;
    description: string;
    unit: string;
    totalQuantity: number;
    budgetedCostNgn: number;
    isHoldPoint: boolean;
    holdPointInstruction: string | null;
    cumulativeCertifiedPct: number;
  }>;
}

let fieldAgentToken: string | null = null;
let activeSessionProfile: FieldAgentSessionProfile | null = null;

export const setFieldAgentAuth = (
  token: string | null,
  profile: FieldAgentSessionProfile | null
) => {
  fieldAgentToken = token;
  activeSessionProfile = profile;
};

export const getFieldAgentToken = (): string | null => fieldAgentToken;
export const getActiveSessionProfile = (): FieldAgentSessionProfile | null =>
  activeSessionProfile;

export async function mobileRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (fieldAgentToken) {
    headers.Authorization = `Bearer ${fieldAgentToken}`;
  }

  const response = await fetch(`${MOBILE_API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    throw new Error(
      payload?.error?.message || `Mobile API error (${response.status})`
    );
  }

  return payload.data as T;
}

