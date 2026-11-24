import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { addDays } from '@insite/shared';
import { useActiveBranding } from '../../context/ProfileContext';
import { addMonths, monthGrid, monthOf, weekDates, type VisitDot } from '../../utils/visitCalendar';
import { dayAccessibilityLabel, DOT_TEXT, formatDay, monthTitle, WEEKDAY_INITIALS } from '../../utils/visitText';

/**
 * Redesign R5b (D-R5.1): Home's calendar, our own component over `utils/visitCalendar.ts` (no
 * calendar dependency). Week view by default, month view on demand; months page horizontally with a
 * paging FlatList. Dots differ in shape as well as colour, and every day reads its state aloud.
 */

export type CalendarMode = 'WEEK' | 'MONTH';

interface VisitCalendarProps {
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  dots: Map<string, VisitDot[]>;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  /** The month the month view shows (to fetch it online when it is outside the cached window). */
  onVisibleMonthChange?: (month: string) => void;
  /** Shown under the grid, e.g. "Showing what is on this phone". */
  notice?: string | null;
}

/** Months the month view can page through, either side of today. */
const MONTHS_EACH_SIDE = 12;

export const DOT_COLORS: Record<VisitDot, string> = { PLANNED: '#00715D', OVERDUE: '#DC2626', DONE: '#059669' };

export function VisitDotMark({ dot, size = 6, plannedColor }: { dot: VisitDot; size?: number; plannedColor?: string }) {
  const color = dot === 'PLANNED' && plannedColor ? plannedColor : DOT_COLORS[dot];
  if (dot === 'OVERDUE') return <View style={{ width: size, height: size, backgroundColor: color, borderRadius: 1 }} />;
  if (dot === 'DONE') return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color }} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function VisitCalendar({
  today,
  selectedDate,
  onSelectDate,
  dots,
  mode,
  onModeChange,
  onVisibleMonthChange,
  notice,
}: VisitCalendarProps) {
  const { primaryColor } = useActiveBranding();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(0);
  const months = useMemo(() => {
    const base = monthOf(today);
    return Array.from({ length: MONTHS_EACH_SIDE * 2 + 1 }, (_, i) => addMonths(base, i - MONTHS_EACH_SIDE));
  }, [today]);
  const clampIndex = useCallback((month: string) => {
    const i = months.indexOf(month);
    if (i >= 0) return i;
    return month < months[0] ? 0 : months.length - 1;
  }, [months]);
  const [visibleMonth, setVisibleMonth] = useState(monthOf(selectedDate));
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    if (mode === 'MONTH') setVisibleMonth(months[clampIndex(monthOf(selectedDate))]);
    // Only when the view opens: paging must not jump back to the selected date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode === 'MONTH') onVisibleMonthChange?.(visibleMonth);
  }, [mode, visibleMonth, onVisibleMonthChange]);

  const goToMonth = (month: string) => {
    const index = clampIndex(month);
    setVisibleMonth(months[index]);
    listRef.current?.scrollToIndex({ index, animated: true });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    const month = months[Math.max(0, Math.min(months.length - 1, index))];
    if (month !== visibleMonth) setVisibleMonth(month);
  };

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const renderDay = (date: string, inMonth = true) => {
    const dayDots = dots.get(date) ?? [];
    const selected = date === selectedDate;
    const isToday = date === today;
    return (
      <Pressable
        key={date}
        style={[styles.day, selected && { backgroundColor: primaryColor }]}
        onPress={() => onSelectDate(date)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={dayAccessibilityLabel(date, { today, dots: dayDots, selected })}
      >
        <Text
          style={[
            styles.dayNumber,
            !inMonth && styles.dayOutside,
            isToday && styles.dayToday,
            isToday && !selected && { color: primaryColor },
            selected && styles.daySelectedText,
          ]}
        >
          {Number(date.slice(8, 10))}
        </Text>
        <View style={styles.dotRow}>
          {dayDots.map((d) => (
            <View key={d} style={selected ? styles.dotOnSelected : undefined}>
              <VisitDotMark dot={d} plannedColor={selected ? '#FFFFFF' : primaryColor} />
            </View>
          ))}
        </View>
      </Pressable>
    );
  };

  const weekdayHeader = (
    <View style={styles.weekRow}>
      {WEEKDAY_INITIALS.map((d, i) => (
        <Text key={i} style={styles.weekdayInitial} importantForAccessibility="no">
          {d}
        </Text>
      ))}
    </View>
  );

  const week = weekDates(selectedDate);
  const title = mode === 'WEEK' ? `${formatDay(week[0])} – ${formatDay(week[6])}` : monthTitle(visibleMonth);

  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => setCollapsed((c) => !c)}
          style={styles.titleButton}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Show the calendar' : 'Hide the calendar'}
          accessibilityState={{ expanded: !collapsed }}
        >
          <Feather name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#334155" />
          <Text style={styles.title}>{collapsed ? `Calendar · ${formatDay(selectedDate)}` : title}</Text>
        </TouchableOpacity>
        {!collapsed && (
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.navButton}
              onPress={() => (mode === 'WEEK' ? onSelectDate(addDays(selectedDate, -7)) : goToMonth(addMonths(visibleMonth, -1)))}
              accessibilityRole="button"
              accessibilityLabel={mode === 'WEEK' ? 'Previous week' : 'Previous month'}
            >
              <Feather name="chevron-left" size={18} color="#334155" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navButton}
              onPress={() => (mode === 'WEEK' ? onSelectDate(addDays(selectedDate, 7)) : goToMonth(addMonths(visibleMonth, 1)))}
              accessibilityRole="button"
              accessibilityLabel={mode === 'WEEK' ? 'Next week' : 'Next month'}
            >
              <Feather name="chevron-right" size={18} color="#334155" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modeButton}
              onPress={() => onModeChange(mode === 'WEEK' ? 'MONTH' : 'WEEK')}
              accessibilityRole="button"
              accessibilityLabel={mode === 'WEEK' ? 'Show the month' : 'Show the week'}
            >
              <Text style={[styles.modeText, { color: primaryColor }]}>{mode === 'WEEK' ? 'Month' : 'Week'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {!collapsed && (
        <>
          {weekdayHeader}
          {mode === 'WEEK' ? (
            <View style={styles.weekRow}>{week.map((d) => renderDay(d))}</View>
          ) : width > 0 ? (
            <FlatList
              ref={listRef}
              data={months}
              keyExtractor={(m) => m}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={clampIndex(visibleMonth)}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              onMomentumScrollEnd={onMomentumEnd}
              renderItem={({ item }) => (
                <View style={{ width }}>
                  {monthGrid(item).map((row) => (
                    <View key={row[0].date} style={styles.weekRow}>
                      {row.map((cell) => renderDay(cell.date, cell.inMonth))}
                    </View>
                  ))}
                </View>
              )}
            />
          ) : null}
          <View style={styles.legend} accessible accessibilityLabel="Legend: filled dot planned, square overdue, ring done">
            {(['PLANNED', 'OVERDUE', 'DONE'] as VisitDot[]).map((d) => (
              <View key={d} style={styles.legendItem}>
                <VisitDotMark dot={d} size={7} plannedColor={primaryColor} />
                <Text style={styles.legendText}>{DOT_TEXT[d]}</Text>
              </View>
            ))}
          </View>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 10,
    gap: 4,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 },
  titleButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, flexShrink: 1 },
  title: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  modeButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  modeText: { fontSize: 12, fontWeight: '700' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 4 },
  weekdayInitial: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: '#94A3B8' },
  day: { flex: 1, alignItems: 'center', paddingVertical: 6, marginHorizontal: 2, borderRadius: 10, minHeight: 44 },
  dayNumber: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  dayOutside: { color: '#CBD5E1' },
  dayToday: { fontWeight: '900', textDecorationLine: 'underline' },
  daySelectedText: { color: '#FFFFFF' },
  dotRow: { flexDirection: 'row', gap: 3, marginTop: 4, minHeight: 7, alignItems: 'center' },
  dotOnSelected: { opacity: 0.95 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontSize: 11, color: '#64748B' },
  notice: { fontSize: 11, color: '#92400E', textAlign: 'center', paddingHorizontal: 12, paddingTop: 4 },
});
