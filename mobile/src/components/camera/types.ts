import type { ReactNode } from 'react';
import type { CameraType } from 'expo-camera';

export type CameraCaptureType = 'shutter' | 'live';

/**
 * Flash / torch setting cycled by the camera control bar:
 * - 'off': flash and torch disabled
 * - 'on': capture-only flash fires when taking a picture
 * - 'torch': continuous torch light stays on during preview
 */
export type CameraFlashSetting = 'off' | 'on' | 'torch';

export type DeviceOrientation = 'portrait' | 'landscape';

export interface CameraGpsMetadata {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  isMocked: boolean;
  capturedAt: string;
}

export interface ImageQualityAssessment {
  passed: boolean;
  score: number; // 0 to 1
  resolutionOk: boolean;
  sharpnessProxyScore: number; // 0 to 1 (MVP heuristic; replaceable by native CV)
  warnings: string[];
  isPlaceholderAssessment: boolean;
}

export interface CameraCaptureResult {
  uri: string;
  base64: string | null;
  dataUri: string;
  width: number;
  height: number;
  orientation: DeviceOrientation;
  facing: CameraType;
  capturedAt: string;
  gps?: CameraGpsMetadata;
  qualityAssessment: ImageQualityAssessment;
}

export interface InSiteCameraHandle {
  /** Programmatically trigger a capture (used in 'live' mode by liveness/CV overlays). */
  takePicture: () => Promise<CameraCaptureResult | null>;
  isCameraReady: () => boolean;
}

export interface InSiteCameraProps {
  /** 'shutter' shows manual capture button; 'live' hides shutter for auto-capture overlays. */
  captureType: CameraCaptureType;
  /** Whether to capture GPS coordinates on capture. */
  geoTag?: boolean;
  /** Invoked when an image has been captured and formatted for upload. */
  onCapture: (result: CameraCaptureResult) => void;
  /** Invoked if the user closes the camera before capturing. */
  onCancel?: () => void;
  /** Initial lens facing ('back' for site/ID, 'front' for selfie). */
  initialFacing?: CameraType;
  /** Allow toggling between front and back cameras (default: true). */
  allowFlipCamera?: boolean;
  /** Allow toggling flash/torch (default: true). */
  allowFlashToggle?: boolean;
  /** JPEG compression quality 0..1 (default: 0.82). */
  jpegQuality?: number;
  /** Optional header title shown in the top camera bar. */
  title?: string;
  /** Optional subtitle shown below the title. */
  subtitle?: string;
  /** Notifies parent when native CameraView is ready for capture. */
  onCameraReadyChange?: (ready: boolean) => void;
  /** Notifies parent when viewport orientation changes. */
  onOrientationChange?: (orientation: DeviceOrientation) => void;
  /** Overlay rendered on top of the live CameraView. */
  children?: ReactNode;
}

