import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, type ScrollViewInstance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VisitFormAnswerInput, VisitFormSnapshotField } from '@insite/shared';
import type { RootStackScreenProps } from '../../navigation/types';
import { saveCapture, type CaptureRecord } from '../../storage/captureStore';
import { nowIso } from '../../storage/db/database';
import {
  getNeedsVerification,
  getNeedsVerificationForm,
  getOpenVerificationDraft,
  listVerificationDrafts,
  saveVerificationDraft,
  startVerificationCorrectionDraft,
  startVerificationDraft,
  verificationCaptureFacts,
} from '../../storage/needsVerificationStore';
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
  takeRequestedFormScreen,
} from '../../components/form';
import { useFormDraftEditor, type DraftCaptureSource } from '../../components/form/useDraftEditor';
import { SiteLocationCard } from '../../components/needsVerification/SiteLocationCard';
import { addAnswerCapture, captureUnitForSlot, formProgress, formScreens, removeAnswerCapture, setAnswerComment, setAnswerValue, type PhotoSlot } from '../../utils/visitForm';
import { firstScreenWithIssues } from '../../utils/formUiModel';
import {
  checkVerificationDraft,
  NO_LOCATION_FIX_MESSAGE,
  siteLocationFromFix,
  upsertSiteLocation,
  verificationFormAccess,
  verificationLabel,
  verificationScope,
  verificationSnapshot,
  type CachedNeedsVerificationForm,
  type NeedsVerificationDraft,
  type StoredNeedsVerification,
} from '../../utils/needsVerification';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';

/**
 * Needs pipeline wave 5 (N8): the field verification form, one section per screen (a section per
 * school site, then one per facilities breakdown row of that site), rendered with the visit form's
 * pieces (`FormSections`, `FormFieldCard`). Each site section starts with its location card
 * ("Record location here"). The draft is saved on every change; a queued, sent or refused one opens
 * read-only. Works offline.
 */

type Loaded = {
  v: StoredNeedsVerification;
  form: CachedNeedsVerificationForm;
  readOnly: { title: string; message: string } | null;
};
type Phase = { kind: 'LOADING' } | { kind: 'BLOCKED'; title: string; message: string } | { kind: 'READY'; data: Loaded };
type CameraTarget = { field: VisitFormSnapshotField; unitId: string | null; left: number; title: string; replace: string | null };

const CAPTURES: DraftCaptureSource = {
  factsFor: verificationCaptureFacts,
  // No site boundary for a proposed project: the photo's own location is what counts.
  factOf: (rec: CaptureRecord) => ({ clientCaptureId: rec.id, hasFix: Boolean(rec.fix), isMocked: rec.fix?.isMocked ?? false, geofenceStatus: null }),
};

/** The site number of a site section key (`n:site:<n>`), or null for a row section. */
function siteNumberOfKey(key: string): number | null {
  const m = /^n:site:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

export default function NeedsVerificationFormScreen({ route, navigation }: RootStackScreenProps<'NeedsVerificationForm'>) {
  const { verificationId } = route.params;
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'LOADING' });
  const [screenIndex, setScreenIndex] = useState(0);
  const [showSections, setShowSections] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraTarget | null>(null);
  const [locating, setLocating] = useState<number | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const data = phase.kind === 'READY' ? phase.data : null;
  const editor = useFormDraftEditor<NeedsVerificationDraft>(saveVerificationDraft, data ? CAPTURES : null);
  const { draft, update, setDraft, saver } = editor;
  const snapshot = useMemo(() => (data ? verificationSnapshot(data.form.form) : null), [data]);

  const load = useCallback(async () => {
    setPhase({ kind: 'LOADING' });
    setError(null);
    try {
      const v = await getNeedsVerification(verificationId);
      if (!v) return setPhase({ kind: 'BLOCKED', title: 'Site verification not on this phone', message: 'Pull down on Home to refresh, then open it again.' });
      const drafts = await listVerificationDrafts(v.id);
      let open = drafts.find((d) => d.status === 'DRAFT' || d.status === 'QUEUED') ?? null;
      let access = verificationFormAccess(v, { open, latest: drafts[0] ?? null });
      if (access.mode === 'START') {
        try {
          if (access.correction) await startVerificationCorrectionDraft(v.id);
          else await startVerificationDraft(v.id);
        } catch (err) {
          return setPhase({ kind: 'BLOCKED', title: 'Form not ready', message: formatMobileErrorMessage(err) });
        }
        open = await getOpenVerificationDraft(v.id);
        access = verificationFormAccess(v, { open, latest: open });
      }
      if (access.mode === 'BLOCKED') return setPhase({ kind: 'BLOCKED', title: access.title, message: access.message });
      if (access.mode === 'START') return setPhase({ kind: 'BLOCKED', title: 'Form not ready', message: 'The site verification could not be started. Try again.' });
      const stored = access.draft;
      const form = await getNeedsVerificationForm(v.id, stored.draft.formHash);
      if (!form) return setPhase({ kind: 'BLOCKED', title: 'Form not on this phone', message: 'The form of this site verification is not on the phone. Connect once to download it.' });
      const facts = await verificationCaptureFacts(stored.draft.answers.flatMap((a) => (a.captures ?? []).map((c) => c.clientCaptureId)));
      const check = checkVerificationDraft(form.form, stored.draft, facts);
      const screens = formScreens(verificationSnapshot(form.form));
      const requested = takeRequestedFormScreen(v.id);
      const requestedIndex = requested ? screens.findIndex((s) => s.key === requested) : -1;
      setScreenIndex(requestedIndex >= 0 ? requestedIndex : access.mode === 'EDIT' ? firstScreenWithIssues(screens, check) : 0);
      setDraft(stored.draft);
      setPhase({ kind: 'READY', data: { v, form, readOnly: access.mode === 'READ_ONLY' ? { title: access.title, message: access.message } : null } });
    } catch (err) {
      setPhase({ kind: 'BLOCKED', title: 'Could not open the form', message: formatMobileErrorMessage(err) });
    }
  }, [verificationId, setDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from the review: it may have changed the notes or queued the draft, and may ask for a section.
  useEffect(() => {
    return navigation.addListener('focus', () => {
      const current = editor.draftRef.current;
      if (!current) return;
      void (async () => {
        await saver.flush().catch(() => undefined);
        const open = await getOpenVerificationDraft(verificationId);
        if (!open || open.draft.id !== current.id || open.status !== 'DRAFT') return void load();
        setDraft(open.draft);
        const requested = takeRequestedFormScreen(verificationId);
        if (requested && snapshot) {
          const i = formScreens(snapshot).findIndex((s) => s.key === requested);
          if (i >= 0) setScreenIndex(i);
        }
      })();
    });
  }, [navigation, verificationId, editor.draftRef, saver, setDraft, load, snapshot]);

  const screens = useMemo(() => (snapshot ? formScreens(snapshot) : []), [snapshot]);
  const check = useMemo(() => (data && draft ? checkVerificationDraft(data.form.form, draft, editor.factList) : null), [data, draft, editor.factList]);
  const readOnly = Boolean(data?.readOnly);
  const screen = screens[Math.min(screenIndex, Math.max(0, screens.length - 1))];

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [screenIndex]);

  // ----- answers -----
  const onValue = (path: string, value: VisitFormAnswerInput['value']) => update((d) => ({ ...d, answers: setAnswerValue(d.answers, path, value) }));
  const onComment = (path: string, comment: string | null) => update((d) => ({ ...d, answers: setAnswerComment(d.answers, path, comment) }));
  const onRemoveCapture = (path: string, id: string) => update((d) => ({ ...d, answers: removeAnswerCapture(d.answers, path, id) }));

  // ----- location -----
  const recordLocation = async (siteNumber: number) => {
    setError(null);
    setLocating(siteNumber);
    try {
      const fix = await acquireFix();
      if (!fix) throw new Error(NO_LOCATION_FIX_MESSAGE);
      update((d) => ({ ...d, siteLocations: upsertSiteLocation(d.siteLocations, siteLocationFromFix(siteNumber, fix)) }));
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    } finally {
      setLocating(null);
    }
  };

  // ----- photos and voice notes (verification captures) -----
  const slotTitle = (field: VisitFormSnapshotField, slot: PhotoSlot) => (slot.unitId && slot.label !== 'Photo' ? `${field.label}: ${slot.label}` : field.label);
  const onTakePhoto = (field: VisitFormSnapshotField, slot: PhotoSlot, left: number) => setCamera({ field, unitId: captureUnitForSlot(field, slot), left, title: slotTitle(field, slot), replace: null });
  const onRetakePhoto = (field: VisitFormSnapshotField, slot: PhotoSlot, id: string) => setCamera({ field, unitId: captureUnitForSlot(field, slot), left: 1, title: slotTitle(field, slot), replace: id });

  const captureTarget = (id: string) => ({ projectId: verificationScope(id), verificationId: id });

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
          ...captureTarget(data.v.id),
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

  const onVoiceRecorded = async (field: VisitFormSnapshotField, result: VoiceRecordingResult) => {
    if (!data) return;
    setError(null);
    try {
      const fix = await acquireFix();
      const rec = await saveCapture({
        ...captureTarget(data.v.id),
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

  // ----- navigation -----
  const goTo = (i: number) => {
    setShowSections(false);
    setScreenIndex(Math.max(0, Math.min(i, screens.length - 1)));
  };
  const toReview = async () => {
    setShowSections(false);
    await saver.flush().catch(() => undefined);
    navigation.navigate('NeedsVerificationReview', { verificationId });
  };
  const back = async () => {
    await saver.flush().catch(() => undefined);
    navigation.goBack();
  };

  // ----- render -----
  const progress = data && check && snapshot ? formProgress(snapshot, check) : null;
  const header = (
    <FormHeader
      title={data ? verificationLabel(data.v.dto) : 'Site verification'}
      subtitle={data && screen ? `Section ${screenIndex + 1} of ${screens.length} · ${screen.title}` : null}
      backLabel="‹ Back"
      backA11yLabel="Back to the site verification"
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
  if (phase.kind === 'BLOCKED' || !data || !draft || !check || !screen || !snapshot) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <FormBlockedView
          title={phase.kind === 'BLOCKED' ? phase.title : 'Form not ready'}
          message={phase.kind === 'BLOCKED' ? phase.message : 'This form has no sections.'}
          onRetry={() => void load()}
        />
      </View>
    );
  }

  const block = snapshot.blocks[screen.index];
  const sectionIssues = check.byScreen.get(screen.key);
  const siteNumber = siteNumberOfKey(screen.key);
  const site = siteNumber !== null ? data.form.form.sites.find((s) => s.siteNumber === siteNumber) ?? null : null;
  const locationIssue = sectionIssues?.find((i) => i.code === 'SITE_LOCATION_MISSING')?.message ?? null;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {header}
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {data.readOnly && (
          <View style={{ marginBottom: 12 }}>
            <InfoCallout variant="info" title={data.readOnly.title} description={data.readOnly.message} />
          </View>
        )}
        {draft.remap && !readOnly && draft.remap.dropped.length > 0 && (
          <View style={{ marginBottom: 12 }}>
            <InfoCallout variant="warning" title="Take these again" description={draft.remap.dropped.map((d) => `${d.label} (${d.reason})`).join('; ')} />
            <TouchableOpacity onPress={() => update((d) => ({ ...d, remap: null }))} accessibilityRole="button" accessibilityLabel="Dismiss this notice">
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
          timeZone={null}
          emptyText="Nothing to answer in this section."
          handlers={{
            onValue,
            onComment,
            onTakePhoto,
            onRetakePhoto,
            onRemoveCapture,
            onVoiceRecorded: (f, r) => void onVoiceRecorded(f, r),
          }}
        >
          {site ? (
            <SiteLocationCard
              site={site}
              location={draft.siteLocations.find((l) => l.siteNumber === site.siteNumber) ?? null}
              editable={!readOnly}
              busy={locating === site.siteNumber}
              onRecord={() => void recordLocation(site.siteNumber)}
              showSchool={false}
              issue={readOnly ? null : locationIssue}
            />
          ) : null}
        </FormSectionBody>
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
      <SiteEvidenceCameraModal visible={Boolean(camera)} title={camera?.title ?? 'Site verification photo'} onSubmit={(b) => void onPhotos(b)} onClose={() => setCamera(null)} />
    </View>
  );
}
