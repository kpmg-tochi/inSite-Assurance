import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { PHOTO_COMPRESSION, planPhotoResize, shouldRecompress, type PhotoCompressionSettings } from '../utils/photoCompression';

/**
 * Compresses one camera photo before it is stored for upload (UBEC IRL, 2026-11-25; settings and
 * reasoning in utils/photoCompression.ts). The camera frame is decoded at most `decodeBoundPx`
 * (memory), resized so its long edge is `maxLongEdgePx`, and saved as JPEG; a result above
 * `retryAboveBytes` is saved again at the lower quality. Orientation is baked into the pixels, so the
 * EXIF block of the camera file (including any EXIF GPS) is not carried over; nothing reads it: GPS
 * comes from the location service and the server orients by pixels when it has no EXIF.
 *
 * If compression fails the original file is kept (`compressed: false`): a large photo is better than
 * a lost one, and the server's upload limits still apply.
 */
export interface CompressedPhoto {
  uri: string;
  width: number;
  height: number;
  byteSize: number;
  compressed: boolean;
  quality: number | null;
}

function sizeOf(uri: string): number {
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

function release(ref: { release?: () => void } | null | undefined) {
  try {
    ref?.release?.();
  } catch {
    // already released
  }
}

export async function compressPhoto(
  source: { uri: string; width: number; height: number },
  settings: PhotoCompressionSettings = PHOTO_COMPRESSION
): Promise<CompressedPhoto> {
  const original: CompressedPhoto = {
    uri: source.uri,
    width: source.width,
    height: source.height,
    byteSize: sizeOf(source.uri),
    compressed: false,
    quality: null,
  };
  const refs: Array<{ release?: () => void }> = [];
  try {
    const loadContext = ImageManipulator.manipulate(source.uri, { maxWidth: settings.decodeBoundPx, maxHeight: settings.decodeBoundPx });
    refs.push(loadContext);
    let image: ImageRef = await loadContext.renderAsync();
    refs.push(image);
    const target = planPhotoResize(image.width, image.height, settings.maxLongEdgePx);
    if (target) {
      const resizeContext = ImageManipulator.manipulate(image).resize(target);
      refs.push(resizeContext);
      image = await resizeContext.renderAsync();
      refs.push(image);
    }
    let quality = settings.jpegQuality;
    let saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
    let byteSize = sizeOf(saved.uri);
    if (shouldRecompress(byteSize, quality, settings)) {
      const first = saved.uri;
      quality = settings.retryJpegQuality;
      saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
      byteSize = sizeOf(saved.uri);
      deleteQuietly(first);
    }
    if (!byteSize) return original;
    deleteQuietly(source.uri);
    return { uri: saved.uri, width: saved.width, height: saved.height, byteSize, compressed: true, quality };
  } catch (err) {
    console.warn('[camera] photo compression failed; keeping the original', err);
    return original;
  } finally {
    refs.forEach(release);
  }
}

function deleteQuietly(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // the cache is cleared by the OS anyway
  }
}
