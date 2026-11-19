import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Paperclip, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  HANDOVER_ACCEPT_ATTRIBUTE,
  HANDOVER_LIMITS,
  HANDOVER_MULTIPART_THRESHOLD_BYTES,
  HANDOVER_PART_BYTES,
  handoverPartSize,
  HANDOVER_UPLOAD_POLICY,
  handoverUploadKind,
  type HandoverDecision,
  type HandoverSubmittedDto,
  type PublicHandoverInfoDto,
} from "@insite/shared";
import {
  completeMultipartUpload,
  getPublicHandover,
  multipartStatus,
  putPartWithProgress,
  signUploadParts,
  startMultipartUpload,
  presignHandoverUpload,
  putWithProgress,
  requestHandoverCode,
  startHandoverSession,
  submitHandover,
  verifyHandoverCode,
  type PublicApiError,
} from "../../api/closeout/publicHandoverApi";

/**
 * Public stakeholder handover page (Phase 10 Step 4). Outside the portal: no navigation, no
 * portal sign-in, tenant colours. Mobile-first and plain language. A draft is kept on the device
 * until it is sent, so a refresh or a dropped connection loses nothing already typed or uploaded.
 */

interface UploadItem {
  localId: string;
  fileName: string;
  kind: string;
  objectKey: string | null;
  progress: number;
  /** paused: a resumable upload interrupted by a page reload; the file must be chosen again. */
  status: "uploading" | "done" | "failed" | "paused";
  error?: string;
  file?: File;
  byteSize?: number;
  lastModified?: number;
  /** Resumable uploads: the server's signed ticket for this upload (kept in the draft). */
  uploadTicket?: string;
}

interface SnagDraft {
  localId: string;
  title: string;
  location: string;
  description: string;
  photos: UploadItem[];
}

interface Draft {
  decision: HandoverDecision | null;
  submitterName: string;
  submitterRole: string;
  feedbackText: string;
  snags: SnagDraft[];
  attachments: UploadItem[];
}

const EMPTY_DRAFT: Draft = { decision: null, submitterName: "", submitterRole: "", feedbackText: "", snags: [], attachments: [] };

const DECISIONS: Array<{ value: HandoverDecision; title: string; help: string }> = [
  { value: "ACCEPTED", title: "I accept the works", help: "Everything is done as expected." },
  { value: "ACCEPTED_WITH_SNAGS", title: "I accept, but some things need fixing", help: "List each problem below, with a photo if you can." },
  { value: "REJECTED", title: "I do not accept the works", help: "Tell us why." },
];

const MB = 1024 * 1024;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function storageKey(token: string, kind: string) {
  return `handover:${kind}:${token.slice(0, 12)}`;
}

function readJson<T>(key: string, store: Storage): T | null {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, store: Storage) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the draft simply is not kept
  }
}

/**
 * Uploads that finished keep their key. A resumable upload still in flight is kept as "paused" (the
 * browser cannot keep the file itself): choosing the same file again continues where it stopped.
 * Small uploads still in flight are dropped.
 */
function persistable(d: Draft): Draft {
  const keep = (items: UploadItem[]) =>
    items
      .filter((i) => i.status === "done" || Boolean(i.uploadTicket))
      .map(({ file: _f, ...rest }) => (rest.status === "done" ? rest : { ...rest, status: "paused" as const, error: undefined }));
  return { ...d, attachments: keep(d.attachments), snags: d.snags.map((s) => ({ ...s, photos: keep(s.photos) })) };
}

export default function PublicHandoverPage() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<PublicHandoverInfoDto | null>(null);
  const [loadError, setLoadError] = useState<PublicApiError | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [done, setDone] = useState<HandoverSubmittedDto | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    getPublicHandover(token)
      .then(setInfo)
      .catch((err: PublicApiError) => setLoadError(err));
  }, [token]);

  useEffect(() => {
    load();
    const saved = readJson<{ token: string; expiresAt: string }>(storageKey(token, "session"), sessionStorage);
    if (saved && new Date(saved.expiresAt).getTime() > Date.now() + 60_000) setSession(saved.token);
  }, [load, token]);

  const color = info?.primaryColorHex ?? "#1d4ed8";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white" style={{ borderTop: `4px solid ${color}` }}>
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {info?.logoUrl ? <img src={info.logoUrl} alt="" className="h-8 w-auto" referrerPolicy="no-referrer" /> : null}
          <span className="text-sm font-bold">{info?.tenantName ?? "Project handover"}</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-5">
        {loadError ? (
          <Card>
            <h1 className="text-base font-bold">This link cannot be opened</h1>
            <p className="text-sm text-slate-600">
              {loadError.status === 404 || loadError.status === 423
                ? loadError.message
                : "We could not reach the server. Check your connection and try again."}
            </p>
            {loadError.status !== 404 && loadError.status !== 423 && <RetryButton onClick={load} />}
          </Card>
        ) : !info ? (
          <Card>
            <p className="text-sm text-slate-500">Loading…</p>
          </Card>
        ) : done ? (
          <Confirmation info={info} done={done} />
        ) : info.submissionsRemaining <= 0 ? (
          <Card>
            <h1 className="text-base font-bold">Thank you</h1>
            <p className="text-sm text-slate-600">A response has already been sent with this link. If you need to add something, ask the project team for a new link.</p>
          </Card>
        ) : (
          <>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Handover of completed works</p>
              <h1 className="text-lg font-bold">{info.projectName}</h1>
              {info.projectLocation && <p className="text-sm text-slate-500">{info.projectLocation}</p>}
              <p className="whitespace-pre-line text-sm text-slate-700">{info.handoverSummary}</p>
              <p className="text-xs text-slate-500">
                For {info.recipientName}. This link works until {new Date(info.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
              </p>
            </Card>
            {!session ? (
              <SessionStep
                token={token}
                info={info}
                color={color}
                onSession={(s) => {
                  writeJson(storageKey(token, "session"), { token: s.sessionToken, expiresAt: s.expiresAt }, sessionStorage);
                  setSession(s.sessionToken);
                }}
              />
            ) : (
              <ResponseForm
                token={token}
                session={session}
                color={color}
                onSessionEnded={() => {
                  try {
                    sessionStorage.removeItem(storageKey(token, "session"));
                  } catch {
                    // ignore
                  }
                  setSession(null);
                }}
                onDone={(d) => {
                  try {
                    localStorage.removeItem(storageKey(token, "draft"));
                  } catch {
                    // ignore
                  }
                  setDone(d);
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{children}</section>;
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
      <RefreshCw className="h-4 w-4" /> Try again
    </button>
  );
}

function PrimaryButton({ color, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { color: string }) {
  return (
    <button
      {...props}
      style={{ backgroundColor: color }}
      className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SessionStep({
  token,
  info,
  color,
  onSession,
}: {
  token: string;
  info: PublicHandoverInfoDto;
  color: string;
  onSession: (s: { sessionToken: string; expiresAt: string }) => void;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      onSession(await startHandoverSession(token));
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await requestHandoverCode(token);
      setSent(true);
      setMessage(r.sent ? `We sent a 6-digit code to ${r.destination}.` : "We could not send the code just now. Try again in a few minutes.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onSession(await verifyHandoverCode(token, code));
    } catch (err) {
      const e2 = err as PublicApiError;
      const left = e2.details?.attemptsRemaining;
      setMessage(typeof left === "number" ? `${e2.message} ${left} attempt(s) left.` : e2.message);
    } finally {
      setBusy(false);
    }
  };

  if (!info.requiresCode) {
    return (
      <Card>
        <PrimaryButton color={color} type="button" onClick={start} disabled={busy}>
          Start
        </PrimaryButton>
        {message && <p className="text-sm text-rose-700">{message}</p>}
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="text-base font-bold">Confirm it is you</h2>
      <p className="text-sm text-slate-600">We will email a 6-digit code to {info.codeDestination}.</p>
      {!sent ? (
        <PrimaryButton color={color} type="button" onClick={send} disabled={busy}>
          Send me a code
        </PrimaryButton>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.5em]"
            placeholder="••••••"
            aria-label="6-digit code"
          />
          <PrimaryButton color={color} type="submit" disabled={busy || code.length !== 6}>
            Continue
          </PrimaryButton>
          <button type="button" onClick={send} disabled={busy} className="w-full text-sm font-semibold text-slate-600 underline">
            Send a new code
          </button>
        </form>
      )}
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </Card>
  );
}

function ResponseForm({
  token,
  session,
  color,
  onSessionEnded,
  onDone,
}: {
  token: string;
  session: string;
  color: string;
  onSessionEnded: () => void;
  onDone: (d: HandoverSubmittedDto) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => readJson<Draft>(storageKey(token, "draft"), localStorage) ?? EMPTY_DRAFT);
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    writeJson(storageKey(token, "draft"), persistable(draft), localStorage);
  }, [draft, token]);

  const update = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d));

  /** Applies a change to one upload wherever it lives (attachments or a snag's photos). */
  const patchUpload = useCallback((localId: string, patch: Partial<UploadItem>) => {
    setDraft((d) => {
      const fix = (items: UploadItem[]) => items.map((i) => (i.localId === localId ? { ...i, ...patch } : i));
      return { ...d, attachments: fix(d.attachments), snags: d.snags.map((s) => ({ ...s, photos: fix(s.photos) })) };
    });
  }, []);

  /**
   * Large files go up in parts: the server says which parts already arrived, only the others are
   * sent (each retried a few times), then the server joins them. A dropped connection or a reload
   * therefore resumes instead of starting over.
   */
  const runResumable = useCallback(
    async (item: UploadItem, file: File) => {
      let ticket = item.uploadTicket;
      if (!ticket) {
        const started = await startMultipartUpload(token, session, { name: file.name, type: file.type, size: file.size });
        ticket = started.uploadTicket;
        patchUpload(item.localId, { uploadTicket: ticket });
      }
      const status = await multipartStatus(token, session, ticket);
      const done = new Set(status.uploadedParts);
      let sentBytes = [...done].reduce((s, n) => s + handoverPartSize(file.size, n), 0);
      patchUpload(item.localId, { progress: sentBytes / file.size });
      for (let n = 1; n <= status.partCount; n += 1) {
        if (done.has(n)) continue;
        const start = (n - 1) * HANDOVER_PART_BYTES;
        const blob = file.slice(start, start + handoverPartSize(file.size, n));
        for (let attempt = 1; ; attempt += 1) {
          try {
            const [{ uploadUrl }] = await signUploadParts(token, session, ticket, [n]);
            await putPartWithProgress(uploadUrl, blob, (loaded) => patchUpload(item.localId, { progress: (sentBytes + loaded) / file.size }));
            break;
          } catch (err) {
            if ((err as PublicApiError).code || attempt >= 3) throw err;
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
        sentBytes += blob.size;
      }
      return (await completeMultipartUpload(token, session, ticket)).objectKey;
    },
    [patchUpload, session, token]
  );

  const runUpload = useCallback(
    async (item: UploadItem) => {
      if (!item.file) return;
      patchUpload(item.localId, { status: "uploading", progress: item.progress || 0, error: undefined });
      try {
        if (item.file.size > HANDOVER_MULTIPART_THRESHOLD_BYTES) {
          const objectKey = await runResumable(item, item.file);
          patchUpload(item.localId, { status: "done", progress: 1, objectKey });
          return;
        }
        const presigned = await presignHandoverUpload(token, session, { name: item.file.name, type: item.file.type, size: item.file.size });
        await putWithProgress(presigned.uploadUrl, item.file, (p) => patchUpload(item.localId, { progress: p }));
        patchUpload(item.localId, { status: "done", progress: 1, objectKey: presigned.objectKey });
      } catch (err) {
        const e = err as PublicApiError;
        if (e.code === "HANDOVER_SESSION_INVALID") onSessionEnded();
        // An expired upload cannot be resumed: start it from the beginning next time.
        if (e.code === "MULTIPART_NOT_FOUND" || e.code === "UPLOAD_TICKET_INVALID") {
          patchUpload(item.localId, { uploadTicket: undefined, progress: 0 });
        }
        patchUpload(item.localId, { status: "failed", error: e.message });
      }
    },
    [patchUpload, session, token, onSessionEnded, runResumable]
  );

  /** A paused upload after a reload: the person picks the same file again and it continues. */
  const resumeWithFile = (item: UploadItem, file: File) => {
    if (file.name !== item.fileName || (item.byteSize !== undefined && file.size !== item.byteSize)) {
      setError(`That is not the same file. Choose "${item.fileName}" to continue, or remove it.`);
      return;
    }
    setError(null);
    const resumed = { ...item, file, status: "uploading" as const };
    patchUpload(item.localId, { file, status: "uploading" });
    void runUpload(resumed);
  };

  const makeItems = (files: FileList | null, imagesOnly: boolean): UploadItem[] => {
    const out: UploadItem[] = [];
    for (const file of Array.from(files ?? [])) {
      const kind = handoverUploadKind(file.type);
      if (!kind || (imagesOnly && kind !== "IMAGE")) {
        setError(`${file.name}: this kind of file cannot be added. Use photos, PDF, audio or video.`);
        continue;
      }
      if (file.size > HANDOVER_UPLOAD_POLICY[kind].maxBytes) {
        setError(`${file.name} is too large (limit ${Math.round(HANDOVER_UPLOAD_POLICY[kind].maxBytes / MB)} MB).`);
        continue;
      }
      out.push({
        localId: uid(),
        fileName: file.name,
        kind,
        objectKey: null,
        progress: 0,
        status: "uploading",
        file,
        byteSize: file.size,
        lastModified: file.lastModified,
      });
    }
    return out;
  };

  const addAttachments = (files: FileList | null) => {
    setError(null);
    const items = makeItems(files, false);
    update((d) => ({ ...d, attachments: [...d.attachments, ...items].slice(0, HANDOVER_LIMITS.maxAttachments) }));
    items.forEach((i) => void runUpload(i));
  };
  const addSnagPhotos = (snagId: string, files: FileList | null) => {
    setError(null);
    const items = makeItems(files, true);
    update((d) => ({
      ...d,
      snags: d.snags.map((s) => (s.localId === snagId ? { ...s, photos: [...s.photos, ...items].slice(0, HANDOVER_LIMITS.maxPhotosPerSnag) } : s)),
    }));
    items.forEach((i) => void runUpload(i));
  };
  const removeUpload = (localId: string) =>
    update((d) => ({
      ...d,
      attachments: d.attachments.filter((i) => i.localId !== localId),
      snags: d.snags.map((s) => ({ ...s, photos: s.photos.filter((p) => p.localId !== localId) })),
    }));

  const allUploads = [...draft.attachments, ...draft.snags.flatMap((s) => s.photos)];
  const uploading = allUploads.some((u) => u.status === "uploading");
  const failed = allUploads.some((u) => u.status === "failed");
  const paused = allUploads.some((u) => u.status === "paused");

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!draft.decision) p.push("Choose whether you accept the works.");
    if (draft.submitterName.trim().length < 2) p.push("Enter your name.");
    if (draft.submitterRole.trim().length < 2) p.push("Say who you are (for example, village head or head teacher).");
    if (draft.decision === "ACCEPTED_WITH_SNAGS" && draft.snags.filter((s) => s.title.trim().length >= 2).length === 0) p.push("Add at least one thing that needs fixing.");
    if (draft.decision === "REJECTED" && draft.feedbackText.trim().length < 10) p.push("Tell us why you do not accept the works.");
    if (draft.snags.some((s) => s.title.trim().length > 0 && s.title.trim().length < 2)) p.push("Give each problem a short title.");
    if (uploading) p.push("Wait for the uploads to finish.");
    if (failed) p.push("Retry or remove the files that did not upload.");
    if (paused) p.push("Choose the paused files again to finish uploading them, or remove them.");
    return p;
  }, [draft, uploading, failed, paused]);

  const send = async () => {
    setSending(true);
    setError(null);
    const d = draftRef.current;
    try {
      const result = await submitHandover(token, session, {
        decision: d.decision!,
        submitterName: d.submitterName.trim(),
        submitterRole: d.submitterRole.trim(),
        feedbackText: d.feedbackText,
        snags: d.snags
          .filter((s) => s.title.trim().length >= 2)
          .map((s) => ({
            title: s.title.trim(),
            location: s.location.trim() || undefined,
            description: s.description.trim() || undefined,
            photos: s.photos.filter((p) => p.objectKey).map((p) => ({ objectKey: p.objectKey!, fileName: p.fileName })),
          })),
        attachments: d.attachments.filter((a) => a.objectKey).map((a) => ({ objectKey: a.objectKey!, fileName: a.fileName })),
      });
      onDone(result);
    } catch (err) {
      const e = err as PublicApiError;
      if (e.code === "HANDOVER_SESSION_INVALID") onSessionEnded();
      setError(`${e.message} Your answers are saved on this device.`);
    } finally {
      setSending(false);
    }
  };

  if (reviewing) {
    return (
      <Card>
        <h2 className="text-base font-bold">Check and send</h2>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-slate-500">Your answer</dt>
            <dd className="font-semibold">{DECISIONS.find((x) => x.value === draft.decision)?.title}</dd>
          </div>
          <div>
            <dt className="text-slate-500">From</dt>
            <dd>
              {draft.submitterName} ({draft.submitterRole})
            </dd>
          </div>
          {draft.feedbackText.trim() && (
            <div>
              <dt className="text-slate-500">Comments</dt>
              <dd className="whitespace-pre-line">{draft.feedbackText}</dd>
            </div>
          )}
          {draft.snags.length > 0 && (
            <div>
              <dt className="text-slate-500">Things to fix</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {draft.snags.map((s) => (
                    <li key={s.localId}>
                      {s.title}
                      {s.location ? `, ${s.location}` : ""} ({s.photos.length} photo(s))
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-slate-500">Files</dt>
            <dd>{draft.attachments.length}</dd>
          </div>
        </dl>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <PrimaryButton color={color} type="button" onClick={send} disabled={sending}>
          {sending ? "Sending…" : "Send my response"}
        </PrimaryButton>
        <button type="button" onClick={() => setReviewing(false)} className="w-full text-sm font-semibold text-slate-600 underline">
          Go back and change something
        </button>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <h2 className="text-base font-bold">Do you accept the works?</h2>
        <div className="space-y-2">
          {DECISIONS.map((d) => (
            <label
              key={d.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${draft.decision === d.value ? "border-2" : "border-slate-200"}`}
              style={draft.decision === d.value ? { borderColor: color } : undefined}
            >
              <input
                type="radio"
                name="decision"
                checked={draft.decision === d.value}
                onChange={() =>
                  update((x) => ({
                    ...x,
                    decision: d.value,
                    snags: d.value === "ACCEPTED_WITH_SNAGS" && x.snags.length === 0 ? [{ localId: uid(), title: "", location: "", description: "", photos: [] }] : x.snags,
                  }))
                }
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-semibold">{d.title}</span>
                <span className="block text-xs text-slate-500">{d.help}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-bold">About you</h2>
        <input
          value={draft.submitterName}
          onChange={(e) => update((d) => ({ ...d, submitterName: e.target.value }))}
          placeholder="Your name"
          maxLength={120}
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
        />
        <input
          value={draft.submitterRole}
          onChange={(e) => update((d) => ({ ...d, submitterRole: e.target.value }))}
          placeholder="Who you are, e.g. village head, head teacher"
          maxLength={120}
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
        />
      </Card>

      <Card>
        <h2 className="text-base font-bold">Comments</h2>
        <textarea
          rows={5}
          value={draft.feedbackText}
          onChange={(e) => update((d) => ({ ...d, feedbackText: e.target.value }))}
          maxLength={HANDOVER_LIMITS.feedbackMaxLength}
          placeholder="Anything you want to tell the project team."
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
        />
        <p className="text-xs text-slate-500">Tip: start a line with "- " for a list, and wrap words in **two stars** to make them bold.</p>
      </Card>

      {(draft.decision === "ACCEPTED_WITH_SNAGS" || draft.snags.length > 0) && (
        <Card>
          <h2 className="text-base font-bold">Things that need fixing</h2>
          {draft.snags.map((s, idx) => (
            <div key={s.localId} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Problem {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => update((d) => ({ ...d, snags: d.snags.filter((x) => x.localId !== s.localId) }))}
                  className="text-xs font-semibold text-rose-700"
                >
                  Remove
                </button>
              </div>
              <input
                value={s.title}
                onChange={(e) => update((d) => ({ ...d, snags: d.snags.map((x) => (x.localId === s.localId ? { ...x, title: e.target.value } : x)) }))}
                placeholder="What is wrong, e.g. tap at the school leaks"
                maxLength={160}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
              <input
                value={s.location}
                onChange={(e) => update((d) => ({ ...d, snags: d.snags.map((x) => (x.localId === s.localId ? { ...x, location: e.target.value } : x)) }))}
                placeholder="Where (optional)"
                maxLength={200}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
              <textarea
                rows={2}
                value={s.description}
                onChange={(e) => update((d) => ({ ...d, snags: d.snags.map((x) => (x.localId === s.localId ? { ...x, description: e.target.value } : x)) }))}
                placeholder="More detail (optional)"
                maxLength={2000}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
              <UploadList items={s.photos} onRetry={runUpload} onRemove={removeUpload} onResume={resumeWithFile} />
              {s.photos.length < HANDOVER_LIMITS.maxPhotosPerSnag && (
                <FilePicker label="Add a photo" accept="image/*" capture onFiles={(f) => addSnagPhotos(s.localId, f)} />
              )}
            </div>
          ))}
          {draft.snags.length < HANDOVER_LIMITS.maxSnags && (
            <button
              type="button"
              onClick={() => update((d) => ({ ...d, snags: [...d.snags, { localId: uid(), title: "", location: "", description: "", photos: [] }] }))}
              className="inline-flex items-center gap-1 text-sm font-semibold"
              style={{ color }}
            >
              <Plus className="h-4 w-4" /> Add another problem
            </button>
          )}
        </Card>
      )}

      <Card>
        <h2 className="text-base font-bold">Files (optional)</h2>
        <p className="text-xs text-slate-500">Photos, PDF documents, voice recordings or short videos.</p>
        <UploadList items={draft.attachments} onRetry={runUpload} onRemove={removeUpload} onResume={resumeWithFile} />
        {draft.attachments.length < HANDOVER_LIMITS.maxAttachments && (
          <FilePicker label="Add files" accept={HANDOVER_ACCEPT_ATTRIBUTE} multiple onFiles={addAttachments} />
        )}
      </Card>

      {error && <p className="text-sm text-rose-700">{error}</p>}
      <Card>
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-slate-600">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <PrimaryButton color={color} type="button" disabled={problems.length > 0} onClick={() => setReviewing(true)}>
          Review my response
        </PrimaryButton>
        <p className="text-center text-xs text-slate-400">Your answers are kept on this device until you send them.</p>
      </Card>
    </>
  );
}

function FilePicker({
  label,
  accept,
  multiple,
  capture,
  onFiles,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  capture?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        {...(capture ? { capture: "environment" as const } : {})}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700"
      >
        <Upload className="h-4 w-4" /> {label}
      </button>
    </>
  );
}

function UploadList({
  items,
  onRetry,
  onRemove,
  onResume,
}: {
  items: UploadItem[];
  onRetry: (i: UploadItem) => void;
  onRemove: (localId: string) => void;
  onResume: (i: UploadItem, file: File) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.localId} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 truncate">{i.fileName}</span>
            {i.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            {i.status === "failed" && i.file && (
              <button type="button" onClick={() => onRetry(i)} className="font-semibold text-slate-700 underline">
                Retry
              </button>
            )}
            <button type="button" onClick={() => onRemove(i.localId)} aria-label={`Remove ${i.fileName}`}>
              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>
          {i.status === "uploading" && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-slate-500 transition-all" style={{ width: `${Math.round(i.progress * 100)}%` }} />
            </div>
          )}
          {i.status === "failed" && <p className="mt-1 text-rose-700">{i.error ?? "Upload failed."}</p>}
          {i.status === "paused" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-amber-800">Paused at {Math.round(i.progress * 100)}%. Choose the same file to continue.</span>
              <ResumePicker onFile={(file) => onResume(i, file)} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ResumePicker({ onFile }: { onFile: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={() => ref.current?.click()} className="font-semibold text-slate-700 underline">
        Choose file
      </button>
    </>
  );
}

function Confirmation({ info, done }: { info: PublicHandoverInfoDto; done: HandoverSubmittedDto }) {
  return (
    <Card>
      <CheckCircle2 className="h-10 w-10 text-emerald-600" />
      <h1 className="text-lg font-bold">Thank you. Your response was sent.</h1>
      <p className="text-sm text-slate-600">
        The project team for {info.projectName} has received it on{" "}
        {new Date(done.submittedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}. You can close this page.
      </p>
    </Card>
  );
}
