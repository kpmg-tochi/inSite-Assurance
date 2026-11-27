import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBadges } from '../visit/VisitUi';
import { verificationBadges, verificationScopeText, type VerificationView } from '../../utils/needsVerification';
import { formatDay } from '../../utils/visitText';

/**
 * Needs pipeline wave 5: one field verification in Home's day list, beside the monitoring visits.
 * A proposed project, not a project: "Site verification · 2027-DI-004", its title and programme,
 * the due date and how many sites and facilities, and its state as words.
 */
export function VerificationRow({ view, onOpen }: { view: VerificationView; onOpen: () => void }) {
  const badges = verificationBadges(view);
  return (
    <View style={styles.card}>
      <TouchableOpacity
        onPress={onOpen}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${view.label}, ${view.title}, due ${formatDay(view.date)}, ${badges.map((b) => b.text).join(', ')}. Open the site verification.`}
        style={styles.main}
      >
        <View style={styles.icon}>
          <Feather name="map-pin" size={16} color="#00715D" />
        </View>
        <View style={styles.texts}>
          <Text style={styles.title}>{view.label}</Text>
          <Text style={styles.subtitle}>{view.title}</Text>
          <Text style={styles.meta}>
            {view.programmeName} · due {formatDay(view.date)} · {verificationScopeText(view)}
          </Text>
          <StatusBadges badges={badges} style={styles.badges} />
        </View>
        <Feather name="chevron-right" size={18} color="#64748B" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#EEF7F4', alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 12, color: '#334155' },
  meta: { fontSize: 12, color: '#64748B' },
  badges: { marginTop: 6 },
});
