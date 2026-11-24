import React, { type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Pill from '../common/Pill';
import { useActiveBranding } from '../../context/ProfileContext';
import type { StatusBadge } from '../../utils/visitText';

/** Redesign R5b: small building blocks shared by the Home, project, visit and site log screens. */

export function StatusBadges({ badges, style }: { badges: StatusBadge[]; style?: ViewStyle }) {
  if (badges.length === 0) return null;
  return (
    <View style={[styles.badges, style]}>
      {badges.map((b) => (
        <Pill key={b.text} variant={b.tone} text={b.text} style={styles.badge} />
      ))}
    </View>
  );
}

export function SectionCard({
  title,
  subtitle,
  right,
  children,
  style,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  children?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitles}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** A label: value line (hidden when the value is empty). */
export function DetailLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

/** Outline button for secondary actions (responses, shortcuts). */
export function OutlineButton({
  text,
  onPress,
  icon,
  tone = 'primary',
  disabled,
  accessibilityLabel,
  style,
}: {
  text: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  tone?: 'primary' | 'danger' | 'neutral';
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const { primaryColor } = useActiveBranding();
  const color = tone === 'danger' ? '#B91C1C' : tone === 'neutral' ? '#334155' : primaryColor;
  return (
    <TouchableOpacity
      style={[styles.outline, { borderColor: tone === 'danger' ? '#FECACA' : '#CBD5E1' }, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={accessibilityLabel ?? text}
    >
      {icon ? <Feather name={icon} size={14} color={color} /> : null}
      <Text style={[styles.outlineText, { color }]}>{text}</Text>
    </TouchableOpacity>
  );
}

/** A tappable row that opens another screen. */
export function LinkRow({ text, detail, icon, onPress }: { text: string; detail?: string | null; icon: keyof typeof Feather.glyphMap; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.linkRow}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${text}, ${detail}` : text}
    >
      <Feather name={icon} size={16} color="#005A4A" />
      <View style={styles.linkTexts}>
        <Text style={styles.linkText}>{text}</Text>
        {detail ? <Text style={styles.linkDetail}>{detail}</Text> : null}
      </View>
      <Feather name="chevron-right" size={16} color="#64748B" />
    </TouchableOpacity>
  );
}

export const visitUiStyles = StyleSheet.create({
  muted: { fontSize: 12, color: '#64748B', lineHeight: 17 },
  body: { fontSize: 13, color: '#334155', lineHeight: 18 },
  strong: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  errorText: { fontSize: 12, color: '#B91C1C', lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { alignSelf: 'auto' },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitles: { flex: 1 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sectionSubtitle: { fontSize: 11, color: '#64748B', marginTop: 2 },
  detailLine: { flexDirection: 'row', gap: 8 },
  detailLabel: { width: 110, fontSize: 12, color: '#64748B' },
  detailValue: { flex: 1, fontSize: 12, fontWeight: '600', color: '#0F172A' },
  outline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    minHeight: 40,
  },
  outlineText: { fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  linkTexts: { flex: 1 },
  linkText: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  linkDetail: { fontSize: 11, color: '#64748B', marginTop: 1 },
});
