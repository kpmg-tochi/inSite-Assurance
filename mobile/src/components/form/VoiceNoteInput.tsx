import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { VisitFormCaptureRef } from '@insite/shared';
import { VoiceNoteBubble, VoiceNoteRecorder, type VoiceRecordingResult } from '../audio';
import { captureDisplayUri, type CaptureRecord } from '../../storage/captureStore';
import { timeInZone } from '../../utils/formUiModel';
import { FORM_COLORS, formStyles } from './formStyles';

export interface VoiceNoteInputProps {
  label: string;
  required: boolean;
  audio: VisitFormCaptureRef[];
  captures: Map<string, CaptureRecord>;
  readOnly: boolean;
  /** The project zone, for the recording time. */
  timeZone: string | null;
  onRecorded: (result: VoiceRecordingResult) => void;
  onRemove: (clientCaptureId: string) => void;
}

/**
 * VOICE_NOTE: one or more recordings. The transcript appears under a note only when the server
 * produced one (D-R5.13, Whisper after upload); the phone never writes one.
 */
export function VoiceNoteInput({ label, required, audio, captures, readOnly, timeZone, onRecorded, onRemove }: VoiceNoteInputProps) {
  const [recording, setRecording] = useState(false);
  return (
    <View>
      {audio.length === 0 && <Text style={[formStyles.meta, required && { color: FORM_COLORS.error }]}>{required ? 'Needed: record a voice note' : 'No voice note yet'}</Text>}
      {audio.map((a, i) => {
        const rec = captures.get(a.clientCaptureId);
        const uri = rec ? captureDisplayUri(rec) ?? undefined : undefined;
        const transcript = rec?.server?.transcriptionStatus === 'DONE' && rec.server.transcript ? rec.server.transcript : null;
        return (
          <View key={a.clientCaptureId} style={styles.note}>
            <VoiceNoteBubble
              senderName="You"
              audioUri={uri}
              durationMs={rec?.durationSeconds ? rec.durationSeconds * 1000 : 0}
              timestamp={rec ? timeInZone(rec.capturedAt, timeZone) : ''}
            />
            {!rec && <Text style={formStyles.error}>This voice note is no longer on the phone: record it again</Text>}
            {transcript ? (
              <Text style={styles.transcript} accessibilityLabel={`Transcript of voice note ${i + 1}: ${transcript}`}>
                Transcript: {transcript}
              </Text>
            ) : null}
            {!readOnly && (
              <TouchableOpacity onPress={() => onRemove(a.clientCaptureId)} accessibilityRole="button" accessibilityLabel={`Remove voice note ${i + 1} of ${label}`}>
                <Text style={formStyles.link}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
      {!readOnly &&
        (recording ? (
          <VoiceNoteRecorder
            submitLabel="Use this voice note"
            onRecordingComplete={(res) => {
              setRecording(false);
              onRecorded(res);
            }}
            onCancel={() => setRecording(false)}
          />
        ) : (
          <View style={formStyles.row}>
            <TouchableOpacity style={formStyles.secondaryButton} onPress={() => setRecording(true)} accessibilityRole="button" accessibilityLabel={`Record a voice note for ${label}`}>
              <Text style={formStyles.secondaryButtonText}>{audio.length ? 'Record another' : 'Record voice note'}</Text>
            </TouchableOpacity>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: 10 },
  transcript: { fontSize: 13, color: FORM_COLORS.text, marginTop: 6, fontStyle: 'italic' },
});
