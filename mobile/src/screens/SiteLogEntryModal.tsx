import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { GradientHeaderLayout } from '../components/common';
import { IconButton, PrimaryButton } from '../components/inputs/Buttons';
import { SiteEvidenceCameraModal, type SiteEvidenceBatchSubmission } from '../components/camera';
import { VoiceNoteRecorder, type VoiceRecordingResult } from '../components/audio';
import { SectionCard, visitUiStyles } from '../components/visit/VisitUi';
import { useActiveBranding, useProfile } from '../context/ProfileContext';
import { saveCapture } from '../storage/captureStore';
import { queueSiteLogEntry } from '../storage/siteLogStore';
import { captureCurrentGeotag, type LocationFix } from '../services/locationService';
import type { RootStackParamList } from '../navigation/types';
import { SITE_LOG_NOTE_MAX } from '../utils/siteLog';
import { formatMobileErrorMessage } from '../utils/errorFormatter';
import { PHOTO_SAFEGUARDING_HINT } from '../utils/personaCopy';
import { formatProjectCode } from '@insite/shared';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Kind = 'PHOTO' | 'VOICE' | 'NOTE';

const KIND_LABEL: Record<Kind, string> = { PHOTO: 'Photo', VOICE: 'Voice note', NOTE: 'Note' };

/** Only the hardware reading (never a substitute position). */
function fixOnly(g: LocationFix | null): LocationFix | null {
  return g
    ? { latitude: g.latitude, longitude: g.longitude, accuracyMeters: g.accuracyMeters, altitudeMeters: g.altitudeMeters, isMocked: g.isMocked, capturedAt: g.capturedAt }
    : null;
}

/**
 * Redesign R5d (D-R5.22): a new site log entry, offline. Photos come from the in-app camera only
 * (each photo carries the fix taken at its shutter, one entry per photo); a voice note and a note
 * take a fresh fix (`captureCurrentGeotag`) when the entry is saved. The capture is saved first
 * (signed, its own CAPTURE outbox row) and the SITE_LOG_ENTRY row waits for it.
 */
export function SiteLogEntryModal() {
  const navigation = useNavigation<Nav>();
  const params = useRoute<RouteProp<RootStackParamList, 'SiteLogEntry'>>().params;
  const projectId = params.projectId;
  const { projects } = useProfile();
  const { primaryColor } = useActiveBranding();
  const project = projects.find((p) => p.projectId === projectId) ?? null;
  const [kind, setKind] = useState<Kind>(params.kind);
  const [cameraOpen, setCameraOpen] = useState(params.kind === 'PHOTO');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => navigation.goBack();
  const done = (count: number, located: boolean) => {
    Toast.show({
      type: 'success',
      props: {
        title: count > 1 ? `${count} entries saved` : 'Saved to the site log',
        message: located ? 'It is sent when you are online.' : 'No location was available. It is sent when you are online.',
      },
    });
    close();
  };

  const onPhotos = async (batch: SiteEvidenceBatchSubmission) => {
    setCameraOpen(false);
    if (batch.photos.length === 0) return;
    setBusy('Saving photos…');
    setProblem(null);
    try {
      for (const photo of batch.photos) {
        const fix = fixOnly(photo.gps ?? null);
        const capture = await saveCapture({
          projectId,
          mediaType: 'SITE_PHOTO',
          sourceUri: photo.uri,
          mimeType: 'image/jpeg',
          fileExtension: 'jpg',
          caption: batch.caption || null,
          fix,
          heading: photo.heading ?? null,
          capturedAt: photo.capturedAt,
        });
        await queueSiteLogEntry({ projectId, kind: 'PHOTO', text: batch.caption || null, captureId: capture.id, fix, capturedAt: photo.capturedAt });
      }
      done(batch.photos.length, batch.photos.every((p) => Boolean(p.gps)));
    } catch (err) {
      setProblem(formatMobileErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onVoice = async (result: VoiceRecordingResult) => {
    setBusy('Getting your location…');
    setProblem(null);
    try {
      const fix = fixOnly(await captureCurrentGeotag('SITE_LOG'));
      setBusy('Saving the voice note…');
      const capturedAt = new Date().toISOString();
      const capture = await saveCapture({
        projectId,
        mediaType: 'VOICE_NOTE',
        sourceUri: result.uri,
        mimeType: result.mimeType,
        fileExtension: result.fileName.split('.').pop() || 'm4a',
        durationSeconds: result.durationMs / 1000,
        fix,
        capturedAt,
      });
      await queueSiteLogEntry({ projectId, kind: 'VOICE', text: text.trim() || null, captureId: capture.id, fix, capturedAt });
      done(1, Boolean(fix));
    } catch (err) {
      setProblem(formatMobileErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onNote = async () => {
    if (!text.trim()) {
      setProblem('Write the note.');
      return;
    }
    setBusy('Getting your location…');
    setProblem(null);
    try {
      const fix = fixOnly(await captureCurrentGeotag('SITE_LOG'));
      await queueSiteLogEntry({ projectId, kind: 'NOTE', text, fix, capturedAt: new Date().toISOString() });
      done(1, Boolean(fix));
    } catch (err) {
      setProblem(formatMobileErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <GradientHeaderLayout
        title="Site log"
        subtitle={project ? `${formatProjectCode(project.projectCodePrefix)} · ${KIND_LABEL[kind]}` : KIND_LABEL[kind]}
        rightAction={<IconButton icon="close" text="Close" onPress={close} />}
        contentContainerStyle={styles.body}
      >
        <View style={styles.segment} accessibilityRole="tablist">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => {
            const on = k === kind;
            return (
              <TouchableOpacity
                key={k}
                style={[styles.segmentItem, on && { backgroundColor: primaryColor, borderColor: primaryColor }]}
                onPress={() => {
                  setKind(k);
                  setProblem(null);
                  if (k === 'PHOTO') setCameraOpen(true);
                }}
                disabled={Boolean(busy)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{KIND_LABEL[k]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {kind === 'PHOTO' && (
          <SectionCard title="Photo" subtitle={`Taken with the in-app camera; each photo keeps the location of its shutter. ${PHOTO_SAFEGUARDING_HINT}.`}>
            <PrimaryButton text="Open the camera" onPress={() => setCameraOpen(true)} disabled={Boolean(busy)} />
          </SectionCard>
        )}

        {kind !== 'PHOTO' && (
          <SectionCard title={kind === 'NOTE' ? 'Note' : 'Note (optional)'}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={kind === 'NOTE' ? 'What did you see?' : 'Add a few words to go with the recording'}
              multiline
              maxLength={SITE_LOG_NOTE_MAX}
              accessibilityLabel={kind === 'NOTE' ? 'Note' : 'Note to go with the voice note, optional'}
            />
          </SectionCard>
        )}

        {kind === 'VOICE' && !busy && (
          <VoiceNoteRecorder submitLabel="Save to the site log" onRecordingComplete={(r) => void onVoice(r)} onCancel={close} />
        )}

        {kind === 'NOTE' && <PrimaryButton text="Save the note" onPress={() => void onNote()} isWorking={Boolean(busy)} />}

        {busy ? <Text style={visitUiStyles.muted}>{busy}</Text> : null}
        {problem ? (
          <Text style={visitUiStyles.errorText} accessibilityLiveRegion="polite">
            {problem}
          </Text>
        ) : null}
        <Text style={visitUiStyles.muted}>Saved on this phone first and sent when you are online. A voice note may get a written transcript from the server later.</Text>
      </GradientHeaderLayout>

      <SiteEvidenceCameraModal
        visible={cameraOpen}
        title={project ? `${formatProjectCode(project.projectCodePrefix)} site log` : 'Site log'}
        onSubmit={(batch) => void onPhotos(batch)}
        onClose={() => setCameraOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 40 },
  segment: { flexDirection: 'row', gap: 6 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  segmentText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  segmentTextOn: { color: '#FFFFFF' },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
});
