import { StyleSheet } from 'react-native';

/** Redesign R5c: shared look of the visit form screens. */
export const FORM_COLORS = {
  brand: '#6546FC',
  text: '#0F172A',
  muted: '#64748B',
  border: '#CBD5E1',
  card: '#FFFFFF',
  page: '#F8FAFC',
  error: '#B91C1C',
  warning: '#92400E',
  ok: '#166534',
};

export const formStyles = StyleSheet.create({
  card: { backgroundColor: FORM_COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, marginBottom: 10 },
  label: { fontSize: 14, fontWeight: '700', color: FORM_COLORS.text },
  meta: { fontSize: 12, color: FORM_COLORS.muted, marginTop: 4 },
  unitTag: { fontSize: 11, fontWeight: '800', color: FORM_COLORS.brand, textTransform: 'uppercase', marginBottom: 4 },
  row: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: FORM_COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, minWidth: 44, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: FORM_COLORS.brand, borderColor: FORM_COLORS.brand },
  chipText: { fontSize: 13, fontWeight: '600', color: FORM_COLORS.text },
  chipTextOn: { color: '#FFFFFF' },
  input: { borderWidth: 1, borderColor: FORM_COLORS.border, borderRadius: 12, padding: 12, minHeight: 72, marginTop: 10, textAlignVertical: 'top', fontSize: 14, backgroundColor: '#FFFFFF', color: FORM_COLORS.text },
  inputSingle: { borderWidth: 1, borderColor: FORM_COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: '#FFFFFF', color: FORM_COLORS.text, minWidth: 120 },
  inputDisabled: { backgroundColor: '#F1F5F9', color: FORM_COLORS.muted },
  suffix: { fontSize: 14, fontWeight: '600', color: FORM_COLORS.muted },
  link: { color: FORM_COLORS.brand, fontWeight: '700', fontSize: 13, marginTop: 10, paddingVertical: 4 },
  secondaryButton: { borderWidth: 1, borderColor: FORM_COLORS.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 40, justifyContent: 'center' },
  secondaryButtonText: { color: FORM_COLORS.text, fontWeight: '600', fontSize: 13 },
  primaryButton: { backgroundColor: FORM_COLORS.brand, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.5 },
  error: { color: FORM_COLORS.error, fontSize: 12, marginTop: 6 },
  warningNote: { color: FORM_COLORS.warning, fontSize: 12, fontWeight: '700', marginTop: 8 },
  okNote: { color: FORM_COLORS.ok, fontSize: 12, fontWeight: '700', marginTop: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: FORM_COLORS.muted, textTransform: 'uppercase', marginTop: 12, marginBottom: 6 },
});
