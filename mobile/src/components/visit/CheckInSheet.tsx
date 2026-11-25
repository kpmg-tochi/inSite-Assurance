import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getVisit, queueCheckIn } from '../../storage/visitStore';
import { hydrateBaselinePack } from '../../storage/baselineStore';
import {
  acquireFix,
  geofenceBadgeText,
  previewGeofence,
  requestLocationPermission,
  type GeofencePreview,
  type LocationFix,
} from '../../services/locationService';
import { readHeading } from '../../services/headingService';
import { formatHeading, type HeadingReading } from '@insite/shared';
import { CHECK_IN_ALWAYS_ALLOWED_TEXT, checkInView, timeInZone, type CheckInState } from '../../utils/formUiModel';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';
import { FORM_COLORS, formStyles } from '../form/formStyles';

export interface CheckInSheetProps {
  visitId: string;
  visible: boolean;
  onClose: () => void;
  /** Called after the check-in is queued (VISIT_CHECK_IN); the caller usually opens the form next. */
  onCheckedIn: () => void;
}

type Reading = {
  fix: LocationFix | null;
  /** UBEC IRL: compass heading taken with the fix; null when the phone gave none. */
  heading: HeadingReading | null;
  preview: GeofencePreview | null;
  hasBoundary: boolean;
  permissionGranted: boolean;
};

type Phase =
  | { kind: 'LOCATING' }
  | { kind: 'READY'; reading: Reading }
  | { kind: 'SAVING'; reading: Reading }
  | { kind: 'ALREADY'; at: string; timeZone: string | null }
  | { kind: 'ERROR'; message: string };

const STATE_MARK: Record<CheckInState, string> = {
  INSIDE: '✓',
  WITHIN_TOLERANCE: '✓',
  NO_BOUNDARY: '•',
  OUTSIDE: '!',
  MOCKED: '!',
  NO_FIX: '!',
};

/**
 * Check-in (D-R5.18): a fresh fix, the local boundary preview (the server evaluates again and its
 * result counts), the distance from the site, then VISIT_CHECK_IN through the outbox. R4 takes no
 * reason: outside the boundary, without a fix or with a simulated one the officer can still check in
 * and the server flags it.
 */
export default function CheckInSheet({ visitId, visible, onClose, onCheckedIn }: CheckInSheetProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'LOCATING' });
  const run = useRef(0);

  const locate = useCallback(async () => {
    const mine = ++run.current;
    setPhase({ kind: 'LOCATING' });
    try {
      const v = await getVisit(visitId);
      if (!v) throw new Error('This visit is no longer on the phone. Refresh your visits.');
      const pack = await hydrateBaselinePack(v.projectId).catch(() => null);
      if (v.local.checkIn) {
        if (mine === run.current) setPhase({ kind: 'ALREADY', at: v.local.checkIn.checkedInAt, timeZone: pack?.timezone ?? null });
        return;
      }
      const perm = await requestLocationPermission();
      const [fix, heading] = perm.granted ? await Promise.all([acquireFix(), readHeading().catch(() => null)]) : [null, null];
      const preview = fix ? previewGeofence(fix, v.projectId) : null;
      if (mine !== run.current) return;
      setPhase({ kind: 'READY', reading: { fix, heading, preview, hasBoundary: Boolean(pack?.geofence), permissionGranted: perm.granted } });
    } catch (err) {
      if (mine === run.current) setPhase({ kind: 'ERROR', message: formatMobileErrorMessage(err) });
    }
  }, [visitId]);

  useEffect(() => {
    if (visible) void locate();
    else run.current += 1;
  }, [visible, locate]);

  const checkIn = async (reading: Reading) => {
    setPhase({ kind: 'SAVING', reading });
    try {
      await queueCheckIn(visitId, { fix: reading.fix, heading: reading.heading, preview: reading.preview });
      onCheckedIn();
    } catch (err) {
      setPhase({ kind: 'ERROR', message: formatMobileErrorMessage(err) });
    }
  };

  const reading = phase.kind === 'READY' || phase.kind === 'SAVING' ? phase.reading : null;
  const view = reading
    ? checkInView({ fix: reading.fix, preview: reading.preview, hasBoundary: reading.hasBoundary, locationPermissionGranted: reading.permissionGranted })
    : null;
  const badge = reading?.preview ? geofenceBadgeText(reading.preview.status, reading.preview.distanceOutsideMeters) : null;
  const good = view?.state === 'INSIDE' || view?.state === 'WITHIN_TOLERANCE';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close check-in" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
        <Text style={styles.title} accessibilityRole="header">
          Check in
        </Text>

        {phase.kind === 'LOCATING' && (
          <View style={styles.center}>
            <ActivityIndicator color={FORM_COLORS.brand} />
            <Text style={formStyles.meta} accessibilityLiveRegion="polite">
              Getting your position. This can take up to 15 seconds.
            </Text>
          </View>
        )}

        {phase.kind === 'ALREADY' && (
          <>
            <Text style={styles.stateTitle}>✓ Checked in on this phone at {timeInZone(phase.at, phase.timeZone)}</Text>
            <TouchableOpacity style={[formStyles.primaryButton, { marginTop: 16 }]} onPress={onCheckedIn} accessibilityRole="button">
              <Text style={formStyles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {phase.kind === 'ERROR' && (
          <>
            <Text style={formStyles.error}>{phase.message}</Text>
            <TouchableOpacity style={[formStyles.secondaryButton, { marginTop: 12, alignSelf: 'flex-start' }]} onPress={() => void locate()} accessibilityRole="button">
              <Text style={formStyles.secondaryButtonText}>Try again</Text>
            </TouchableOpacity>
          </>
        )}

        {view && reading && (
          <>
            <Text style={[styles.stateTitle, { color: good ? FORM_COLORS.ok : view.state === 'NO_BOUNDARY' ? FORM_COLORS.text : FORM_COLORS.warning }]} accessibilityLiveRegion="polite">
              {STATE_MARK[view.state]} {view.title}
            </Text>
            {badge ? <Text style={styles.badge}>Phone preview: {badge}</Text> : null}
            {view.distance ? <Text style={formStyles.meta}>{view.distance}</Text> : null}
            {view.accuracy ? <Text style={formStyles.meta}>{view.accuracy}</Text> : null}
            {reading.fix && reading.heading ? <Text style={formStyles.meta}>{formatHeading(reading.heading.degrees)}</Text> : null}
            <Text style={[formStyles.meta, { marginTop: 8 }]}>{view.note}</Text>
            <Text style={[formStyles.meta, { marginTop: 8 }]}>{CHECK_IN_ALWAYS_ALLOWED_TEXT}</Text>
            <Text style={[formStyles.meta, { marginTop: 4 }]}>The check-in is saved on the phone and sends when you are online. Once checked in, the form is fixed for this visit.</Text>

            <View style={[formStyles.row, { marginTop: 16 }]}>
              <TouchableOpacity
                style={[formStyles.primaryButton, phase.kind === 'SAVING' && formStyles.disabled]}
                disabled={phase.kind === 'SAVING'}
                onPress={() => void checkIn(reading)}
                accessibilityRole="button"
                accessibilityLabel={good ? 'Check in' : `Check in anyway: ${view.title}`}
                accessibilityState={{ disabled: phase.kind === 'SAVING', busy: phase.kind === 'SAVING' }}
              >
                <Text style={formStyles.primaryButtonText}>{phase.kind === 'SAVING' ? 'Saving…' : good || view.state === 'NO_BOUNDARY' ? 'Check in' : 'Check in anyway'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={formStyles.secondaryButton} onPress={() => void locate()} disabled={phase.kind === 'SAVING'} accessibilityRole="button" accessibilityLabel="Get the position again">
                <Text style={formStyles.secondaryButtonText}>Try again</Text>
              </TouchableOpacity>
              {!reading.permissionGranted && (
                <TouchableOpacity style={formStyles.secondaryButton} onPress={() => void Linking.openSettings()} accessibilityRole="button" accessibilityLabel="Open the phone settings to allow location">
                  <Text style={formStyles.secondaryButtonText}>Open settings</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        <TouchableOpacity onPress={onClose} style={{ marginTop: 12 }} accessibilityRole="button" accessibilityLabel="Cancel check-in">
          <Text style={formStyles.link}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20 },
  title: { fontSize: 18, fontWeight: '800', color: FORM_COLORS.text, marginBottom: 12 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  stateTitle: { fontSize: 16, fontWeight: '800', color: FORM_COLORS.text },
  badge: { fontSize: 13, fontWeight: '600', color: FORM_COLORS.text, marginTop: 6 },
});
