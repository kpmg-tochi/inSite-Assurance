import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import type {
  FieldAgentSessionProfile,
  ProjectGeofence,
  ReportingCadence,
} from '@insite/shared';
import { formatMobileErrorMessage } from '../utils/errorFormatter';

function extractLanHost(uriOrUrl?: string | null): string | null {
  if (!uriOrUrl) return null;
  const cleaned = uriOrUrl.replace(/^https?:\/\//i, '').split('/')[0];
  const host = cleaned.split(':')[0]?.trim();
  if (!host) return null;
  // Remote Expo tunnel hosts only forward port 8081, not port 4000
  if (
    host.endsWith('.exp.direct') ||
    host.endsWith('.ngrok.io') ||
    host.endsWith('.ngrok-free.app')
  ) {
    return null;
  }
  return host;
}

function resolveMobileApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }

  // In Expo Go / Dev Client, hostUri contains the dev machine's LAN IP (e.g. "192.168.1.15:8081")
  const expoHostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ??
    (Constants as any).manifest?.debuggerHost ??
    null;

  const hostFromExpo = extractLanHost(expoHostUri);
  const hostFromScript = extractLanHost(NativeModules?.SourceCode?.scriptURL);
  const resolvedHost = hostFromExpo || hostFromScript;

  if (
    resolvedHost &&
    resolvedHost !== 'localhost' &&
    resolvedHost !== '127.0.0.1'
  ) {
    return `http://${resolvedHost}:4000/api/v1`;
  }

  if (Platform.OS === 'android') {
    // Android Emulator alias for the host machine's localhost
    return 'http://10.0.2.2:4000/api/v1';
  }

  return 'http://localhost:4000/api/v1';
}

export const MOBILE_API_BASE_URL = resolveMobileApiBaseUrl();
export const API_BASE_URL = MOBILE_API_BASE_URL;

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
let cachedBaselinePack: MobileBaselinePack | null = null;

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

export const saveBaselinePack = (pack: MobileBaselinePack) => {
  cachedBaselinePack = pack;
};

export const getCachedBaselinePack = (): MobileBaselinePack | null =>
  cachedBaselinePack;

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  let response: Response;
  try {
    response = await fetch(`${MOBILE_API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
    });
  } catch (err) {
    throw new Error(formatMobileErrorMessage(err));
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    throw new Error(
      formatMobileErrorMessage(payload?.error?.message, response.status)
    );
  }

  return payload.data as T;
}
