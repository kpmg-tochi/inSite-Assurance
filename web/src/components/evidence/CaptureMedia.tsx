import React, { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { getMediaUrl } from "../../api/reconciliation/reconciliationApi";

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

/** A photo thumbnail; click opens the full image in a new tab. */
export function CapturePhoto({
  projectId,
  objectKey,
  alt,
  className = "w-24 h-24",
}: {
  projectId: string;
  objectKey: string;
  alt: string;
  className?: string;
}) {
  const { url, error } = useSignedUrl(projectId, objectKey);
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
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Open full size">
      <img src={url} alt={alt} className={`${className} rounded-lg object-cover border border-slate-200`} />
    </a>
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
