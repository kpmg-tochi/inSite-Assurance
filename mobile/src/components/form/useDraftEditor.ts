import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureFactsFor, saveDraft } from '../../storage/visitStore';
import { getCaptures, type CaptureRecord } from '../../storage/captureStore';
import { subscribeVisitData } from '../../storage/visitEvents';
import { previewGeofence } from '../../services/locationService';
import { answerCaptureIds, type PhoneCaptureFact } from '../../utils/visitForm';
import { createDraftSaver } from '../../utils/formUiModel';
import type { VisitDraft } from '../../utils/visitModel';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';

/**
 * Redesign R5c: the draft being edited on the form and review screens. Every change goes through
 * `update`, which keeps the latest draft in memory and saves it (`saveDraft`, serial and coalesced).
 * Capture facts (D-R5.14) and capture records (thumbnails, voice files, transcripts) follow the
 * capture ids the answers name and refresh when the sync stores server copies.
 */
export function useDraftEditor(projectId: string | null) {
  const [draft, setDraftState] = useState<VisitDraft | null>(null);
  const draftRef = useRef<VisitDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saver = useMemo(() => createDraftSaver<VisitDraft>(saveDraft, (e) => setSaveError(formatMobileErrorMessage(e))), []);

  /** Replaces the draft held (after a load); does not save. */
  const setDraft = useCallback((d: VisitDraft | null) => {
    draftRef.current = d;
    setDraftState(d);
  }, []);

  /** Applies a change to the latest draft and saves it. */
  const update = useCallback(
    (fn: (d: VisitDraft) => VisitDraft) => {
      const current = draftRef.current;
      if (!current) return;
      const next = fn(current);
      if (next === current) return;
      draftRef.current = next;
      setDraftState(next);
      setSaveError(null);
      saver.push(next);
    },
    [saver]
  );

  const [facts, setFacts] = useState<Map<string, PhoneCaptureFact>>(() => new Map());
  const [captures, setCaptures] = useState<Map<string, CaptureRecord>>(() => new Map());
  const captureKey = draft ? [...answerCaptureIds(draft.answers)].sort().join(',') : '';

  const loadCaptures = useCallback(async (ids: string[]) => {
    if (!projectId) return;
    const [f, recs] = await Promise.all([captureFactsFor(ids, projectId), getCaptures(ids)]);
    setFacts(new Map(f.map((x) => [x.clientCaptureId, x])));
    setCaptures(new Map(recs.map((r) => [r.id, r])));
  }, [projectId]);

  useEffect(() => {
    const ids = captureKey ? captureKey.split(',') : [];
    void loadCaptures(ids).catch(() => undefined);
    return subscribeVisitData((topic) => {
      if (topic === 'captures') void loadCaptures(ids).catch(() => undefined);
    });
  }, [captureKey, loadCaptures]);

  /** A capture just saved or picked: known at once, before the reload, so it never shows as missing. */
  const noteCapture = useCallback(
    (rec: CaptureRecord) => {
      if (!projectId) return;
      setCaptures((m) => new Map(m).set(rec.id, rec));
      setFacts((m) =>
        new Map(m).set(rec.id, {
          clientCaptureId: rec.id,
          hasFix: Boolean(rec.fix),
          isMocked: rec.fix?.isMocked ?? false,
          geofenceStatus: rec.server?.geofenceStatus ?? (rec.fix ? previewGeofence(rec.fix, projectId).status : null),
        })
      );
    },
    [projectId]
  );

  const factList = useMemo(() => [...facts.values()], [facts]);

  return { draft, draftRef, setDraft, update, saver, saveError, facts, factList, captures, noteCapture };
}
