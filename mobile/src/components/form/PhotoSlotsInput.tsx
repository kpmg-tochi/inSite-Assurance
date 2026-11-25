import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { captureDisplayUri, type CaptureRecord } from '../../storage/captureStore';
import { PHOTO_STATUS_TEXT, type PhotoFieldModel, type PhotoSlot } from '../../utils/visitForm';
import { photoSlotText, photosLeft, type SlotTone } from '../../utils/formUiModel';
import { PHOTO_SAFEGUARDING_HINT } from '../../utils/personaCopy';
import { FORM_COLORS, formStyles } from './formStyles';

export interface PhotoSlotsInputProps {
  /** The question, for screen readers. */
  label: string;
  model: PhotoFieldModel;
  captures: Map<string, CaptureRecord>;
  readOnly: boolean;
  onTake: (slot: PhotoSlot, left: number) => void;
  onRetake: (slot: PhotoSlot, clientCaptureId: string) => void;
  onRemove: (clientCaptureId: string) => void;
  /** "Pick from site log" (D-R5.22); absent when the screen cannot offer it. */
  onPick?: (slot: PhotoSlot, left: number) => void;
}

const TONE_STYLE: Record<SlotTone, object> = {
  DONE: { color: FORM_COLORS.ok },
  NEEDED: { color: FORM_COLORS.error },
  RETAKE: { color: FORM_COLORS.error },
  OPTIONAL: { color: FORM_COLORS.muted },
};

/**
 * Photo slots (D-R5.14): one labelled slot per unit (ONE_PER_UNIT required, PER_UNIT_OPTIONAL not),
 * or one slot of at least N. Each photo shows whether it counts (a real fix, not simulated, inside the
 * boundary or its tolerance); one that does not asks for a retake. In-app camera only.
 */
export function PhotoSlotsInput({ label, model, captures, readOnly, onTake, onRetake, onRemove, onPick }: PhotoSlotsInputProps) {
  return (
    <View>
      {model.mode === 'AT_LEAST_N' && model.slots[0]?.required ? (
        <Text style={formStyles.meta}>
          At least {Math.max(1, model.minCount)}, up to {model.maxCount} photos{model.geotagRequired ? ', taken on site' : ''}.
        </Text>
      ) : model.mode !== 'AT_LEAST_N' ? (
        <Text style={formStyles.meta}>
          {model.mode === 'ONE_PER_UNIT' ? 'One photo of each unit' : 'Photos per unit, optional'}
          {model.geotagRequired ? ', taken on site' : ''}.
        </Text>
      ) : null}
      {!readOnly ? <Text style={formStyles.meta}>{PHOTO_SAFEGUARDING_HINT}.</Text> : null}
      {model.slots.map((slot) => {
        const text = photoSlotText(slot, model);
        const left = photosLeft(slot, model);
        return (
          <View key={slot.unitId ?? 'all'} style={styles.slot} accessible={false}>
            <Text style={styles.slotTitle} accessibilityRole="header">
              {text.title}
            </Text>
            <Text style={[styles.slotStatus, TONE_STYLE[text.tone]]} accessibilityLabel={`${text.title}: ${text.status}`}>
              {text.status}
            </Text>
            {slot.captures.length > 0 && (
              <View style={styles.thumbs}>
                {slot.captures.map((c, i) => {
                  const rec = captures.get(c.clientCaptureId);
                  const uri = rec ? captureDisplayUri(rec) : null;
                  const bad = c.status !== 'OK';
                  return (
                    <View key={c.clientCaptureId} style={styles.thumbBox}>
                      {uri ? (
                        <Image source={{ uri }} style={styles.thumb} accessibilityLabel={`${text.title}, photo ${i + 1}`} />
                      ) : (
                        <View style={[styles.thumb, styles.thumbEmpty]}>
                          <Text style={formStyles.meta}>{rec ? 'Sent' : 'Missing'}</Text>
                        </View>
                      )}
                      <Text style={[styles.thumbStatus, bad ? TONE_STYLE.RETAKE : TONE_STYLE.DONE]}>
                        {bad ? PHOTO_STATUS_TEXT[c.status as Exclude<typeof c.status, 'OK'>] : 'Counts'}
                      </Text>
                      {!readOnly && (
                        <View style={styles.thumbActions}>
                          {bad && (
                            <TouchableOpacity onPress={() => onRetake(slot, c.clientCaptureId)} accessibilityRole="button" accessibilityLabel={`Retake photo ${i + 1} of ${text.title}`}>
                              <Text style={styles.action}>Retake</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity onPress={() => onRemove(c.clientCaptureId)} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1} of ${text.title}`}>
                            <Text style={styles.action}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
            {!readOnly && left > 0 && (
              <View style={formStyles.row}>
                <TouchableOpacity
                  style={formStyles.secondaryButton}
                  onPress={() => onTake(slot, left)}
                  accessibilityRole="button"
                  accessibilityLabel={`Take a photo for ${label}, ${text.title}`}
                >
                  <Text style={formStyles.secondaryButtonText}>{slot.captures.length ? 'Add photo' : 'Take photo'}</Text>
                </TouchableOpacity>
                {onPick && (
                  <TouchableOpacity
                    style={formStyles.secondaryButton}
                    onPress={() => onPick(slot, left)}
                    accessibilityRole="button"
                    accessibilityLabel={`Pick a site log photo for ${label}, ${text.title}`}
                  >
                    <Text style={formStyles.secondaryButtonText}>Pick from site log</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 10, marginTop: 10 },
  slotTitle: { fontSize: 13, fontWeight: '700', color: FORM_COLORS.text },
  slotStatus: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  thumbBox: { width: 104 },
  thumb: { width: 104, height: 78, borderRadius: 10, backgroundColor: '#E2E8F0' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbStatus: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  thumbActions: { flexDirection: 'row', gap: 12, marginTop: 2 },
  action: { color: FORM_COLORS.brand, fontWeight: '700', fontSize: 12, paddingVertical: 6 },
});
