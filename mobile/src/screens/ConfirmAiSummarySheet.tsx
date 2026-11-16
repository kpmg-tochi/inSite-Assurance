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
import { useSubmitWorkdayReportMutation } from '../queries/wbs/useWbsQueries';
import {
  captureCurrentGeotag,
  type SiteGeotag,
} from '../services/locationService';
import {
  VoiceNoteRecorder,
  formatDurationMs,
  type VoiceRecordingResult,
} from '../components/audio';
import type { RootStackParamList } from '../navigation/types';

export const ConfirmAiSummarySheet: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'EodConfirmModal'>>();
  const { wbsItem } = route.params;
  const {
    activeProjectId: projectId,
    profile,
    isVerified: isVerifiedAccount,
  } = useProfile();

  const senderName = profile?.fullName || 'Field Engineer';
  const onCancel = () => navigation.goBack();
  const onConfirmed = (_quantity: number, _summary: string) => navigation.goBack();
  const insets = useSafeAreaInsets();
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState(wbsItem.unit || 'm3');
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const [holdPointSigned, setHoldPointSigned] = useState(!wbsItem.isHoldPoint);

  const [geotag, setGeotag] = useState<SiteGeotag | null>(null);
  const [loadingGps, setLoadingGps] = useState(true);
  const submitReportMutation = useSubmitWorkdayReportMutation(projectId);
  const isSubmitting = submitReportMutation.isPending;

  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [eodVoiceNote, setEodVoiceNote] = useState<VoiceRecordingResult | null>(
    null
  );

  const refreshSubmissionGeotag = useCallback(async () => {
    setLoadingGps(true);
    try {
      const captured = await captureCurrentGeotag(
        `REPORT_SUBMISSION:${wbsItem.wbsCode}`
      );
      setGeotag(captured);
      return captured;
    } finally {
      setLoadingGps(false);
    }
  }, [wbsItem.wbsCode]);

  useEffect(() => {
    refreshSubmissionGeotag();
  }, [refreshSubmissionGeotag]);

  const handleConfirm = async () => {
    const qNum = parseFloat(quantity);
    if (isNaN(qNum) || qNum <= 0) {
      Toast.show({
        type: 'error',
        props: {
          title: 'Invalid Quantity',
          message: 'Please enter a valid positive quantity.',
        },
      });
      return;
    }

    try {
      const activeGeotag = geotag ?? (await refreshSubmissionGeotag());
      if (!activeGeotag) {
        Toast.show({
          type: 'error',
          props: {
            title: 'Site Geotag Required',
            message:
              'Location permission or GPS lock is needed to prove this daily report was submitted from the field.',
          },
        });
        return;
      }

      const result = await submitReportMutation.mutateAsync({
        projectId,
        wbsItem,
        senderName,
        reportedQuantity: qNum,
        unitOfMeasure: unit.trim() || wbsItem.unit || 'm3',
        summaryText: summary.trim(),
        delaysOrBlockers: blockers.trim() || undefined,
        isHoldPointClaimed: holdPointSigned,
        voiceNoteUri: eodVoiceNote?.uri ?? null,
        submissionGeotag: activeGeotag,
        isVerifiedAccount,
      });

      if (result.syncStatus === 'STAGED_UNVERIFIED') {
        Toast.show({
          type: 'info',
          props: {
            title: 'Staged in Unverified Backlog',
            message:
              'Your report and GPS provenance are saved locally. AI parsing and server sync will run once your assurance verification is approved.',
          },
        });
      } else if (result.syncStatus === 'QUEUED_OFFLINE') {
        Toast.show({
          type: 'info',
          props: {
            title: 'Saved Offline with Geotag',
            message:
              'Your signed report and submission GPS coordinates are stored locally and will sync automatically when network connectivity returns.',
          },
        });
      } else {
        Toast.show({
          type: 'success',
          props: {
            title: 'Report Synced',
            message: 'Your signed workday report has been synced to the project ledger.',
          },
        });
      }

      onConfirmed(qNum, summary.trim());
    } catch (err: any) {
      Toast.show({
        type: 'error',
        props: {
          title: 'Submission Failed',
          message: err?.message || 'Unable to save daily report.',
        },
      });
    }
  };

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
          <TouchableOpacity onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Pill variant="positive" text="Human Sign-Off Required" />
        </View>
        <Text style={styles.title}>Confirm AI Daily Summary</Text>
        <Text style={styles.subtitle}>
          Review and edit the extracted quantities before syncing to the reconciliation ledger.
        </Text>
      </LinearGradient>

      <View style={styles.curvedContainer}>
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: Math.max(insets.bottom + 20, 24) },
          ]}
          showsVerticalScrollIndicator={false}
        >
        {/* WBS Target Card */}
        <View style={styles.card}>
          <Pill variant="info" text={`WBS ${wbsItem.wbsCode}`} />
          <Text style={styles.wbsTitle}>{wbsItem.description}</Text>
        </View>

        {/* AI Parsed Summary Card */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Workday Summary *</Text>
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            value={summary}
            onChangeText={setSummary}
            multiline
          />
        </View>

        {/* Quantities Form */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Reported Quantity for Today *</Text>
          <View style={styles.quantityRow}>
            <TextInput
              style={[styles.input, styles.quantityInput]}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.unitInput]}
              value={unit}
              onChangeText={setUnit}
            />
          </View>

          {/* Hold-point Checkbox */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setHoldPointSigned(!holdPointSigned)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, holdPointSigned && styles.checkboxActive]}>
              {holdPointSigned && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              I certify that rebar bar-bending schedule and invert levels complied with Hold-Point
              standards.
            </Text>
          </TouchableOpacity>
        </View>

        {/* Delays & Blockers */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Site Blockers &amp; Weather Notes</Text>
          <TextInput
            style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
            value={blockers}
            onChangeText={setBlockers}
            multiline
          />
        </View>

        {/* Optional EOD Voice Summary */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.fieldLabel}>EOD Voice Summary (Optional)</Text>
            {!showVoiceRecorder && (
              <TouchableOpacity
                onPress={() => setShowVoiceRecorder(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.linkActionText}>
                  {eodVoiceNote ? 'Re-record Voice Note' : '+ Record Voice Note'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {showVoiceRecorder ? (
            <VoiceNoteRecorder
              submitLabel="Attach EOD Voice Note"
              onRecordingComplete={(res) => {
                setEodVoiceNote(res);
                setShowVoiceRecorder(false);
              }}
              onCancel={() => setShowVoiceRecorder(false)}
            />
          ) : eodVoiceNote ? (
            <View style={styles.voiceAttachedPill}>
              <Text style={styles.voiceAttachedText}>
                Voice note attached ({formatDurationMs(eodVoiceNote.durationMs)})
              </Text>
              <TouchableOpacity onPress={() => setEodVoiceNote(null)}>
                <Text style={styles.removeVoiceText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.helperText}>
              Record a spoken site wrap-up in English or Pidgin to accompany your daily report.
            </Text>
          )}
        </View>

        {/* Submission Geotag Provenance Card */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.fieldLabel}>Submission Geotag Provenance</Text>
            <TouchableOpacity
              onPress={refreshSubmissionGeotag}
              disabled={loadingGps}
              activeOpacity={0.8}
            >
              <Text style={styles.linkActionText}>
                {loadingGps ? 'Locating...' : 'Refresh GPS'}
              </Text>
            </TouchableOpacity>
          </View>

          {loadingGps ? (
            <View style={styles.gpsLoadingRow}>
              <ActivityIndicator size="small" color="#00338D" />
              <Text style={styles.helperText}>Acquiring high-accuracy field coordinates...</Text>
            </View>
          ) : geotag ? (
            <View style={styles.gpsInfoBox}>
              <Text style={styles.gpsCoordsText}>
                {geotag.latitude.toFixed(5)}, {geotag.longitude.toFixed(5)}
                {geotag.accuracyMeters !== null
                  ? ` (±${Math.round(geotag.accuracyMeters)}m)`
                  : ''}
              </Text>
              <Text
                style={[
                  styles.gpsStatusText,
                  geotag.isMocked || geotag.isWithinGeofence === false
                    ? styles.gpsWarnText
                    : styles.gpsOkText,
                ]}
              >
                {geotag.isMocked
                  ? 'Mock GPS detected — flagged for monitor review'
                  : geotag.isWithinGeofence === false
                  ? 'Outside project geofence — submission location will be flagged'
                  : geotag.chainageLabel
                  ? `Verified at ${geotag.chainageLabel}`
                  : 'Field coordinates locked & SHA-256 signed'}
              </Text>
            </View>
          ) : (
            <Text style={styles.gpsWarnText}>
              GPS unavailable. Enable location services and tap Refresh GPS before submitting.
            </Text>
          )}
        </View>

        <PrimaryButton
          onPress={handleConfirm}
          text="Sign Off & Sync Report"
          isWorking={isSubmitting}
          disabled={isSubmitting}
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

