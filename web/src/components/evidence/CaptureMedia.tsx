import React, { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { formatHeading } from "@insite/shared";
import { getMediaUrl } from "../../api/evidence/mediaApi";
import { formatDateTimeShort } from "../../lib/formatters";

/**
 * Evidence media for human review. Files are private: each view asks the API for a signed URL
 * that expires after 5 minutes, after the API has checked the viewer's access to the project.
 */

function useSignedUrl(projectId: string, objectKey: string, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !objectKey) return;
    let alive = true;
    setError(null);
    getMediaUrl(projectId, objectKey)
      .then((u) => alive && setUrl(u))
      .catch((err) => alive && setError((err as { message?: string })?.message || "Could not load the file."));
    return () => {
      alive = false;
    };
  }, [projectId, objectKey, enabled]);
  return { url, error };
}

/** Where and when a photo was taken, as the capture DTOs carry it (all optional). */
export interface CapturePhotoMeta {
  capturedAt?: string | null;
  locationAvailable?: boolean;
  gpsAccuracyMeters?: number | null;
  headingDegrees?: number | null;
}

/** "25 Nov, 09:14 · ±4.5 m GPS · Facing NE (47°)": the photo's time, GPS and compass heading. */
function capturePhotoDetails(meta: CapturePhotoMeta): string {
  const parts: string[] = [];
  if (meta.capturedAt) parts.push(formatDateTimeShort(meta.capturedAt));
  if (meta.locationAvailable === false) parts.push("No GPS fix");
  else if (meta.gpsAccuracyMeters != null) parts.push(`±${meta.gpsAccuracyMeters.toFixed(1)} m GPS`);
  parts.push(formatHeading(meta.headingDegrees));
  return parts.join(" · ");
}

/**
 * A photo thumbnail; click opens the full image in a new tab. With `meta`, the time, GPS accuracy and
 * compass heading show on hover, and the heading under the thumbnail when it was recorded.
 */
export function CapturePhoto({
  projectId,
  objectKey,
  alt,
  className = "w-24 h-24",
  meta,
}: {
  projectId: string;
  objectKey: string;
  alt: string;
  className?: string;
  meta?: CapturePhotoMeta;
}) {
  const { url, error } = useSignedUrl(projectId, objectKey);
  const details = meta ? capturePhotoDetails(meta) : null;
  if (error) {
    return (
      <div className={`${className} rounded-lg border border-dashed border-rose-300 text-[10px] text-rose-700 flex items-center justify-center text-center p-1`}>
        {error}
      </div>
    );
  }
  if (!url) {
    return <div className={`${className} rounded-lg bg-slate-100 animate-pulse`} />;
  }
  const link = (
    <a href={url} target="_blank" rel="noopener noreferrer" title={details ? `${details}. Open full size` : "Open full size"}>
      <img src={url} alt={alt} className={`${className} rounded-lg object-cover border border-slate-200`} />
    </a>
  );
  if (meta?.headingDegrees == null) return link;
  return (
    <span className="inline-flex flex-col items-center">
      {link}
      <span className="text-[10px] text-slate-500 whitespace-nowrap">{formatHeading(meta.headingDegrees)}</span>
    </span>
  );
}

/** A voice note; the signed URL is fetched only when the reviewer asks to play it. */
export function CaptureAudio({ projectId, objectKey }: { projectId: string; objectKey: string }) {
  const [requested, setRequested] = useState(false);
  const { url, error } = useSignedUrl(projectId, objectKey, requested);
  if (url) return <audio controls src={url} className="w-full h-9" />;
  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => setRequested(true)}
        disabled={requested && !error}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-semibold text-slate-700 disabled:opacity-50"
      >
        <Volume2 className="w-3.5 h-3.5" />
        {requested && !error ? "Loading..." : "Play voice note"}
      </button>
      {error && <span className="text-[11px] text-rose-700">{error}</span>}
    </div>
  );
}
