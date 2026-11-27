import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, type ScrollViewInstance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatProjectCode, VISIT_KIND_META, type VisitFormAnswerInput, type VisitFormSnapshotField } from '@insite/shared';
import type { RootStackScreenProps } from '../../navigation/types';
import { useProfile } from '../../context/ProfileContext';
import { hydrateBaselinePack } from '../../storage/baselineStore';
import { getCaptures, saveCapture } from '../../storage/captureStore';
import { nowIso } from '../../storage/db/database';
import { listSiteLogEntries, takeSiteLogPhotoIntoDraft } from '../../storage/siteLogStore';
import {
  captureFactsFor,
  copyRefusedDraft,
  deleteDraft,
  draftFormState,
  getOpenDraft,
  getVisit,
  getVisitFormByHash,
  listVisitDrafts,
  remapOpenDraftToCurrentForm,
  siteLogAttachmentsByDraft,
  startCorrectionDraft,
  startDraft,
  type CachedVisitForm,
} from '../../storage/visitStore';
import { refreshVisitDetail } from '../../services/visitSync';
import { acquireFix } from '../../services/locationService';
import { SiteEvidenceCameraModal, type SiteEvidenceBatchSubmission } from '../../components/camera';
import type { VoiceRecordingResult } from '../../components/audio';
import { InfoCallout } from '../../components/common';
import {
  FormBlockedView,
  FormHeader,
  FormSectionBody,
  FormSectionNav,
  FormSectionsSheet,
  formScreenStyles as styles,
  formStyles,
  SiteLogPhotoPicker,
  takeRequestedFormScreen,
} from '../../components/form';
import { useDraftEditor } from '../../components/form/useDraftEditor';
import {
  addAnswerCapture,
  answerCaptureIds,
  captureUnitForSlot,
  checkDraft,
  formProgress,
  formScreens,
  removeAnswerCapture,
  setAnswerComment,
  setAnswerValue,
  type PhotoSlot,
} from '../../utils/visitForm';
import { entriesForVisitDay, pickablePhotosForField, type SiteLogRecord } from '../../utils/siteLog';
import {
  firstScreenWithIssues,
  formAccess,
  sentPhotosOfDay,
  timeInZone,
  visitDayFor,
} from '../../utils/formUiModel';
import type { StoredVisit, StoredVisitDraft } from '../../utils/visitModel';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';

/**
 * Redesign R5c: the visit form, one section per screen (D-R5.18 – D-R5.20). The draft is saved on
 * every change and resumes after a restart. Starting needs a check-in on this phone; from then on the
 * draft is bound to the form's hash. A rebuilt form is re-mapped and the dropped answers are listed.
 * A queued, refused or sent report opens read-only.
 */

type Loaded = {
  visit: StoredVisit;
  form: CachedVisitForm;
  timeZone: string | null;
  readOnly: { title: string; message: string; canCopy: boolean; status: StoredVisitDraft['status'] } | null;
};

type Phase = { kind: 'LOADING' } | { kind: 'BLOCKED'; title: string; message: string } | { kind: 'READY'; data: Loaded };

type CameraTarget = { field: VisitFormSnapshotField; unitId: string | null; left: number; title: string; replace: string | null };
type PickerTarget = { field: VisitFormSnapshotField; unitId: string | null; title: string };
type PickerState = { loading: boolean; error: string | null; day: string; entries: Array<{ entry: SiteLogRecord; uri: string | null; statusText: string | null; timeText: string }>; sentCount: number };

export default function VisitFormScreen({ route, navigation }: RootStackScreenProps<'VisitForm'>) {
  const { visitId } = route.params;
  const insets = useSafeAreaInsets();
  const { projects } = useProfile();
  const [phase, setPhase] = useState<Phase>({ kind: 'LOADING' });
  const [screenIndex, setScreenIndex] = useState(0);
  const [showSections, setShowSections] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraTarget | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const data = phase.kind === 'READY' ? phase.data : null;
  const projectId = data?.visit.projectId ?? null;
  const editor = useDraftEditor(projectId);
  const { draft, update, setDraft, saver } = editor;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const load = useCallback(async () => {
    setPhase({ kind: 'LOADING' });
    setError(null);
    try {
      const v = await getVisit(visitId);
      if (!v) return setPhase({ kind: 'BLOCKED', title: 'Monitoring visit not on this phone', message: 'Refresh your monitoring visits and open it again.' });
      const pack = await hydrateBaselinePack(v.projectId).catch(() => null);
      const timeZone = pack?.timezone ?? null;
      const canSubmit = projectsRef.current.find((p) => p.projectId === v.projectId)?.permissions.includes('visits:submit') ?? false;
      const [open, all] = await Promise.all([getOpenDraft(v.id), listVisitDrafts(v.id)]);
      let access = formAccess(v, { open, latest: all[0] ?? null }, canSubmit);

      if (access.mode === 'START') {
        if (access.correction) {
          if (!v.serverId) return setPhase({ kind: 'BLOCKED', title: 'Not on the server yet', message: 'This monitoring visit has not reached the server yet.' });
          try {
            const detail = await refreshVisitDetail(v.projectId, v.serverId);
            await startCorrectionDraft(v.id, detail);
          } catch (err) {
            return setPhase({ kind: 'BLOCKED', title: 'Returned for correction', message: `Connect to the internet to download the returned monitoring report. ${formatMobileErrorMessage(err)}` });
          }
        } else {
          try {
            await startDraft(v.id);
          } catch (err) {
            return setPhase({ kind: 'BLOCKED', title: 'Form not ready', message: formatMobileErrorMessage(err) });
          }
        }
        const reopened = await getOpenDraft(v.id);
        access = reopened ? formAccess(v, { open: reopened, latest: reopened }, canSubmit) : access;
      }

      if (access.mode === 'BLOCKED') return setPhase({ kind: 'BLOCKED', title: access.title, message: access.message });
      if (access.mode === 'START') return setPhase({ kind: 'BLOCKED', title: 'Form not ready', message: 'The monitoring report could not be started. Try again.' });

      let stored = access.draft;
      if (access.mode === 'EDIT') {
        // D-R5.19: the visit's form changed since this draft started.
        const state = await draftFormState(v.id);
        if (state.kind === 'FORM_MISSING') {
          return setPhase({ kind: 'BLOCKED', title: 'Form not on this phone', message: 'The form for this monitoring report is not on the phone. Connect once to download it.' });
        }
        if (state.kind === 'REBUILT') {
          await remapOpenDraftToCurrentForm(v.id);
          stored = (await getOpenDraft(v.id)) ?? stored;
        }
      }
      const form = await getVisitFormByHash(v.id, stored.draft.formHash);
      if (!form) return setPhase({ kind: 'BLOCKED', title: 'Form not on this phone', message: 'The form of this monitoring report is no longer on the phone.' });

      const facts = await captureFactsFor(answerCaptureIds(stored.draft.answers), v.projectId);
      const check = checkDraft(form.snapshot, stored.draft, facts);
      const screens = formScreens(form.snapshot);
      const requested = takeRequestedFormScreen(v.id);
      const requestedIndex = requested ? screens.findIndex((s) => s.key === requested) : -1;
      setScreenIndex(requestedIndex >= 0 ? requestedIndex : access.mode === 'EDIT' ? firstScreenWithIssues(screens, check) : 0);
      setDraft(stored.draft);
      setPhase({
        kind: 'READY',
        data: {
          visit: v,
          form,
          timeZone,
          readOnly: access.mode === 'READ_ONLY' ? { title: access.title, message: access.message, canCopy: access.canCopy, status: stored.status } : null,
        },
      });
    } catch (err) {
      setPhase({ kind: 'BLOCKED', title: 'Could not open the form', message: formatMobileErrorMessage(err) });
    }
  }, [visitId, setDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from the review: it may have changed the draft (overall finding, summary, site log)
  // or queued it, and it may ask for one section.
  useEffect(() => {
    return navigation.addListener('focus', () => {
      const current = editor.draftRef.current;
      if (!current) return;
      void (async () => {
        await saver.flush().catch(() => undefined);
        const open = await getOpenDraft(visitId);
        if (!open || open.draft.id !== current.id || open.status !== 'DRAFT') return void load();
        setDraft(open.draft);
        const requested = takeRequestedFormScreen(visitId);
        if (requested && data) {
          const i = formScreens(data.form.snapshot).findIndex((s) => s.key === requested);
          if (i >= 0) setScreenIndex(i);
        }
      })();
    });
  }, [navigation, visitId, editor.draftRef, saver, setDraft, load, data]);

  const screens = useMemo(() => (data ? formScreens(data.form.snapshot) : []), [data]);
  const check = useMemo(() => (data && draft ? checkDraft(data.form.snapshot, draft, editor.factList) : null), [data, draft, editor.factList]);
  const readOnly = Boolean(data?.readOnly);
  const screen = screens[Math.min(screenIndex, Math.max(0, screens.length - 1))];

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [screenIndex]);

  // ----- answers -----
  const onValue = (path: string, value: VisitFormAnswerInput['value']) => update((d) => ({ ...d, answers: setAnswerValue(d.answers, path, value) }));
  const onComment = (path: string, comment: string | null) => update((d) => ({ ...d, answers: setAnswerComment(d.answers, path, comment) }));
  const onRemoveCapture = (path: string, id: string) => update((d) => ({ ...d, answers: removeAnswerCapture(d.answers, path, id) }));

  // ----- photos -----
  const slotTitle = (field: VisitFormSnapshotField, slot: PhotoSlot) => (slot.unitId && slot.label !== 'Photo' ? `${field.label}: ${slot.label}` : field.label);
  const onTakePhoto = (field: VisitFormSnapshotField, slot: PhotoSlot, left: number) =>
    setCamera({ field, unitId: captureUnitForSlot(field, slot), left, title: slotTitle(field, slot), replace: null });
  const onRetakePhoto = (field: VisitFormSnapshotField, slot: PhotoSlot, id: string) =>
    setCamera({ field, unitId: captureUnitForSlot(field, slot), left: 1, title: slotTitle(field, slot), replace: id });

  const onPhotos = async (batch: SiteEvidenceBatchSubmission) => {
    const target = camera;
    setCamera(null);
    if (!target || !data) return;
    const kept = batch.photos.slice(0, target.left);
    let replace = target.replace;
    setError(null);
    try {
      for (const photo of kept) {
        const rec = await saveCapture({
          projectId: data.visit.projectId,
          mediaType: 'SITE_PHOTO',
          sourceUri: photo.uri,
          mimeType: 'image/jpeg',
          fileExtension: 'jpg',
          caption: batch.caption || target.title,
          // The fix taken at this photo's shutter; none means "no location", never a default.
          fix: photo.gps ?? null,
          heading: photo.heading ?? null,
          capturedAt: photo.capturedAt,
        });
        editor.noteCapture(rec);
        const replacing = replace;
        update((d) => {
          const answers = replacing ? removeAnswerCapture(d.answers, target.field.path, replacing) : d.answers;
          return { ...d, answers: addAnswerCapture(answers, target.field.path, { clientCaptureId: rec.id, unitId: target.unitId, kind: 'PHOTO' }) };
        });
        replace = null;
      }
      if (batch.photos.length > kept.length) {
        setError(`Only ${kept.length} more photo${kept.length === 1 ? '' : 's'} fit here; the other${batch.photos.length - kept.length === 1 ? ' was' : 's were'} not kept.`);
      }
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    }
  };

  // ----- voice notes -----
  const onVoiceRecorded = async (field: VisitFormSnapshotField, result: VoiceRecordingResult) => {
    if (!data) return;
    setError(null);
    try {
      const fix = await acquireFix();
      const rec = await saveCapture({
        projectId: data.visit.projectId,
        mediaType: 'VOICE_NOTE',
        sourceUri: result.uri,
        mimeType: result.mimeType,
        fileExtension: result.fileName.split('.').pop() || 'm4a',
        durationSeconds: result.durationMs / 1000,
        caption: field.label,
        fix,
        capturedAt: nowIso(),
      });
      editor.noteCapture(rec);
      update((d) => ({ ...d, answers: addAnswerCapture(d.answers, field.path, { clientCaptureId: rec.id, unitId: field.unitId, kind: 'AUDIO' }) }));
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    }
  };

  // ----- pick from site log (D-R5.22) -----
  const openPicker = async (field: VisitFormSnapshotField, slot: PhotoSlot) => {
    if (!data || !draft) return;
    const day = visitDayFor(data.visit, data.timeZone);
    setPicker({ field, unitId: captureUnitForSlot(field, slot), title: slotTitle(field, slot) });
    setPickerState({ loading: true, error: null, day, entries: [], sentCount: 0 });
    try {
      const [entries, attached] = await Promise.all([listSiteLogEntries(data.visit.projectId), siteLogAttachmentsByDraft()]);
      const ctx = { projectId: data.visit.projectId, visitDate: day, timeZone: data.timeZone };
      const pickable = pickablePhotosForField(entries, { ...ctx, attachedToDrafts: attached });
      const recs = await getCaptures(pickable.map((e) => e.captureId!).filter(Boolean));
      const byId = new Map(recs.map((r) => [r.id, r]));
      const facts = new Map((await captureFactsFor(recs.map((r) => r.id), data.visit.projectId)).map((f) => [f.clientCaptureId, f]));
      setPickerState({
        loading: false,
        error: null,
        day,
        sentCount: sentPhotosOfDay(entriesForVisitDay(entries, ctx), pickable),
        entries: pickable.map((entry) => {
          const rec = entry.captureId ? byId.get(entry.captureId) : undefined;
          const f = entry.captureId ? facts.get(entry.captureId) : undefined;
          const statusText = !f ? 'No longer on the phone' : !f.hasFix ? 'No location' : f.isMocked ? 'Simulated location' : f.geofenceStatus === 'OUTSIDE' ? 'Outside the site boundary' : null;
          return { entry, uri: rec && !rec.localDeletedAt ? rec.localPath : null, statusText, timeText: timeInZone(entry.capturedAt, data.timeZone) };
        }),
      });
    } catch (err) {
      setPickerState({ loading: false, error: formatMobileErrorMessage(err), day, entries: [], sentCount: 0 });
    }
  };

  const onPick = async (entryId: string) => {
    const target = picker;
    const current = editor.draftRef.current;
    if (!target || !current) return;
    try {
      await saver.flush();
      const captureId = await takeSiteLogPhotoIntoDraft(entryId, current.id);
      const [rec] = await getCaptures([captureId]);
      if (rec) editor.noteCapture(rec);
      update((d) => ({ ...d, answers: addAnswerCapture(d.answers, target.field.path, { clientCaptureId: captureId, unitId: target.unitId, kind: 'PHOTO' }) }));
      setPicker(null);
      setPickerState(null);
    } catch (err) {
      setPickerState((s) => (s ? { ...s, error: formatMobileErrorMessage(err) } : s));
    }
  };

  // ----- navigation -----
  const goTo = (i: number) => {
    setShowSections(false);
    setScreenIndex(Math.max(0, Math.min(i, screens.length - 1)));
  };
  const toReview = async () => {
    setShowSections(false);
    await saver.flush().catch(() => undefined);
    navigation.navigate('VisitReview', { visitId });
  };
  const back = async () => {
    await saver.flush().catch(() => undefined);
    navigation.goBack();
  };

  const copyRefused = async () => {
    if (!draft) return;
    try {
      await copyRefusedDraft(draft.id);
      await load();
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    }
  };
  const removeRefused = async () => {
    if (!draft) return;
    try {
      await deleteDraft(draft.id);
      navigation.goBack();
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    }
  };

  // ----- render -----
  const kindLabel = data ? VISIT_KIND_META[data.visit.visit.visitKind].label : 'Monitoring visit';
  const progress = data && check ? formProgress(data.form.snapshot, check) : null;
  const header = (
    <FormHeader
      title={`${kindLabel}${data ? ` · ${formatProjectCode(data.visit.visit.projectCode)}` : ''}`}
      subtitle={data && screen ? `Section ${screenIndex + 1} of ${screens.length} · ${screen.title}` : null}
      backLabel="‹ Back"
      backA11yLabel="Back to the monitoring visit"
      onBack={() => void back()}
      topInset={insets.top}
      progress={progress}
      onShowSections={() => setShowSections(true)}
    />
  );

  if (phase.kind === 'LOADING') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <ActivityIndicator style={{ marginTop: 32 }} accessibilityLabel="Opening the form" />
      </View>
    );
  }
  if (phase.kind === 'BLOCKED' || !data || !draft || !check || !screen) {
    const title = phase.kind === 'BLOCKED' ? phase.title : 'Form not ready';
    const message = phase.kind === 'BLOCKED' ? phase.message : 'This form has no sections.';
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <FormBlockedView title={title} message={message} onRetry={() => void load()} />
      </View>
    );
  }

  const block = data.form.snapshot.blocks[screen.index];
  const sectionIssues = check.byScreen.get(screen.key);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {header}
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {data.readOnly && (
          <View style={{ marginBottom: 12 }}>
            <InfoCallout variant={data.readOnly.status === 'REFUSED' ? 'warning' : 'info'} title={data.readOnly.title} description={data.readOnly.message} />
            {data.readOnly.status === 'REFUSED' && (
              <View style={formStyles.row}>
                {data.readOnly.canCopy && (
                  <TouchableOpacity style={formStyles.primaryButton} onPress={() => void copyRefused()} accessibilityRole="button">
                    <Text style={formStyles.primaryButtonText}>Start a new monitoring report from this one</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={formStyles.secondaryButton} onPress={() => void removeRefused()} accessibilityRole="button">
                  <Text style={formStyles.secondaryButtonText}>Delete this monitoring report</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {draft.remap && !readOnly && (
          <View style={{ marginBottom: 12 }}>
            <InfoCallout
              variant="warning"
              title="The form was rebuilt"
              description={
                draft.remap.dropped.length === 0
                  ? 'The form for this monitoring visit changed after you started. Your answers were moved onto the new form.'
                  : `The form for this monitoring visit changed after you started. Your answers were moved onto the new form, except: ${draft.remap.dropped.map((d) => `${d.label} (${d.reason})`).join('; ')}.`
              }
            />
            <TouchableOpacity onPress={() => update((d) => ({ ...d, remap: null }))} accessibilityRole="button" accessibilityLabel="Dismiss the rebuilt form notice">
              <Text style={formStyles.link}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        <FormSectionBody
          screen={screen}
          block={block}
          answers={draft.answers}
          issues={sectionIssues}
          facts={editor.facts}
          captures={editor.captures}
          readOnly={readOnly}
          timeZone={data.timeZone}
          handlers={{
            onValue,
            onComment,
            onTakePhoto,
            onRetakePhoto,
            onRemoveCapture,
            onPickFromSiteLog: (f, slot) => void openPicker(f, slot),
            onVoiceRecorded: (f, r) => void onVoiceRecorded(f, r),
          }}
        />
        {editor.saveError ? <Text style={formStyles.error}>Not saved: {editor.saveError}</Text> : null}
        {error ? <Text style={formStyles.error}>{error}</Text> : null}

        <FormSectionNav screenIndex={screenIndex} count={screens.length} readOnly={readOnly} onGo={goTo} onReview={() => void toReview()} />
      </ScrollView>

      <FormSectionsSheet
        visible={showSections}
        screens={screens}
        check={check}
        screenIndex={screenIndex}
        readOnly={readOnly}
        bottomInset={insets.bottom}
        onGo={goTo}
        onReview={() => void toReview()}
        onClose={() => setShowSections(false)}
      />

      <SiteEvidenceCameraModal visible={Boolean(camera)} title={camera?.title ?? 'Monitoring visit photo'} onSubmit={(b) => void onPhotos(b)} onClose={() => setCamera(null)} />
      <SiteLogPhotoPicker
        visible={Boolean(picker)}
        loading={pickerState?.loading ?? false}
        slotLabel={picker?.title ?? ''}
        visitDay={pickerState?.day ?? ''}
        entries={pickerState?.entries ?? []}
        sentCount={pickerState?.sentCount ?? 0}
        error={pickerState?.error ?? null}
        onPick={(id) => void onPick(id)}
        onClose={() => {
          setPicker(null);
          setPickerState(null);
        }}
      />
    </View>
  );
}
