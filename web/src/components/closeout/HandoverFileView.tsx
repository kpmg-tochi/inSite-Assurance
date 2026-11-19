import React, { useState } from "react";
import { FileText, Film, Volume2 } from "lucide-react";
import type { HandoverFileDto } from "@insite/shared";
import { getMediaUrl } from "../../api/reconciliation/reconciliationApi";
import { CapturePhoto } from "../evidence/CaptureMedia";

/**
 * A stakeholder upload, for reviewers. Images show as thumbnails; audio and video load only when
 * asked; documents open as a download (the API serves them with Content-Disposition: attachment).
 */
export function HandoverFileView({ projectId, file }: { projectId: string; file: HandoverFileDto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (file.kind === "IMAGE") {
    return <CapturePhoto projectId={projectId} objectKey={file.objectKey} alt={file.fileName} className="w-20 h-20" />;
  }

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const signed = await getMediaUrl(projectId, file.objectKey);
      if (file.kind === "DOCUMENT") window.open(signed, "_blank", "noopener,noreferrer");
      else setUrl(signed);
    } catch (err) {
      setError((err as { message?: string })?.message || "Could not load the file.");
    } finally {
      setLoading(false);
    }
  };

  if (url && file.kind === "AUDIO") return <audio controls src={url} className="h-9 max-w-[260px]" />;
  if (url && file.kind === "VIDEO") return <video controls src={url} className="max-h-48 max-w-[320px] rounded-lg border border-slate-200" />;

  const Icon = file.kind === "DOCUMENT" ? FileText : file.kind === "AUDIO" ? Volume2 : Film;
  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        title={file.kind === "DOCUMENT" ? "Download" : "Play"}
      >
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        <span className="max-w-[180px] truncate">{file.fileName}</span>
        <span className="text-slate-400">{Math.max(1, Math.round(file.byteSize / 1024))} KB</span>
      </button>
      {error && <span className="text-[10px] text-rose-700">{error}</span>}
    </div>
  );
}
