import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Pill from '../common/Pill';
import type { ProjectCardModel } from '../../utils/homeLayout';
import { formatDay, SEVERITY_TEXT } from '../../utils/visitText';
import { LinkRow, OutlineButton } from './VisitUi';

/**
 * Redesign R5b: a project on Home. Compact in the "My projects" list; `full` on the single-project
 * home (D-R5.7): current sprint and deliverables, units in the sprint, open findings, next visit and
 * the site log / defects shortcuts.
 */
export function ProjectCard({
  model,
  full,
  unsent,
  showDefects,
  onOpen,
  onOpenVisit,
  onSiteLog,
  onDefects,
}: {
  model: ProjectCardModel;
  full: boolean;
  /** Items of this project waiting in the outbox (sent or failed). */
  unsent: { pending: number; dead: number } | null;
  showDefects: boolean;
  onOpen: () => void;
  onOpenVisit: (visitId: string) => void;
  onSiteLog: () => void;
  onDefects: () => void;
}) {
  const lines: string[] = [];
  if (model.sprintText) lines.push(model.sprintText);
  if (model.mobilisation?.dayText) lines.push(`${model.mobilisation.label}: ${model.mobilisation.dayText}`);
  if (model.openFindingCount > 0) lines.push(`${model.openFindingCount} open finding${model.openFindingCount === 1 ? '' : 's'}`);
  const unsentCount = (unsent?.pending ?? 0) + (unsent?.dead ?? 0);

  return (
    <View style={[styles.card, full && styles.cardFull]}>
      <TouchableOpacity
        onPress={onOpen}
        activeOpacity={0.75}
        style={styles.head}
        accessibilityRole="button"
        accessibilityLabel={`Open project ${model.code}, ${model.name}`}
      >
        <View style={styles.headTexts}>
          <View style={styles.codeRow}>
            <Text style={styles.code}>{model.code}</Text>
            {model.stageLabel ? <Pill variant="info" text={model.stageLabel} /> : null}
          </View>
          <Text style={styles.name}>{model.name}</Text>
          {model.school && model.school !== model.name ? <Text style={styles.meta}>{model.school}</Text> : null}
        </View>
        <Feather name="chevron-right" size={18} color="#64748B" />
      </TouchableOpacity>

      {model.packMissing ? (
        <Text style={styles.meta}>Project details download the next time you are online.</Text>
      ) : (
        <>
          {lines.length > 0 && <Text style={styles.meta}>{lines.join(' · ')}</Text>}
          {model.nextVisit ? (
            <TouchableOpacity
              onPress={() => onOpenVisit(model.nextVisit!.visitId)}
              accessibilityRole="button"
              accessibilityLabel={`Next visit: ${model.nextVisit.kindLabel} on ${formatDay(model.nextVisit.date)}`}
            >
              <Text style={styles.next}>
                Next visit: {model.nextVisit.kindLabel}, {formatDay(model.nextVisit.date)}
                {model.nextVisit.datePending ? ' (move waiting to send)' : ''}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.meta}>No visit planned in the next two weeks.</Text>
          )}
          {model.attentionCount > 0 && (
            <Pill variant="negative" text={`${model.attentionCount} visit${model.attentionCount === 1 ? '' : 's'} overdue or returned`} />
          )}
        </>
      )}
      {unsentCount > 0 && (
        <Text style={[styles.meta, unsent?.dead ? styles.dead : styles.pending]}>
          {unsentCount} item{unsentCount === 1 ? '' : 's'} not sent yet{unsent?.dead ? `, ${unsent.dead} could not be sent` : ''}
        </Text>
      )}

      {full && !model.packMissing && (
        <View style={styles.fullBody}>
          {model.currentSprint && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>
                Sprint {model.currentSprint.number}: {model.currentSprint.name}
              </Text>
              <Text style={styles.meta}>
                {formatDay(model.currentSprint.startDate)} – {formatDay(model.currentSprint.endDate)}
              </Text>
              {model.currentSprint.deliverables ? <Text style={styles.body}>{model.currentSprint.deliverables}</Text> : null}
            </View>
          )}
          {model.unitsInSprint.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Units in this sprint</Text>
              {model.unitsInSprint.map((u) => (
                <Text key={u.id} style={styles.body}>
                  {u.facilityName} · {u.label}
                  {u.plannedQuantity != null ? ` · ${u.plannedQuantity} ${u.quantityUnit ?? ''}`.trimEnd() : ''}
                  {u.progressPct != null ? ` · ${Math.round(u.progressPct)}% seen` : ''}
                </Text>
              ))}
            </View>
          )}
          {model.openFindings.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Open findings</Text>
              {model.openFindings.slice(0, 3).map((f) => (
                <Text key={f.id} style={styles.body}>
                  {SEVERITY_TEXT[f.severity]}: {f.title}
                  {f.facilityName ? ` (${f.facilityName}${f.unitLabel ? `, ${f.unitLabel}` : ''})` : ''}
                </Text>
              ))}
              {model.openFindings.length > 3 && <Text style={styles.meta}>and {model.openFindings.length - 3} more on the project page</Text>}
            </View>
          )}
          <View style={styles.shortcuts}>
            <LinkRow icon="camera" text="Site log" detail="Photos, voice notes and notes" onPress={onSiteLog} />
            {showDefects && (
              <LinkRow
                icon="tool"
                text="Defects"
                detail={model.openDefectCount > 0 ? `${model.openDefectCount} open` : null}
                onPress={onDefects}
              />
            )}
          </View>
          <OutlineButton text="Project details" icon="info" onPress={onOpen} />
        </View>
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
    padding: 14,
    gap: 6,
  },
  cardFull: { borderColor: '#B5DDD3', borderWidth: 1.5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headTexts: { flex: 1, gap: 2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  code: { fontSize: 13, fontWeight: '800', color: '#122F2A' },
  name: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  meta: { fontSize: 12, color: '#64748B', lineHeight: 17 },
  next: { fontSize: 12, fontWeight: '700', color: '#005A4A' },
  pending: { color: '#B45309', fontWeight: '700' },
  dead: { color: '#DC2626', fontWeight: '700' },
  fullBody: { gap: 12, marginTop: 6 },
  block: { gap: 3 },
  blockTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  body: { fontSize: 12, color: '#334155', lineHeight: 17 },
  shortcuts: { gap: 8 },
});
