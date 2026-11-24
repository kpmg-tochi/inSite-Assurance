import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { VisitResponseAction } from '@insite/shared';
import { allowedResponses, RESPONSE_ACTION_LABELS } from '../../utils/visitResponses';
import type { VisitView } from '../../utils/visitCalendar';
import type { StoredVisit } from '../../utils/visitModel';
import { formatDay, visitBadges } from '../../utils/visitText';
import { OutlineButton, StatusBadges } from './VisitUi';

/**
 * Redesign R5b: one visit in a day list (Home, project screen). Its state as words, the phone's
 * "Waiting to send" overlay, and the responses the visit takes now (D-R5.11, `allowedResponses`).
 */
export function VisitRow({
  view,
  stored,
  canSubmit,
  workWeekDays,
  showProject,
  onOpen,
  onRespond,
}: {
  view: VisitView;
  stored: StoredVisit;
  canSubmit: boolean;
  workWeekDays?: number[] | null;
  showProject: boolean;
  onOpen: () => void;
  onRespond?: (action: VisitResponseAction) => void;
}) {
  const actions = onRespond ? allowedResponses(stored, { canSubmit, workWeekDays }) : [];
  const responseError = stored.local.responseError;
  const title = showProject ? `${view.kindLabel} · ${view.projectCode}` : view.kindLabel;
  return (
    <View style={styles.card}>
      <TouchableOpacity
        onPress={onOpen}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${formatDay(view.date)}, ${visitBadges(view).map((b) => b.text).join(', ')}. Open the visit.`}
        style={styles.main}
      >
        <View style={styles.texts}>
          <Text style={styles.title}>{title}</Text>
          {showProject ? <Text style={styles.subtitle}>{stored.visit.projectName}</Text> : null}
          <Text style={styles.meta}>
            {formatDay(view.date)}
            {view.originalDate !== view.date ? ` · first planned ${formatDay(view.originalDate)}` : ''}
            {stored.visit.sprint ? ` · Sprint ${stored.visit.sprint.number}` : ''}
          </Text>
          <StatusBadges badges={visitBadges(view)} style={styles.badges} />
        </View>
        <Feather name="chevron-right" size={18} color="#64748B" />
      </TouchableOpacity>
      {responseError ? (
        <Text style={styles.error}>
          {RESPONSE_ACTION_LABELS[responseError.action]} not sent: {responseError.message}
        </Text>
      ) : null}
      {actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((a) => (
            <OutlineButton
              key={a}
              text={RESPONSE_ACTION_LABELS[a]}
              tone={a === 'DECLINE' ? 'danger' : 'primary'}
              onPress={() => onRespond?.(a)}
              accessibilityLabel={`${RESPONSE_ACTION_LABELS[a]}: ${title} on ${formatDay(view.date)}`}
            />
          ))}
        </View>
      )}
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
    gap: 10,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 12, color: '#334155' },
  meta: { fontSize: 12, color: '#64748B' },
  badges: { marginTop: 6 },
  error: { fontSize: 12, color: '#B91C1C', lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
