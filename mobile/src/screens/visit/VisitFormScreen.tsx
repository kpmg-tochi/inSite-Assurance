import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, type ScrollViewInstance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
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
import { FormFieldCard, FORM_COLORS, formStyles, SiteLogPhotoPicker, takeRequestedFormScreen } from '../../components/form';
import { useDraftEditor } from '../../components/form/useDraftEditor';
import {
  addAnswerCapture,
  answerCaptureIds,
  answerFor,
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
  progressText,
  screenStatusText,
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
      if (!v) return setPhase({ kind: 'BLOCKED', title: 'Visit not on this phone', message: 'Refresh your visits and open it again.' });
      const pack = await hydrateBaselinePack(v.projectId).catch(() => null);
      const timeZone = pack?.timezone ?? null;
      const canSubmit = projectsRef.current.find((p) => p.projectId === v.projectId)?.permissions.includes('visits:submit') ?? false;
      const [open, all] = await Promise.all([getOpenDraft(v.id), listVisitDrafts(v.id)]);
      let access = formAccess(v, { open, latest: all[0] ?? null }, canSubmit);

      if (access.mode === 'START') {
        if (access.correction) {
          if (!v.serverId) return setPhase({ kind: 'BLOCKED', title: 'Not on the server yet', message: 'This visit has not reached the server yet.' });
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
  const kindLabel = data ? VISIT_KIND_META[data.visit.visit.visitKind].label : 'Visit';
  const progress = data && check ? formProgress(data.form.snapshot, check) : null;
  const header = (
    <LinearGradient colors={['#00715D', '#005A4A', '#122F2A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
      <TouchableOpacity onPress={() => void back()} accessibilityRole="button" accessibilityLabel="Back to the visit">
        <Text style={styles.closeText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title} accessibilityRole="header">
        {kindLabel}
        {data ? ` · ${formatProjectCode(data.visit.visit.projectCode)}` : ''}
      </Text>
      {data && screen ? (
        <Text style={styles.subtitle}>
          Section {screenIndex + 1} of {screens.length} · {screen.title}
        </Text>
      ) : null}
      {progress ? (
        <>
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={progressText(progress.done, progress.total)}
            accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
          >
            <View style={[styles.progressFill, { width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }]} />
          </View>
          <View style={styles.headerRow}>
            <Text style={styles.subtitle}>{progressText(progress.done, progress.total)}</Text>
            <TouchableOpacity onPress={() => setShowSections(true)} accessibilityRole="button" accessibilityLabel="Show all sections">
              <Text style={styles.headerLink}>All sections</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </LinearGradient>
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
        <View style={styles.body}>
          <InfoCallout variant="warning" title={title} description={message} />
          <TouchableOpacity style={[formStyles.secondaryButton, { marginTop: 12, alignSelf: 'flex-start' }]} onPress={() => void load()} accessibilityRole="button">
            <Text style={formStyles.secondaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const block = data.form.snapshot.blocks[screen.index];
  const sectionIssues = check.byScreen.get(screen.key);
  const isLast = screenIndex === screens.length - 1;

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
                  ? 'The form for this visit changed after you started. Your answers were moved onto the new form.'
                  : `The form for this visit changed after you started. Your answers were moved onto the new form, except: ${draft.remap.dropped.map((d) => `${d.label} (${d.reason})`).join('; ')}.`
              }
            />
            <TouchableOpacity onPress={() => update((d) => ({ ...d, remap: null }))} accessibilityRole="button" accessibilityLabel="Dismiss the rebuilt form notice">
              <Text style={formStyles.link}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          {screen.title}
        </Text>
        {screen.description ? <Text style={[formStyles.meta, { marginBottom: 8 }]}>{screen.description}</Text> : null}
        {screen.kind === 'FACILITY' && screen.units.length > 0 ? (
          <Text style={[formStyles.meta, { marginBottom: 8 }]}>
            Units: {screen.units.map((u) => (u.plannedQuantity !== null ? `${u.label} (${u.plannedQuantity}${u.quantityUnit ? ` ${u.quantityUnit}` : ''})` : u.label)).join(', ')}
          </Text>
        ) : null}
        {screen.isEmpty && <InfoCallout variant="neutral" title="Nothing to answer" description="This facility has no questions on this visit." />}

        {block.fields.map((field) => (
          <FormFieldCard
            key={field.path}
            field={field}
            block={block}
            answer={answerFor(draft.answers, field.path)}
            issues={sectionIssues}
            facts={editor.facts}
            captures={editor.captures}
            readOnly={readOnly}
            timeZone={data.timeZone}
            onValue={onValue}
            onComment={onComment}
            onTakePhoto={onTakePhoto}
            onRetakePhoto={onRetakePhoto}
            onRemoveCapture={onRemoveCapture}
            onPickFromSiteLog={readOnly ? undefined : (f, slot) => void openPicker(f, slot)}
            onVoiceRecorded={(f, r) => void onVoiceRecorded(f, r)}
          />
        ))}

        {!readOnly && (
          <Text style={[formStyles.meta, sectionIssues?.length ? { color: FORM_COLORS.error } : { color: FORM_COLORS.ok }]} accessibilityLiveRegion="polite">
            {sectionIssues?.length ? `${sectionIssues.length} thing${sectionIssues.length === 1 ? '' : 's'} to fix in this section` : 'This section is complete'}
          </Text>
        )}
        {editor.saveError ? <Text style={formStyles.error}>Not saved: {editor.saveError}</Text> : null}
        {error ? <Text style={formStyles.error}>{error}</Text> : null}

        <View style={[formStyles.row, { marginTop: 16 }]}>
          {screenIndex > 0 && (
            <TouchableOpacity style={formStyles.secondaryButton} onPress={() => goTo(screenIndex - 1)} accessibilityRole="button" accessibilityLabel="Previous section">
              <Text style={formStyles.secondaryButtonText}>Previous</Text>
            </TouchableOpacity>
          )}
          {!isLast ? (
            <TouchableOpacity style={formStyles.primaryButton} onPress={() => goTo(screenIndex + 1)} accessibilityRole="button" accessibilityLabel="Next section">
              <Text style={formStyles.primaryButtonText}>Next section</Text>
            </TouchableOpacity>
          ) : !readOnly ? (
            <TouchableOpacity style={formStyles.primaryButton} onPress={() => void toReview()} accessibilityRole="button">
              <Text style={formStyles.primaryButtonText}>Review and submit</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {!readOnly && <Text style={[formStyles.meta, { marginTop: 12 }]}>Saved on this phone as you go.</Text>}
      </ScrollView>

      <Modal visible={showSections} transparent animationType="fade" onRequestClose={() => setShowSections(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Sections
            </Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {screens.map((s, i) => {
                const status = screenStatusText(check, s.key);
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.sectionRow, i === screenIndex && styles.sectionRowOn]}
                    onPress={() => goTo(i)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: i === screenIndex }}
                    accessibilityLabel={`Section ${i + 1}, ${s.title}, ${status}`}
                  >
                    <Text style={formStyles.label}>
                      {i + 1}. {s.title}
                    </Text>
                    <Text style={[formStyles.meta, { color: status === 'Complete' ? FORM_COLORS.ok : FORM_COLORS.error }]}>{status}</Text>
                  </TouchableOpacity>
                );
              })}
              {!readOnly && (
                <TouchableOpacity style={styles.sectionRow} onPress={() => void toReview()} accessibilityRole="button">
                  <Text style={formStyles.label}>Review and submit</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowSections(false)} accessibilityRole="button">
              <Text style={formStyles.link}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SiteEvidenceCameraModal visible={Boolean(camera)} title={camera?.title ?? 'Visit photo'} onSubmit={(b) => void onPhotos(b)} onClose={() => setCamera(null)} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FORM_COLORS.page },
  header: { paddingHorizontal: 20, paddingBottom: 18 },
  closeText: { fontSize: 13, color: '#B5DDD3', fontWeight: '700', marginBottom: 8, paddingVertical: 4 },
  title: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: '#D7EEE8', marginTop: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLink: { fontSize: 12, color: '#FFFFFF', fontWeight: '800', marginTop: 4, paddingVertical: 4, textDecorationLine: 'underline' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: '#FFFFFF' },
  body: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: FORM_COLORS.text, marginBottom: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sectionRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  sectionRowOn: { backgroundColor: '#EEF7F4' },
});
