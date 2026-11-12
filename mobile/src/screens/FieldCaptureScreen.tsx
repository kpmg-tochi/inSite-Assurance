import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import type { FieldAgentSessionProfile } from '@insite/shared';
import type { MobileBaselinePack } from '../config/apiConfig';
import { enqueueLocalCapture, LocalCapturedItem } from '../storage/offline-outbox';
import { submitEvidenceForExtraction } from '../api/evidence/evidenceApi';

interface FieldCaptureScreenProps {
  session: FieldAgentSessionProfile;
  baseline: MobileBaselinePack;
  onProceedToConfirmation: (item: LocalCapturedItem) => void;
  onOpenOutbox: () => void;
  pendingSyncCount: number;
}

export function FieldCaptureScreen({
  session,
  baseline,
  onProceedToConfirmation,
  onOpenOutbox,
  pendingSyncCount,
}: FieldCaptureScreenProps) {
  const [selectedBoqId, setSelectedBoqId] = useState<string>(
    baseline.boqItems[0]?.id || ''
  );
  const [textNote, setTextNote] = useState('');
  const [isPhotoCaptured, setIsPhotoCaptured] = useState(false);
  const [isAudioRecorded, setIsAudioRecorded] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [processingAi, setProcessingAi] = useState(false);

  // Simulated Hardware GPS coordinates (along Lekki-Epe corridor at KM 14+200)
  const currentCoord = {
    latitude: 6.4678,
    longitude: 3.6189,
    accuracy: 3.4,
    chainageKm: 14.2,
    chainageLabel: 'KM 14+200',
    offsetMeters: 12.5,
    isWithinGeofence: true,
  };

  const selectedBoq = baseline.boqItems.find((b) => b.id === selectedBoqId);

  const handleSimulateShutter = () => {
    setIsPhotoCaptured(true);
    Alert.alert(
      'Live Shutter Pressed',
      'Hardware GPS (KM 14+200) & timestamp recorded. Device integrity checks passed.'
    );
  };

  const handleToggleVoiceRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      setIsAudioRecorded(true);
    } else {
      setIsRecording(true);
      setRecordingDuration(14);
      setTimeout(() => {
        setIsRecording(false);
        setIsAudioRecorded(true);
      }, 2500);
    }
  };

  const handleProcessCapture = async () => {
    if (!isPhotoCaptured && !isAudioRecorded && !textNote.trim()) {
      Alert.alert(
        'Capture Required',
        'Please capture a live photo, record a voice note, or enter a site text note.'
      );
      return;
    }

    try {
      setProcessingAi(true);

      const capturedAt = new Date().toISOString();
      const localItem = await enqueueLocalCapture({
        projectId: baseline.projectId,
        boqItemId: selectedBoq?.id,
        wbsCode: selectedBoq?.wbsCode,
        isHoldPoint: selectedBoq?.isHoldPoint,
        capturedAtDevice: capturedAt,
        latitude: currentCoord.latitude,
        longitude: currentCoord.longitude,
        gpsAccuracyMeters: currentCoord.accuracy,
        chainageKm: currentCoord.chainageKm,
        chainageLabel: currentCoord.chainageLabel,
        offsetFromCenterlineMeters: currentCoord.offsetMeters,
        isWithinGeofence: currentCoord.isWithinGeofence,
        mediaType: isPhotoCaptured ? 'SITE_PHOTO' : 'VOICE_NOTE',
        localMediaUri: isPhotoCaptured
          ? 'file:///data/user/0/insite/photos/IMG_20261112_14200.jpg'
          : undefined,
        localAudioUri: isAudioRecorded
          ? 'file:///data/user/0/insite/audio/NOTE_20261112_14200.m4a'
          : undefined,
        rawTextNote: textNote.trim() || undefined,
        rawWhisperTranscript: isAudioRecorded
          ? 'Cast twelve meters of reinforced box culvert wall at chainage fourteen plus two hundred. Forty bags of Dangote cement used. Blocker: rain delayed cell two.'
          : undefined,
        confirmedSummary:
          'Cast 12m of box culvert wall at KM 14+200. 40 bags of Dangote cement used. Blocker: rain stopped pour on cell 2.',
        extractedQuantities: selectedBoq
          ? [
              {
                wbsCode: selectedBoq.wbsCode,
                description: selectedBoq.description,
                quantity: 12,
                unit: selectedBoq.unit,
                confidence: 0.94,
              },
            ]
          : [],
      });

      onProceedToConfirmation(localItem);
    } finally {
      setProcessingAi(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Geofence Status Strip */}
      <View style={styles.telemetryCard}>
        <View style={styles.telemetryRow}>
          <View>
            <Text style={styles.projectCode}>{session.projectCodePrefix} · {session.projectName}</Text>
            <Text style={styles.agentInfo}>
              Reporter: {session.agentFullName} ({session.independenceTier.replace('_', ' ')})
            </Text>
          </View>
          <TouchableOpacity style={styles.outboxBadge} onPress={onOpenOutbox}>
            <Text style={styles.outboxBadgeText}>Outbox ({pendingSyncCount})</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.gpsBanner}>
          <View style={styles.gpsDot} />
          <Text style={styles.gpsText}>
            GPS Locked: {currentCoord.chainageLabel} · ±{currentCoord.accuracy}m · 100% Within Corridor
          </Text>
        </View>
      </View>

      {/* BOQ Task / Hold-Point Picker */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Select Active Work Scope / Hold-Point</Text>
        <Text style={styles.cardSub}>
          Tie evidence directly to a contractual Bill of Quantities item:
        </Text>

        <View style={styles.boqList}>
          {baseline.boqItems.map((item) => {
            const isSelected = item.id === selectedBoqId;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.boqItem, isSelected && styles.boqItemSelected]}
                onPress={() => setSelectedBoqId(item.id)}
              >
                <View style={styles.boqHeaderRow}>
                  <Text style={[styles.wbsCode, isSelected && styles.wbsCodeSelected]}>
                    WBS {item.wbsCode}
                  </Text>
                  {item.isHoldPoint && (
                    <View style={styles.holdPointBadge}>
                      <Text style={styles.holdPointBadgeText}>Mandatory Hold-Point</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.boqDesc} numberOfLines={2}>
                  {item.description}
                </Text>
                <Text style={styles.boqMeta}>
                  Quantity: {item.totalQuantity} {item.unit} · Certified: {item.cumulativeCertifiedPct}%
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Capture Shutter & Audio Recording Controls */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Evidence Capture Controls</Text>
        <Text style={styles.cardSub}>
          Live shutter verification only (gallery uploads blocked to prevent photo recycling).
        </Text>

        <View style={styles.captureRow}>
          {/* Live Camera Shutter */}
          <TouchableOpacity
            style={[styles.captureButton, isPhotoCaptured && styles.captureButtonDone]}
            onPress={handleSimulateShutter}
          >
            <Text style={styles.captureIcon}>{isPhotoCaptured ? '📸 ✓' : '📸'}</Text>
            <Text style={styles.captureLabel}>
              {isPhotoCaptured ? 'Photo Locked' : 'Live Camera Shutter'}
            </Text>
          </TouchableOpacity>

          {/* Voice Note Recorder */}
          <TouchableOpacity
            style={[
              styles.captureButton,
              isRecording && styles.captureButtonRecording,
              isAudioRecorded && styles.captureButtonDone,
            ]}
            onPress={handleToggleVoiceRecording}
          >
            <Text style={styles.captureIcon}>
              {isRecording ? '🔴' : isAudioRecorded ? '🎙️ ✓' : '🎙️'}
            </Text>
            <Text style={styles.captureLabel}>
              {isRecording
                ? 'Recording...'
                : isAudioRecorded
                  ? 'Voice Note Ready'
                  : 'Record Audio Note'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Text Note Input */}
        <View style={styles.textNoteContainer}>
          <Text style={styles.label}>Additional Site Observations / Blockers:</Text>
          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={3}
            placeholder="e.g. Heavy rain halted culvert concrete pouring at 15:30. 40 bags used."
            value={textNote}
            onChangeText={setTextNote}
          />
        </View>

        {/* Process & AI Extraction Button */}
        <TouchableOpacity
          style={[styles.processButton, processingAi && styles.processButtonDisabled]}
          onPress={handleProcessCapture}
          disabled={processingAi}
        >
          {processingAi ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.processButtonText}>
              Process Capture &amp; Review Extracted Quantities &rarr;
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  telemetryCard: {
    backgroundColor: '#0C233C',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  projectCode: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  agentInfo: {
    fontSize: 11,
    color: '#93C5FD',
    marginTop: 2,
  },
  outboxBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  outboxBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  gpsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 12,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  gpsText: {
    color: '#A7F3D0',
    fontSize: 11,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  cardHeader: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  cardSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 12,
  },
  boqList: {
    gap: 8,
  },
  boqItem: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#F8FAFC',
  },
  boqItemSelected: {
    borderColor: '#00338D',
    backgroundColor: '#EFF6FF',
  },
  boqHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  wbsCode: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#334155',
  },
  wbsCodeSelected: {
    color: '#00338D',
  },
  holdPointBadge: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  holdPointBadgeText: {
    color: '#DC2626',
    fontSize: 10,
    fontWeight: 'bold',
  },
  boqDesc: {
    fontSize: 12,
    color: '#1E293B',
    lineHeight: 16,
  },
  boqMeta: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 4,
  },
  captureRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  captureButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  captureButtonDone: {
    borderColor: '#10B981',
    backgroundColor: '#ECFDF5',
  },
  captureButtonRecording: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  captureIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  captureLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  textNoteContainer: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 4,
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  processButton: {
    backgroundColor: '#00338D',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  processButtonDisabled: {
    opacity: 0.6,
  },
  processButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
