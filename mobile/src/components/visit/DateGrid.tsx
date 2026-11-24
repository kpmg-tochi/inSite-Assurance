import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useActiveBranding } from '../../context/ProfileContext';
import { addMonths, monthGrid, monthOf } from '../../utils/visitCalendar';
import { formatLongDay, monthTitle, WEEKDAY_INITIALS } from '../../utils/visitText';

/**
 * Redesign R5b: a plain month grid to pick one date (no date-picker dependency, D-R5.1). Dates the
 * caller refuses are shown struck through and announced as unavailable.
 */
export function DateGrid({
  initialDate,
  selected,
  onSelect,
  isEnabled,
}: {
  initialDate: string;
  selected: string | null;
  onSelect: (date: string) => void;
  isEnabled: (date: string) => boolean;
}) {
  const { primaryColor } = useActiveBranding();
  const [month, setMonth] = useState(monthOf(selected ?? initialDate));
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.nav} onPress={() => setMonth(addMonths(month, -1))} accessibilityRole="button" accessibilityLabel="Previous month">
          <Feather name="chevron-left" size={18} color="#334155" />
        </TouchableOpacity>
        <Text style={styles.title}>{monthTitle(month)}</Text>
        <TouchableOpacity style={styles.nav} onPress={() => setMonth(addMonths(month, 1))} accessibilityRole="button" accessibilityLabel="Next month">
          <Feather name="chevron-right" size={18} color="#334155" />
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        {WEEKDAY_INITIALS.map((d, i) => (
          <Text key={i} style={styles.initial} importantForAccessibility="no">
            {d}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week) => (
        <View key={week[0].date} style={styles.row}>
          {week.map(({ date, inMonth }) => {
            const enabled = inMonth && isEnabled(date);
            const isSelected = date === selected;
            return (
              <Pressable
                key={date}
                style={[styles.day, isSelected && { backgroundColor: primaryColor }]}
                onPress={() => enabled && onSelect(date)}
                disabled={!enabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: !enabled, selected: isSelected }}
                accessibilityLabel={`${formatLongDay(date)}${enabled ? '' : ', not available'}`}
              >
                <Text style={[styles.dayText, !inMonth && styles.hidden, !enabled && styles.disabled, isSelected && styles.selectedText]}>
                  {Number(date.slice(8, 10))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 8, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  nav: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row' },
  initial: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: '#94A3B8', paddingVertical: 4 },
  day: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 10, margin: 1 },
  dayText: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  hidden: { opacity: 0 },
  disabled: { color: '#CBD5E1', textDecorationLine: 'line-through' },
  selectedText: { color: '#FFFFFF' },
});
