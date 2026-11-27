import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VisitFormAnswerInput } from '@insite/shared';
import { captureFactsFor, saveDraft } from '../../storage/visitStore';
import { getCaptures, type CaptureRecord } from '../../storage/captureStore';
import { subscribeVisitData } from '../../storage/visitEvents';
import { previewGeofence } from '../../services/locationService';
import { answerCaptureIds, type PhoneCaptureFact } from '../../utils/visitForm';
import { createDraftSaver } from '../../utils/formUiModel';
import type { VisitDraft } from '../../utils/visitModel';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';

/** Where a draft's capture facts come from (D-R5.14): a visit's project boundary, or none (needs verification). */
export interface DraftCaptureSource {
  factsFor: (captureIds: string[]) => Promise<PhoneCaptureFact[]>;
  factOf: (rec: CaptureRecord) => PhoneCaptureFact;
}

/**
 * Redesign R5c: the draft being edited on the form and review screens. Every change goes through
 * `update`, which keeps the latest draft in memory and saves it (`save`, serial and coalesced).
 * Capture facts (D-R5.14) and capture records (thumbnails, voice files, transcripts) follow the
 * capture ids the answers name and refresh when the sync stores server copies.
 *
 * Needs pipeline wave 5: generic over the draft (visit drafts and verification drafts share the
 * answers shape); `save` must be a stable function, `captures` null until the screen has loaded.
 */
export function useFormDraftEditor<D extends { answers: VisitFormAnswerInput[] }>(save: (d: D) => Promise<void>, captures: DraftCaptureSource | null) {
  const [draft, setDraftState] = useState<D | null>(null);
  const draftRef = useRef<D | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const saver = useMemo(() => createDraftSaver<D>((d) => saveRef.current(d), (e) => setSaveError(formatMobileErrorMessage(e))), []);

  /** Replaces the draft held (after a load); does not save. */
  const setDraft = useCallback((d: D | null) => {
    draftRef.current = d;
    setDraftState(d);
  }, []);

  /** Applies a change to the latest draft and saves it. */
  const update = useCallback(
    (fn: (d: D) => D) => {
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
  const [captureRecords, setCaptures] = useState<Map<string, CaptureRecord>>(() => new Map());
  const captureKey = draft ? [...answerCaptureIds(draft.answers)].sort().join(',') : '';

  const loadCaptures = useCallback(
    async (ids: string[]) => {
      if (!captures) return;
      const [f, recs] = await Promise.all([captures.factsFor(ids), getCaptures(ids)]);
      setFacts(new Map(f.map((x) => [x.clientCaptureId, x])));
      setCaptures(new Map(recs.map((r) => [r.id, r])));
    },
    [captures]
  );

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
      if (!captures) return;
      setCaptures((m) => new Map(m).set(rec.id, rec));
      setFacts((m) => new Map(m).set(rec.id, captures.factOf(rec)));
    },
    [captures]
  );

  const factList = useMemo(() => [...facts.values()], [facts]);

  return { draft, draftRef, setDraft, update, saver, saveError, facts, factList, captures: captureRecords, noteCapture };
}

/** The visit draft editor: facts against the project's boundary (unchanged since R5c). */
export function useDraftEditor(projectId: string | null) {
  const source = useMemo<DraftCaptureSource | null>(
    () =>
      projectId
        ? {
            factsFor: (ids) => captureFactsFor(ids, projectId),
            factOf: (rec) => ({
              clientCaptureId: rec.id,
              hasFix: Boolean(rec.fix),
              isMocked: rec.fix?.isMocked ?? false,
              geofenceStatus: rec.server?.geofenceStatus ?? (rec.fix ? previewGeofence(rec.fix, projectId).status : null),
            }),
          }
        : null,
    [projectId]
  );
  return useFormDraftEditor<VisitDraft>(saveDraft, source);
}
