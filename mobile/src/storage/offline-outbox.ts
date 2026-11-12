import * as Crypto from 'expo-crypto';
import type { MobileBaselinePack } from '../config/apiConfig';
import type { IndependenceTier, MediaType } from '@insite/shared';

export type CaptureQueueStatus =
  | 'LOCAL_CAPTURED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'SYNCED';

export interface LocalCapturedItem {
  id: string;
  projectId: string;
  boqItemId?: string;
  wbsCode?: string;
  isHoldPoint?: boolean;
  capturedAtDevice: string;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  chainageKm?: number;
  chainageLabel?: string;
  offsetFromCenterlineMeters?: number;
  isWithinGeofence: boolean;
  mediaType: MediaType;
  localMediaUri?: string;
  localAudioUri?: string;
  deviceSignatureHash: string;
  rawTextNote?: string;
  rawWhisperTranscript?: string;
  confirmedSummary?: string;
  extractedQuantities?: Array<{
    wbsCode: string;
    description: string;
    quantity: number;
    unit: string;
    confidence: number;
  }>;
  status: CaptureQueueStatus;
  syncedServerLogId?: string;
  error?: string;
}

// In-memory / resilient persistent cache fallback for Expo Snack / Web / Native
let cachedBaselinePack: MobileBaselinePack | null = null;
let localQueue: LocalCapturedItem[] = [];

export const saveBaselinePack = (pack: MobileBaselinePack) => {
  cachedBaselinePack = pack;
};

export const getCachedBaselinePack = (): MobileBaselinePack | null => {
  return cachedBaselinePack;
};

export const enqueueLocalCapture = async (
  item: Omit<LocalCapturedItem, 'id' | 'deviceSignatureHash' | 'status'>
): Promise<LocalCapturedItem> => {
  const id = `cap-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const payloadToHash = `${id}:${item.projectId}:${item.capturedAtDevice}:${item.latitude}:${item.longitude}`;
  const deviceSignatureHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payloadToHash
  );

  const captured: LocalCapturedItem = {
    ...item,
    id,
    deviceSignatureHash,
    status: 'LOCAL_CAPTURED',
  };

  localQueue = [captured, ...localQueue];
  return captured;
};

export const updateQueueItem = (
  id: string,
  updates: Partial<LocalCapturedItem>
): LocalCapturedItem | null => {
  let updatedItem: LocalCapturedItem | null = null;
  localQueue = localQueue.map((item) => {
    if (item.id === id) {
      updatedItem = { ...item, ...updates };
      return updatedItem;
    }
    return item;
  });
  return updatedItem;
};

export const getLocalQueue = (): LocalCapturedItem[] => {
  return [...localQueue];
};

export const getPendingSyncCount = (): number => {
  return localQueue.filter((item) => item.status !== 'SYNCED').length;
};

