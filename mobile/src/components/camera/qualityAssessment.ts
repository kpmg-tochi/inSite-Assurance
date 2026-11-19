import type { DeviceOrientation, ImageQualityAssessment } from './types';

/**
 * Lightweight MVP image quality assessment & pluggable placeholder.
 *
 * Checks minimum resolution and JPEG payload size (tiny payloads typically
 * indicate a covered lens, severe underexposure, or an empty frame).
 * Native ML/Laplacian variance scoring can replace this implementation
 * later without changing the CameraCaptureResult contract.
 */
export function assessCapturedImageQuality(params: {
  width: number;
  height: number;
  /** File size in bytes (0 if unknown). */
  byteSize: number;
  expectedOrientation?: DeviceOrientation;
}): ImageQualityAssessment {
  const warnings: string[] = [];
  const minDimension = Math.min(params.width || 0, params.height || 0);
  const resolutionOk = minDimension >= 480;

  if (!resolutionOk && params.width > 0 && params.height > 0) {
    warnings.push('Image resolution is below 480px on the shortest edge.');
  }

  const estimatedBytes = params.byteSize;

  // Very small JPEG (< 12 KB) often indicates an obstructed or pitch-black frame
  let sharpnessProxyScore = 0.88;
  if (estimatedBytes > 0 && estimatedBytes < 12_000) {
    sharpnessProxyScore = 0.42;
    warnings.push('Frame appears unusually dark or low-detail. Ensure good lighting.');
  } else if (estimatedBytes > 80_000) {
    sharpnessProxyScore = 0.94;
  }

  const passed = resolutionOk && sharpnessProxyScore >= 0.6;
  const score = Number(
    ((resolutionOk ? 0.5 : 0.2) + sharpnessProxyScore * 0.5).toFixed(2)
  );

  return {
    passed,
    score,
    resolutionOk,
    sharpnessProxyScore,
    warnings,
    isPlaceholderAssessment: true,
  };
}

