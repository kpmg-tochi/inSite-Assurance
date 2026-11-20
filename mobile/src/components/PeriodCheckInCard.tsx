import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { formatDueLabel, type CadenceSettings } from '@insite/shared';
import { Pill } from './common';
import { colors } from '../styles/commonStyles';
import { getLoadedBaselinePack } from '../storage/baselineStore';
import { projectTimeZone } from '../storage/reportStore';
import { cadenceCopy, cadenceSettingsFromPack, dueStatus, formatCountdown, periodAt } from '../utils/projectCadence';
import { useManualCheckInMutation, useTodayCheckInQuery } from '../queries/telemetry/useCheckInQueries';

function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Phase 8: the current reporting period with its due countdown (or overdue state), and today's
 * check-in. The check-in result shown is the server's geofence evaluation, never a local guess.
 */
export const PeriodCheckInCard: React.FC<{
  projectId: string;
  canCheckIn: boolean;
  /** Phase 14: a reporting stream's settings and label (one card per stream the person owes). */
  settings?: CadenceSettings;
  label?: string | null;
  /** Only the first card shows today's check-in. */
  showCheckIn?: boolean;
}> = ({ projectId, canCheckIn, settings: streamSettings, label, showCheckIn = true }) => {
  const now = useNow();
  const settings = streamSettings ?? cadenceSettingsFromPack(getLoadedBaselinePack(projectId), projectTimeZone(projectId));
  const period = useMemo(() => periodAt(settings, now), [settings, now]);
  const copy = cadenceCopy(settings.reportingCadence);
  const due = dueStatus(period, now);
  const checkIn = useTodayCheckInQuery(projectId);
  const doCheckIn = useManualCheckInMutation(projectId);
  const [message, setMessage] = useState<string | null>(null);

  const status = checkIn.data;
  const lastManual = status?.lastManualCheckIn;
  const checkInText = checkIn.isError
    ? 'Check-in status unavailable offline.'
    : !status
      ? 'Checking today’s check-in…'
      : status.checkedIn
        ? `Checked in at ${formatDueLabel(status.checkedInAt!, settings.timezone).slice(4)}`
        : lastManual && lastManual.isWithinGeofence === false
          ? 'Your last check-in was outside the site boundary.'
          : status.isWorkday
            ? 'Not checked in today.'
            : 'Not a working day.';

  const onCheckIn = async () => {
    setMessage(null);
    try {
      const r = await doCheckIn.mutateAsync();
      setMessage(r.recorded ? 'Check-in saved. It is confirmed once it reaches the server.' : r.reason ?? 'Could not check in.');
    } catch (err) {
      setMessage((err as Error)?.message || 'Could not check in.');
    }
  };

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.row}>
        <Text style={styles.heading}>{label ? `${label} · ${copy.reportNoun}` : copy.deliverablesHeading}</Text>
        {due && <Pill variant={due.overdue ? 'negative' : 'info'} text={due.label} />}
      </View>
      <Text style={styles.sub}>
        {period.start === period.end ? period.start : `${period.start} to ${period.end}`}
        {due && !due.overdue ? ` · ${formatCountdown(due.minutesLeft)}` : ''}
        {due?.overdue ? ` · send your ${copy.reportNoun.toLowerCase()} now; it will be marked late` : ''}
        {!due ? ' · no due time (inspections only)' : ''}
      </Text>
      {showCheckIn && (
      <View style={[styles.row, styles.checkInRow]}>
        <View style={styles.checkInStatus}>
          <Feather
            name={status?.checkedIn ? 'check-circle' : 'map-pin'}
            size={14}
            color={status?.checkedIn ? colors.green : colors.secondaryText}
          />
          <Text style={styles.checkInText}>{checkInText}</Text>
        </View>
        {canCheckIn && !status?.checkedIn && (
          <TouchableOpacity
            style={styles.button}
            onPress={onCheckIn}
            disabled={doCheckIn.isPending}
            accessibilityRole="button"
            accessibilityLabel="Check in on site"
          >
            {doCheckIn.isPending ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.buttonText}>Check in on site</Text>}
          </TouchableOpacity>
        )}
      </View>
      )}
      {showCheckIn && message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heading: { fontSize: 14, fontWeight: '700', color: colors.primaryText },
  sub: { fontSize: 12, color: colors.secondaryText },
  checkInRow: { marginTop: 6 },
  checkInStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  checkInText: { fontSize: 12, color: colors.primaryText, flexShrink: 1 },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  buttonText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  message: { fontSize: 11, color: colors.secondaryText },
});
