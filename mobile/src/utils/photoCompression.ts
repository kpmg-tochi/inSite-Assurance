/**
 * Photo compression settings and size maths (UBEC IRL, 2026-11-25). Pure: no native modules, so it
 * runs in Node tests. The native step is `services/photoCompressor.ts`.
 *
 * Every photo from the in-app camera is resized so its long edge is at most 1600 px and re-encoded
 * as JPEG at quality 0.7 before it is stored for upload. At 1600 x 1200 a signboard that fills a
 * quarter of the frame width is ~400 px wide, enough to read its lettering; quality 0.7 keeps edges
 * of text clean while landing most site photos around 200-400 KB. A photo still above 500 KB (very
 * busy scenes: foliage, gravel, rebar) is encoded once more at 0.55. The hash, size and signature are
 * computed on the compressed file, which is the one uploaded.
 */

export interface PhotoCompressionSettings {
  /** Longest edge of the stored photo in pixels. */
  maxLongEdgePx: number;
  /** JPEG quality of the first encode (0..1). */
  jpegQuality: number;
  /** A first encode above this many bytes is encoded again at `retryJpegQuality`. */
  retryAboveBytes: number;
  retryJpegQuality: number;
  /**
   * The camera frame is decoded at most this size (memory bound on low-end phones); the exact resize
   * to `maxLongEdgePx` follows. Twice the target keeps the downscale sharp.
   */
  decodeBoundPx: number;
}

export const PHOTO_COMPRESSION: PhotoCompressionSettings = {
  maxLongEdgePx: 1600,
  jpegQuality: 0.7,
  retryAboveBytes: 500 * 1024,
  retryJpegQuality: 0.55,
  decodeBoundPx: 3200,
};

/**
 * Target size for an image of `width` x `height`, or null when it already fits (never enlarged).
 * Aspect ratio is kept; the long edge becomes exactly `maxLongEdgePx`.
 */
export function planPhotoResize(
  width: number,
  height: number,
  maxLongEdgePx: number = PHOTO_COMPRESSION.maxLongEdgePx
): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0) || !(maxLongEdgePx > 0)) return null;
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdgePx) return null;
  const scale = maxLongEdgePx / longEdge;
  if (width >= height) return { width: maxLongEdgePx, height: Math.max(1, Math.round(height * scale)) };
  return { width: Math.max(1, Math.round(width * scale)), height: maxLongEdgePx };
}

/** True when a first encode came out too large and should be encoded again at the retry quality. */
export function shouldRecompress(
  byteSize: number,
  qualityUsed: number,
  settings: PhotoCompressionSettings = PHOTO_COMPRESSION
): boolean {
  return byteSize > settings.retryAboveBytes && qualityUsed > settings.retryJpegQuality;
}

/**
 * Rough expected JPEG size in bytes for planning (storage sizing, not a promise): typical phone site
 * photos at quality ~0.7 need about 1.0-1.6 bits per pixel; `bitsPerPixel` defaults to the midpoint.
 */
export function estimateJpegBytes(width: number, height: number, bitsPerPixel = 1.3): number {
  if (!(width > 0) || !(height > 0)) return 0;
  return Math.round((width * height * bitsPerPixel) / 8);
}
