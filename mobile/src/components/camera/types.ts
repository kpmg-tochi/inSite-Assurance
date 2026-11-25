import type { ReactNode } from 'react';
import type { CameraType } from 'expo-camera';
import type { HeadingReading } from '@insite/shared';

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

/**
 * A photo on disk. Never base64: the file is moved into app storage and uploaded from disk.
 * UBEC IRL: `uri`, `byteSize`, `width` and `height` describe the compressed file (long edge 1600 px,
 * JPEG 0.7; utils/photoCompression.ts), which is the one hashed, signed and uploaded.
 */
export interface CameraCaptureResult {
  uri: string;
  byteSize: number;
  width: number;
  height: number;
  orientation: DeviceOrientation;
  facing: CameraType;
  capturedAt: string;
  gps?: CameraGpsMetadata;
  /** Compass heading at the shutter (geotagged captures only); null when there was no usable reading. */
  heading?: HeadingReading | null;
  /** false when compression failed and the camera's original file was kept. */
  compressed?: boolean;
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
  /** JPEG quality 0..1 of the camera's own full-size frame (default: 0.82), before the upload compression. */
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

