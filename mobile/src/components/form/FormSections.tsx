import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { VisitFormAnswerInput, VisitFormSnapshotBlock, VisitFormSnapshotField } from '@insite/shared';
import type { CaptureRecord } from '../../storage/captureStore';
import type { VoiceRecordingResult } from '../audio';
import { InfoCallout } from '../common';
import { answerFor, type DraftCheck, type FormIssue, type FormScreen, type PhoneCaptureFact, type PhotoSlot } from '../../utils/visitForm';
import { progressText, screenStatusText, type IssueGroup } from '../../utils/formUiModel';
import { FormFieldCard } from './FormFieldCard';
import { FORM_COLORS, formStyles } from './formStyles';

/**
 * The pieces of a section-by-section form (redesign R5c), shared by the visit form and the needs
 * verification form (needs pipeline wave 5): the header with progress, one section's questions, the
 * previous / next / review buttons, the "All sections" sheet and the review's "To fix" card. Screens
 * keep their own loading, drafts and captures; these only render.
 */

export function FormHeader({
  title,
  subtitle,
  backLabel,
  backA11yLabel,
  onBack,
  topInset,
  progress,
  onShowSections,
}: {
  title: string;
  subtitle?: string | null;
  backLabel: string;
  backA11yLabel: string;
  onBack: () => void;
  topInset: number;
  progress?: { done: number; total: number } | null;
  onShowSections?: () => void;
}) {
  return (
    <LinearGradient colors={['#00715D', '#005A4A', '#122F2A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: Math.max(topInset + 8, 20) }]}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel={backA11yLabel}>
        <Text style={styles.closeText}>{backLabel}</Text>
      </TouchableOpacity>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {progress ? (
        <>
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={progressText(progress.done, progress.total)}
            accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
          >
            <View style={[styles.progressFill, { width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }]} />
          </View>
          <View style={styles.headerRow}>
            <Text style={styles.subtitle}>{progressText(progress.done, progress.total)}</Text>
            {onShowSections ? (
              <TouchableOpacity onPress={onShowSections} accessibilityRole="button" accessibilityLabel="Show all sections">
                <Text style={styles.headerLink}>All sections</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      ) : null}
    </LinearGradient>
  );
}

/** A form that cannot open (not on the phone, not ready): the reason and "Try again". */
export function FormBlockedView({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <View style={styles.body}>
      <InfoCallout variant="warning" title={title} description={message} />
      {onRetry ? (
        <TouchableOpacity style={[formStyles.secondaryButton, { marginTop: 12, alignSelf: 'flex-start' }]} onPress={onRetry} accessibilityRole="button">
          <Text style={formStyles.secondaryButtonText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export interface FormSectionHandlers {
  onValue: (path: string, value: VisitFormAnswerInput['value']) => void;
  onComment: (path: string, comment: string | null) => void;
  onTakePhoto: (field: VisitFormSnapshotField, slot: PhotoSlot, left: number) => void;
  onRetakePhoto: (field: VisitFormSnapshotField, slot: PhotoSlot, clientCaptureId: string) => void;
  onRemoveCapture: (path: string, clientCaptureId: string) => void;
  onPickFromSiteLog?: (field: VisitFormSnapshotField, slot: PhotoSlot) => void;
  onVoiceRecorded: (field: VisitFormSnapshotField, result: VoiceRecordingResult) => void;
}

/** One section: its title and description, then a card per question, then whether it is complete. */
export function FormSectionBody({
  screen,
  block,
  answers,
  issues,
  facts,
  captures,
  readOnly,
  timeZone,
  handlers,
  emptyText = 'This facility has no questions on this monitoring visit.',
  children,
}: {
  screen: FormScreen;
  block: VisitFormSnapshotBlock;
  answers: VisitFormAnswerInput[];
  issues: FormIssue[] | undefined;
  facts: Map<string, PhoneCaptureFact>;
  captures: Map<string, CaptureRecord>;
  readOnly: boolean;
  timeZone: string | null;
  handlers: FormSectionHandlers;
  emptyText?: string;
  /** Shown under the section's title, above its questions (e.g. the site's location card). */
  children?: React.ReactNode;
}) {
  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {screen.title}
      </Text>
      {screen.description ? <Text style={[formStyles.meta, { marginBottom: 8 }]}>{screen.description}</Text> : null}
      {screen.kind === 'FACILITY' && screen.units.length > 0 ? (
        <Text style={[formStyles.meta, { marginBottom: 8 }]}>
          Units: {screen.units.map((u) => (u.plannedQuantity !== null ? `${u.label} (${u.plannedQuantity}${u.quantityUnit ? ` ${u.quantityUnit}` : ''})` : u.label)).join(', ')}
        </Text>
      ) : null}
      {children}
      {screen.isEmpty && <InfoCallout variant="neutral" title="Nothing to answer" description={emptyText} />}

      {block.fields.map((field) => (
        <FormFieldCard
          key={field.path}
          field={field}
          block={block}
          answer={answerFor(answers, field.path)}
          issues={issues}
          facts={facts}
          captures={captures}
          readOnly={readOnly}
          timeZone={timeZone}
          onValue={handlers.onValue}
          onComment={handlers.onComment}
          onTakePhoto={handlers.onTakePhoto}
          onRetakePhoto={handlers.onRetakePhoto}
          onRemoveCapture={handlers.onRemoveCapture}
          onPickFromSiteLog={readOnly || !handlers.onPickFromSiteLog ? undefined : handlers.onPickFromSiteLog}
          onVoiceRecorded={handlers.onVoiceRecorded}
        />
      ))}

      {!readOnly && (
        <Text style={[formStyles.meta, issues?.length ? { color: FORM_COLORS.error } : { color: FORM_COLORS.ok }]} accessibilityLiveRegion="polite">
          {issues?.length ? `${issues.length} thing${issues.length === 1 ? '' : 's'} to fix in this section` : 'This section is complete'}
        </Text>
      )}
    </>
  );
}

/** Previous / Next section / Review and submit, and the "saved as you go" note. */
export function FormSectionNav({
  screenIndex,
  count,
  readOnly,
  onGo,
  onReview,
  reviewLabel = 'Review and submit',
}: {
  screenIndex: number;
  count: number;
  readOnly: boolean;
  onGo: (index: number) => void;
  onReview: () => void;
  reviewLabel?: string;
}) {
  const isLast = screenIndex === count - 1;
  return (
    <>
      <View style={[formStyles.row, { marginTop: 16 }]}>
        {screenIndex > 0 && (
          <TouchableOpacity style={formStyles.secondaryButton} onPress={() => onGo(screenIndex - 1)} accessibilityRole="button" accessibilityLabel="Previous section">
            <Text style={formStyles.secondaryButtonText}>Previous</Text>
          </TouchableOpacity>
        )}
        {!isLast ? (
          <TouchableOpacity style={formStyles.primaryButton} onPress={() => onGo(screenIndex + 1)} accessibilityRole="button" accessibilityLabel="Next section">
            <Text style={formStyles.primaryButtonText}>Next section</Text>
          </TouchableOpacity>
        ) : !readOnly ? (
          <TouchableOpacity style={formStyles.primaryButton} onPress={onReview} accessibilityRole="button">
            <Text style={formStyles.primaryButtonText}>{reviewLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {!readOnly && <Text style={[formStyles.meta, { marginTop: 12 }]}>Saved on this phone as you go.</Text>}
    </>
  );
}

/** The "All sections" sheet: every section with its state, and the review. */
export function FormSectionsSheet({
  visible,
  screens,
  check,
  screenIndex,
  readOnly,
  bottomInset,
  onGo,
  onReview,
  onClose,
}: {
  visible: boolean;
  screens: FormScreen[];
  check: Pick<DraftCheck, 'byScreen'>;
  screenIndex: number;
  readOnly: boolean;
  bottomInset: number;
  onGo: (index: number) => void;
  onReview: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: bottomInset + 16 }]} accessibilityViewIsModal>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Sections
          </Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {screens.map((s, i) => {
              const status = screenStatusText(check, s.key);
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.sectionRow, i === screenIndex && styles.sectionRowOn]}
                  onPress={() => onGo(i)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: i === screenIndex }}
                  accessibilityLabel={`Section ${i + 1}, ${s.title}, ${status}`}
                >
                  <Text style={formStyles.label}>
                    {i + 1}. {s.title}
                  </Text>
                  <Text style={[formStyles.meta, { color: status === 'Complete' ? FORM_COLORS.ok : FORM_COLORS.error }]}>{status}</Text>
                </TouchableOpacity>
              );
            })}
            {!readOnly && (
              <TouchableOpacity style={styles.sectionRow} onPress={onReview} accessibilityRole="button">
                <Text style={formStyles.label}>Review and submit</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          <TouchableOpacity onPress={onClose} accessibilityRole="button">
            <Text style={formStyles.link}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** The review's "To fix before you submit": issues per section, each section linking back to it. */
export function IssueGroupsCard({ groups, onGo }: { groups: IssueGroup[]; onGo: (screenKey: string) => void }) {
  if (groups.length === 0) return <Text style={[formStyles.okNote, { marginBottom: 10 }]}>✓ Every section is complete.</Text>;
  return (
    <View style={formStyles.card}>
      <Text style={formStyles.label} accessibilityRole="header">
        To fix before you submit
      </Text>
      {groups.map((g) => (
        <View key={g.screenKey} style={{ marginTop: 10 }}>
          {g.screenIndex !== null ? (
            <TouchableOpacity onPress={() => onGo(g.screenKey)} accessibilityRole="link" accessibilityLabel={`Go to section ${g.screenIndex + 1}, ${g.title}, ${g.issues.length} to fix`}>
              <Text style={styles.groupTitle}>
                Section {g.screenIndex + 1}: {g.title} ›
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.groupTitle}>{g.title} (below)</Text>
          )}
          {g.issues.map((i, n) => (
            <Text key={`${i.path}-${i.code}-${i.unitId ?? ''}-${n}`} style={formStyles.error}>
              • {i.label === i.path ? i.message : `${i.label}: ${i.message}`}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Page and body styles shared by the form and review screens. */
export const formScreenStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FORM_COLORS.page },
  body: { padding: 16 },
});

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 18 },
  closeText: { fontSize: 13, color: '#B5DDD3', fontWeight: '700', marginBottom: 8, paddingVertical: 4 },
  title: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: '#D7EEE8', marginTop: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLink: { fontSize: 12, color: '#FFFFFF', fontWeight: '800', marginTop: 4, paddingVertical: 4, textDecorationLine: 'underline' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: '#FFFFFF' },
  body: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: FORM_COLORS.text, marginBottom: 6 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: FORM_COLORS.brand, paddingVertical: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sectionRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  sectionRowOn: { backgroundColor: '#EEF7F4' },
});
