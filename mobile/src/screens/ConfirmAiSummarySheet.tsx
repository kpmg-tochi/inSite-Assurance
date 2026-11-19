import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pill } from '../components/common';
import { PrimaryButton } from '../components/inputs/Buttons';
import { useProfile } from '../context/ProfileContext';
import { useResolveNotificationMutation } from '../queries/notifications/useNotificationQueries';
import { useSubmitWorkdayReportMutation } from '../queries/wbs/useWbsQueries';
import { REPORT_LOW_GPS_ACCURACY_METERS } from '@insite/shared';
import {
  acquireFix,
  previewGeofence,
  type GeofencePreview,
  type LocationFix,
} from '../services/locationService';
import { saveCapture } from '../storage/captureStore';
import { ReportAlreadySubmittedError } from '../storage/reportStore';
import { StorageUnavailableError } from '../storage/db/database';
import { VoiceNoteRecorder, formatDurationMs, type VoiceRecordingResult } from '../components/audio';
import type { RootStackParamList } from '../navigation/types';

/**
 * The end-of-period report (owner rule 2026-11-19): one per WBS item and period, built from the
 * photos and notes already in the thread plus this summary and an optional voice note. The
 * reporter must confirm it is their full report. After submitting, it can only be revised to
 * answer a query.
 */
export const ConfirmAiSummarySheet: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'EodConfirmModal'>>();
  const { wbsItem, resolveNotificationId, workdayReportId, reportQueryId, initialSummary, initialQuantity, initialUnit } =
    route.params;
  const isRevision = Boolean(workdayReportId);
  const { activeProjectId: projectId } = useProfile();
  const insets = useSafeAreaInsets();

  const [quantity, setQuantity] = useState(
    initialQuantity !== undefined && !isNaN(initialQuantity) ? String(initialQuantity) : ''
  );
  const [unit, setUnit] = useState(initialUnit || wbsItem.unit);
  const [summary, setSummary] = useState(initialSummary || '');
  const [blockers, setBlockers] = useState('');
  // Off by default and shown only for hold-point items.
  const [holdPointClaimed, setHoldPointClaimed] = useState(false);
  const [confirmedFinal, setConfirmedFinal] = useState(false);

  const [fix, setFix] = useState<LocationFix | null>(null);
  const [preview, setPreview] = useState<GeofencePreview | null>(null);
  const [loadingGps, setLoadingGps] = useState(true);
  const submitReport = useSubmitWorkdayReportMutation(projectId);
  const resolveNotification = useResolveNotificationMutation(projectId);
  const [saving, setSaving] = useState(false);

  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceNote, setVoiceNote] = useState<VoiceRecordingResult | null>(null);

  const refreshFix = useCallback(async () => {
    setLoadingGps(true);
    try {
      const next = await acquireFix();
      setFix(next);
      setPreview(next ? previewGeofence(next) : null);
      return next;
    } finally {
      setLoadingGps(false);
    }
  }, []);

  useEffect(() => {
    void refreshFix();
  }, [refreshFix]);

  const showError = (title: string, message: string) => Toast.show({ type: 'error', props: { title, message } });

  const handleConfirm = async () => {
    const qNum = parseFloat(quantity);
    if (isNaN(qNum) || qNum < 0) {
      showError('Quantity needed', 'Enter the quantity completed this period (0 if none).');
      return;
    }
    if (summary.trim().length < 5) {
      showError('Summary needed', 'Describe the work done this period.');
      return;
    }
    if (!fix) {
      showError('Location required', 'Every report needs a GPS location. Move to open sky and tap Refresh.');
      return;
    }
    if (!confirmedFinal) {
      showError('Confirm your full report', 'Tick the box to confirm this is your full report for the period.');
      return;
    }

    setSaving(true);
    try {
      // The voice note is a capture like any other, so it is uploaded and verified with the report.
      if (voiceNote) {
        await saveCapture({
          projectId,
          wbsItemId: wbsItem.id,
          mediaType: 'VOICE_NOTE',
          sourceUri: voiceNote.uri,
          mimeType: voiceNote.mimeType,
          fileExtension: voiceNote.fileName.split('.').pop() || 'm4a',
          durationSeconds: voiceNote.durationMs / 1000,
          fix,
          capturedAt: new Date().toISOString(),
        });
      }

      const report = await submitReport.mutateAsync({
        projectId,
        wbsItemId: wbsItem.id,
        summaryText: summary.trim(),
        reportedQuantity: qNum,
        unit: unit.trim() || wbsItem.unit,
        isHoldPointClaimed: wbsItem.isHoldPoint && holdPointClaimed,
        delaysOrBlockers: blockers.trim() || null,
        fix,
        revision: workdayReportId ? { serverReportId: workdayReportId, reportQueryId: reportQueryId ?? null } : undefined,
      });

      Toast.show({
        type: 'success',
        props: {
          title: isRevision ? 'Revision saved' : 'Report saved',
          message: `Saved on this device with ${report.captureIds.length} capture(s) and ${report.textNotes.length} note(s). It will be sent as soon as there is a connection; check Sync status for progress.`,
        },
      });
      if (resolveNotificationId) {
        await resolveNotification.mutateAsync(resolveNotificationId).catch(() => undefined);
      }
      navigation.goBack();
    } catch (err) {
      if (err instanceof ReportAlreadySubmittedError) {
        showError('Already submitted', err.message);
      } else if (err instanceof StorageUnavailableError) {
        showError('Cannot save on this device', err.message);
      } else {
        showError('Not saved', (err as Error)?.message || 'The report could not be saved. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const lowAccuracy = fix?.accuracyMeters != null && fix.accuracyMeters > REPORT_LOW_GPS_ACCURACY_METERS;
  const gpsLine = !fix
    ? 'No GPS location yet. A location is required to submit. Move to open sky and tap Refresh.'
    : fix.isMocked
      ? 'Mock location detected. The report will be flagged for review.'
      : preview?.isWithinGeofence === false
        ? 'Outside the project geofence (checked again by the server).'
        : preview?.isWithinGeofence === true
          ? `Inside the project geofence${preview.chainageLabel ? ` at ${preview.chainageLabel}` : ''} (checked again by the server).`
          : 'Geofence not available on this device; the server will check it.';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#0891B2', '#1E3A8A', '#312E81', '#1E1B4B']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Pill variant="info" text={isRevision ? 'Answering a query' : 'One report per period'} />
        </View>
        <Text style={styles.title}>{isRevision ? 'Revise your report' : 'Submit your daily report'}</Text>
        <Text style={styles.subtitle}>
          {isRevision
            ? 'Your revision includes any new photos and notes you added to the thread.'
            : 'Your report includes every photo, voice note and note you added to this thread today. You cannot submit another report for this item today.'}
        </Text>
      </LinearGradient>

      <View style={styles.curvedContainer}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 20, 24) }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Pill variant="info" text={`WBS ${wbsItem.wbsCode}`} />
            <Text style={styles.wbsTitle}>{wbsItem.description}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Summary of work *</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              value={summary}
              onChangeText={setSummary}
              multiline
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Quantity completed this period *</Text>
            <View style={styles.quantityRow}>
              <TextInput
                style={[styles.input, styles.quantityInput]}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
              />
              <TextInput style={[styles.input, styles.unitInput]} value={unit} onChangeText={setUnit} />
            </View>

            {wbsItem.isHoldPoint && (
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setHoldPointClaimed(!holdPointClaimed)}
                activeOpacity={0.8}
              >
                <View style={[styles.checkbox, holdPointClaimed && styles.checkboxActive]}>
                  {holdPointClaimed && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>
                  Hold point: {wbsItem.holdPointInstruction || 'I confirm this hold point was inspected and met.'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Delays, blockers and weather</Text>
            <TextInput
              style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
              value={blockers}
              onChangeText={setBlockers}
              multiline
            />
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldLabel}>Voice note (optional)</Text>
              {!showVoiceRecorder && (
                <TouchableOpacity onPress={() => setShowVoiceRecorder(true)} activeOpacity={0.8}>
                  <Text style={styles.linkActionText}>{voiceNote ? 'Re-record' : '+ Record voice note'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {showVoiceRecorder ? (
              <VoiceNoteRecorder
                submitLabel="Attach voice note"
                onRecordingComplete={(res) => {
                  setVoiceNote(res);
                  setShowVoiceRecorder(false);
                }}
                onCancel={() => setShowVoiceRecorder(false)}
              />
            ) : voiceNote ? (
              <View style={styles.voiceAttachedPill}>
                <Text style={styles.voiceAttachedText}>
                  Voice note attached ({formatDurationMs(voiceNote.durationMs)})
                </Text>
                <TouchableOpacity onPress={() => setVoiceNote(null)}>
                  <Text style={styles.removeVoiceText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.helperText}>Record a spoken wrap-up in English or Pidgin.</Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldLabel}>Location at submission</Text>
              <TouchableOpacity onPress={refreshFix} disabled={loadingGps} activeOpacity={0.8}>
                <Text style={styles.linkActionText}>{loadingGps ? 'Locating...' : 'Refresh'}</Text>
              </TouchableOpacity>
            </View>
            {loadingGps ? (
              <View style={styles.gpsLoadingRow}>
                <ActivityIndicator size="small" color="#00338D" />
                <Text style={styles.helperText}>Getting a GPS fix...</Text>
              </View>
            ) : (
              <View style={styles.gpsInfoBox}>
                {fix && (
                  <Text style={styles.gpsCoordsText}>
                    {fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)}
                    {fix.accuracyMeters !== null ? ` (±${Math.round(fix.accuracyMeters)}m)` : ''}
                    {lowAccuracy ? ' · low accuracy, the report will show a badge' : ''}
                  </Text>
                )}
                <Text
                  style={[
                    styles.gpsStatusText,
                    !fix || fix.isMocked || preview?.isWithinGeofence === false ? styles.gpsWarnText : styles.gpsOkText,
                  ]}
                >
                  {gpsLine}
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.card, styles.checkboxRow]}
            onPress={() => setConfirmedFinal(!confirmedFinal)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, confirmedFinal && styles.checkboxActive]}>
              {confirmedFinal && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              {isRevision
                ? 'This revision is my full answer to the query.'
                : 'This is my full report for today. I understand I cannot submit another one for this item today.'}
            </Text>
          </TouchableOpacity>

          <PrimaryButton
            onPress={handleConfirm}
            text={isRevision ? 'Submit revision' : 'Submit report'}
            isWorking={saving}
            disabled={saving || !confirmedFinal || !fix}
          />
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  curvedContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -16,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cancelText: {
    fontSize: 13,
    color: '#93C5FD',
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11,
    color: '#BFDBFE',
    marginTop: 4,
    lineHeight: 16,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  wbsTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  wbsTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00338D',
  },
  wbsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  quantityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quantityInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#00338D',
  },
  unitInput: {
    width: 100,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: '#0F172A',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: '#00338D',
    borderColor: '#00338D',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 11,
    color: '#334155',
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#00338D',
  },
  helperText: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
  },
  voiceAttachedPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  voiceAttachedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00338D',
  },
  removeVoiceText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  gpsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gpsInfoBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 3,
  },
  gpsCoordsText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  gpsStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  gpsOkText: {
    color: '#065F46',
  },
  gpsWarnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
});

