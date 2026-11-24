import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CadenceSettings } from '@insite/shared';
import { Pill } from './common';
import { colors } from '../styles/commonStyles';
import { getLoadedBaselinePack } from '../storage/baselineStore';
import { projectTimeZone } from '../storage/reportStore';
import { cadenceCopy, cadenceSettingsFromPack, dueStatus, formatCountdown, periodAt } from '../utils/projectCadence';

function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Phase 8: the current reporting period with its due countdown (or overdue state). */
export const PeriodCard: React.FC<{
  projectId: string;
  /** Phase 14: a reporting stream's settings and label (one card per stream the person owes). */
  settings?: CadenceSettings;
  label?: string | null;
}> = ({ projectId, settings: streamSettings, label }) => {
  const now = useNow();
  const settings = streamSettings ?? cadenceSettingsFromPack(getLoadedBaselinePack(projectId), projectTimeZone(projectId));
  const period = useMemo(() => periodAt(settings, now), [settings, now]);
  const copy = cadenceCopy(settings.reportingCadence);
  const due = dueStatus(period, now);

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
});
