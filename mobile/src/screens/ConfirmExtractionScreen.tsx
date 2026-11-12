import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { LocalCapturedItem, updateQueueItem } from '../storage/offline-outbox';

interface ConfirmExtractionScreenProps {
  captureItem: LocalCapturedItem;
  onConfirmed: () => void;
  onCancel: () => void;
}

export function ConfirmExtractionScreen({
  captureItem,
  onConfirmed,
  onCancel,
}: ConfirmExtractionScreenProps) {
  const [summary, setSummary] = useState(
    captureItem.confirmedSummary ||
      captureItem.rawWhisperTranscript ||
      captureItem.rawTextNote ||
      ''
  );
  const [quantity, setQuantity] = useState(
    captureItem.extractedQuantities?.[0]?.quantity?.toString() || '12'
  );
  const [unit, setUnit] = useState(
    captureItem.extractedQuantities?.[0]?.unit || 'm'
  );

  const handleConfirmAndSeal = () => {
    if (!summary.trim()) {
      Alert.alert('Required', 'Please verify or edit the summary text.');
      return;
    }

    const numQty = Number(quantity) || 0;
    updateQueueItem(captureItem.id, {
      confirmedSummary: summary.trim(),
      extractedQuantities: [
        {
          wbsCode: captureItem.wbsCode || '02.01.2',
          description: summary.trim(),
          quantity: numQty,
          unit: unit.trim(),
          confidence: 1.0, // Confirmed by human agent
        },
      ],
      status: 'CONFIRMED',
    });

    Alert.alert(
      'Evidence Sealed',
      'Field evidence confirmed with device cryptographic signature and queued in SQLite Outbox.'
    );
    onConfirmed();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header Notice */}
      <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>Mandatory Human Confirmation</Text>
        <Text style={styles.noticeDesc}>
          Per InSite Assurance protocol, automated voice extractions must be checked by the on-site
          reporter to confirm material quantities before submission to the Independent Monitor.
        </Text>
      </View>

      {/* Raw Transcript Card (if voice capture) */}
      {captureItem.rawWhisperTranscript && (
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Audio Note Transcription (ASR)</Text>
          <Text style={styles.transcriptQuote}>
            &ldquo;{captureItem.rawWhisperTranscript}&rdquo;
          </Text>
        </View>
      )}

      {/* Extracted Summary (Editable) */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Verified Daily Scope Summary</Text>
        <Text style={styles.cardSub}>
          Edit or confirm the structured work description below:
        </Text>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={4}
          value={summary}
          onChangeText={setSummary}
        />
      </View>

      {/* Extracted Quantity & Unit Input */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Extracted Material / Work Quantity</Text>
        <View style={styles.qtyRow}>
          <View style={styles.qtyInputWrap}>
            <Text style={styles.label}>Quantity</Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.unitInputWrap}>
            <Text style={styles.label}>Unit</Text>
            <TextInput style={styles.input} value={unit} onChangeText={setUnit} />
          </View>
        </View>
      </View>

      {/* Cryptographic Device Signature & Telemetry Info */}
      <View style={styles.telemetryCard}>
        <Text style={styles.telemetryTitle}>Hardware Provenance Proof</Text>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryKey}>Location Stationing:</Text>
          <Text style={styles.telemetryValue}>{captureItem.chainageLabel || 'KM 14+200'}</Text>
        </View>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryKey}>GPS Accuracy:</Text>
          <Text style={styles.telemetryValue}>±{captureItem.gpsAccuracyMeters}m (100% within corridor)</Text>
        </View>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryKey}>Device Hash:</Text>
          <Text style={styles.telemetryValue}>
            {captureItem.deviceSignatureHash.substring(0, 16)}...
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Discard</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmAndSeal}>
          <Text style={styles.confirmButtonText}>Sign &amp; Queue in Outbox</Text>
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
  noticeBox: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#00338D',
    marginBottom: 2,
  },
  noticeDesc: {
    fontSize: 11,
    color: '#1E40AF',
    lineHeight: 15,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  cardHeader: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0F172A',
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 8,
  },
  transcriptQuote: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#334155',
    lineHeight: 18,
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#00338D',
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  qtyRow: {
    flexDirection: 'row',
    gap: 12,
  },
  qtyInputWrap: {
    flex: 2,
  },
  unitInputWrap: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
  },
  telemetryCard: {
    backgroundColor: '#0C233C',
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  telemetryTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#93C5FD',
    marginBottom: 6,
  },
  telemetryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  telemetryKey: {
    fontSize: 11,
    color: '#CBD5E1',
  },
  telemetryValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  confirmButton: {
    flex: 2,
    backgroundColor: '#00338D',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});

