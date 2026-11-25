import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VISIT_KIND_META, VISIT_OVERALL_FINDING_LABELS, VisitOverallFindingEnum, type VisitOverallFinding } from '@insite/shared';
import type { RootStackScreenProps } from '../../navigation/types';
import { hydrateBaselinePack } from '../../storage/baselineStore';
import { captureDisplayUri, getCaptures, type CaptureRecord } from '../../storage/captureStore';
import { nowIso } from '../../storage/db/database';
import { listSiteLogEntries } from '../../storage/siteLogStore';
import { getOpenDraft, getVisit, getVisitFormByHash, queueVisitSubmission, siteLogAttachmentsByDraft, type CachedVisitForm } from '../../storage/visitStore';
import { subscribeVisitData } from '../../storage/visitEvents';
import { acquireFix } from '../../services/locationService';
import { readHeading } from '../../services/headingService';
import { geotagFromFix } from '../../utils/headingReadings';
import { InfoCallout } from '../../components/common';
import { ChoiceChips, FORM_COLORS, formStyles, requestFormScreen } from '../../components/form';
import { useDraftEditor } from '../../components/form/useDraftEditor';
import { checkDraft, formScreens, REVIEW_SCREEN_KEY, suggestedOverallFinding } from '../../utils/visitForm';
import { attachableEntries, attachEntry, detachEntry, entryDay, type SiteLogRecord } from '../../utils/siteLog';
import { findingLine, findingsCountText, reviewIssueGroups, siteLogEntryLabel, timeInZone, WAITING_TO_SEND_TEXT } from '../../utils/formUiModel';
import type { StoredVisit, StoredVisitDraft } from '../../utils/visitModel';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';

/**
 * Redesign R5c: review and submit. Lists what still blocks the submission (errors and photo gaps,
 * each linking back to its section), the findings the answers will raise, the overall finding and
 * summary the submission needs (pre-filled from an OVERALL_FINDING question), and the site log
 * entries to attach (D-R5.22). Submit queues VISIT_SUBMISSION behind its photos, check-in and site
 * log entries; it works offline.
 */

type Loaded = { visit: StoredVisit; form: CachedVisitForm; timeZone: string | null; status: StoredVisitDraft['status']; lastError: string | null; prefilled: boolean };
type Phase = { kind: 'LOADING' } | { kind: 'BLOCKED'; title: string; message: string } | { kind: 'READY'; data: Loaded };

const FINDINGS = VisitOverallFindingEnum.options;

export default function VisitReviewScreen({ route, navigation }: RootStackScreenProps<'VisitReview'>) {
  const { visitId } = route.params;
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'LOADING' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<SiteLogRecord[]>([]);
  const [attached, setAttached] = useState<Map<string, string>>(() => new Map());
  const [entryCaptures, setEntryCaptures] = useState<Map<string, CaptureRecord>>(() => new Map());

  const data = phase.kind === 'READY' ? phase.data : null;
  const editor = useDraftEditor(data?.visit.projectId ?? null);
  const { draft, update, setDraft, saver } = editor;

  const loadSiteLog = useCallback(async (projectId: string) => {
    const [list, map] = await Promise.all([listSiteLogEntries(projectId), siteLogAttachmentsByDraft()]);
    setEntries(list);
    setAttached(map);
    const recs = await getCaptures(list.map((e) => e.captureId).filter((x): x is string => Boolean(x)));
    setEntryCaptures(new Map(recs.map((r) => [r.id, r])));
  }, []);

  const load = useCallback(async () => {
    setPhase({ kind: 'LOADING' });
    try {
      const v = await getVisit(visitId);
      if (!v) return setPhase({ kind: 'BLOCKED', title: 'Visit not on this phone', message: 'Refresh your visits and open it again.' });
      const open = await getOpenDraft(v.id);
      if (!open) return setPhase({ kind: 'BLOCKED', title: 'No report to review', message: 'Start the form from the visit first.' });
      const pack = await hydrateBaselinePack(v.projectId).catch(() => null);
      const form = await getVisitFormByHash(v.id, open.draft.formHash);
      if (!form) return setPhase({ kind: 'BLOCKED', title: 'Form not on this phone', message: 'The form of this report is no longer on the phone.' });
      let d = open.draft;
      let prefilled = false;
      if (open.status === 'DRAFT' && !d.overallFinding) {
        const suggested = suggestedOverallFinding(form.snapshot, d.answers);
        if (suggested) {
          d = { ...d, overallFinding: suggested };
          prefilled = true;
        }
      }
      setDraft(open.draft);
      if (d !== open.draft) update(() => d);
      await loadSiteLog(v.projectId);
      setPhase({ kind: 'READY', data: { visit: v, form, timeZone: pack?.timezone ?? null, status: open.status, lastError: open.lastError, prefilled } });
    } catch (err) {
      setPhase({ kind: 'BLOCKED', title: 'Could not open the review', message: formatMobileErrorMessage(err) });
    }
  }, [visitId, setDraft, update, loadSiteLog]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectId = data?.visit.projectId ?? null;
  useEffect(() => {
    if (!projectId) return;
    return subscribeVisitData((topic) => {
      if (topic === 'siteLog') void loadSiteLog(projectId).catch(() => undefined);
    });
  }, [projectId, loadSiteLog]);

  const check = useMemo(() => (data && draft ? checkDraft(data.form.snapshot, draft, editor.factList) : null), [data, draft, editor.factList]);
  const screens = useMemo(() => (data ? formScreens(data.form.snapshot) : []), [data]);
  const groups = check ? reviewIssueGroups(screens, check) : [];
  const readOnly = data?.status !== 'DRAFT';

  const attachable = useMemo(
    () => (data && draft ? attachableEntries(entries, { projectId: data.visit.projectId, draftId: draft.id, attachedToDrafts: attached }) : []),
    [data, draft, entries, attached]
  );

  const toSection = async (screenKey: string) => {
    await saver.flush().catch(() => undefined);
    requestFormScreen(visitId, screenKey);
    navigation.popTo('VisitForm', { visitId });
  };

  const submit = async () => {
    if (!draft || !check?.canSubmit) return;
    setError(null);
    try {
      setBusy('Getting your position…');
      const [fix, heading] = await Promise.all([acquireFix(), readHeading().catch(() => null)]);
      setBusy('Saving…');
      await saver.flush();
      await queueVisitSubmission(draft.id, {
        confirmedAt: nowIso(),
        submissionGeotag: geotagFromFix(fix, heading),
      });
      navigation.popTo('Visit', { visitId });
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <LinearGradient colors={['#00715D', '#005A4A', '#122F2A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
      <TouchableOpacity
        onPress={() => void saver.flush().catch(() => undefined).then(() => navigation.goBack())}
        accessibilityRole="button"
        accessibilityLabel="Back to the form"
      >
        <Text style={styles.closeText}>‹ Back to the form</Text>
      </TouchableOpacity>
      <Text style={styles.title} accessibilityRole="header">
        Review and submit
      </Text>
      {data ? (
        <Text style={styles.subtitle}>
          {VISIT_KIND_META[data.visit.visit.visitKind].label} · {data.visit.visit.projectCode} · {data.visit.visit.plannedDate}
        </Text>
      ) : null}
    </LinearGradient>
  );

  if (phase.kind !== 'READY' || !data || !draft || !check) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <View style={styles.body}>
          {phase.kind === 'BLOCKED' ? (
            <InfoCallout variant="warning" title={phase.title} description={phase.message} />
          ) : (
            <ActivityIndicator style={{ marginTop: 32 }} accessibilityLabel="Opening the review" />
          )}
        </View>
      </View>
    );
  }

  const reviewIssues = check.byScreen.get(REVIEW_SCREEN_KEY) ?? [];
  const issueOf = (code: string) => reviewIssues.find((i) => i.code === code)?.message ?? null;
  const resolved = check.recheckResults.filter((r) => r.resolved).length;
  const notResolved = check.recheckResults.length - resolved;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {header}
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {readOnly && (
          <View style={{ marginBottom: 12 }}>
            <InfoCallout variant="info" title="Waiting to send" description={data.lastError ? `${WAITING_TO_SEND_TEXT} Last attempt: ${data.lastError}` : WAITING_TO_SEND_TEXT} />
          </View>
        )}

        {/* What blocks submit */}
        {!readOnly && groups.length > 0 && (
          <View style={formStyles.card}>
            <Text style={formStyles.label} accessibilityRole="header">
              To fix before you submit
            </Text>
            {groups.map((g) => (
              <View key={g.screenKey} style={{ marginTop: 10 }}>
                {g.screenIndex !== null ? (
                  <TouchableOpacity onPress={() => void toSection(g.screenKey)} accessibilityRole="link" accessibilityLabel={`Go to section ${g.screenIndex + 1}, ${g.title}, ${g.issues.length} to fix`}>
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
        )}
        {!readOnly && groups.length === 0 && <Text style={[formStyles.okNote, { marginBottom: 10 }]}>✓ Every section is complete.</Text>}

        {/* Findings */}
        <View style={formStyles.card}>
          <Text style={formStyles.label} accessibilityRole="header">
            Findings
          </Text>
          <Text style={[formStyles.meta, check.findingsToRaise.length > 0 && formStyles.warningNote]}>{findingsCountText(check.findingsToRaise.length)}</Text>
          {check.findingsToRaise.map((f, n) => (
            <Text key={`${f.path}-${n}`} style={formStyles.meta}>
              • {findingLine(f)}
            </Text>
          ))}
          {check.recheckResults.length > 0 && (
            <Text style={[formStyles.meta, { marginTop: 8 }]}>
              Re-checks: {resolved} marked resolved, {notResolved} not resolved.
            </Text>
          )}
        </View>

        {/* Overall finding and summary */}
        <View style={formStyles.card}>
          <Text style={formStyles.label} accessibilityRole="header">
            Overall finding
          </Text>
          <ChoiceChips
            groupLabel="Overall finding"
            options={FINDINGS.map((k) => ({ key: k, label: VISIT_OVERALL_FINDING_LABELS[k] }))}
            selected={draft.overallFinding ? [draft.overallFinding] : []}
            disabled={readOnly}
            onToggle={(k) => update((d) => ({ ...d, overallFinding: k as VisitOverallFinding }))}
          />
          {data.prefilled && <Text style={formStyles.meta}>Pre-filled from your answer in the form. Change it if needed.</Text>}
          {!readOnly && issueOf('OVERALL_FINDING_REQUIRED') ? <Text style={formStyles.error}>To fix: {issueOf('OVERALL_FINDING_REQUIRED')}</Text> : null}

          <Text style={[formStyles.label, { marginTop: 14 }]}>Summary</Text>
          <TextInput
            style={[formStyles.input, { minHeight: 110 }, readOnly && formStyles.inputDisabled]}
            multiline
            editable={!readOnly}
            value={draft.summaryText}
            onChangeText={(t) => update((d) => ({ ...d, summaryText: t }))}
            maxLength={4000}
            placeholder="What you saw on this visit"
            accessibilityLabel="Summary of the visit"
          />
          {!readOnly && issueOf('SUMMARY_REQUIRED') ? <Text style={formStyles.error}>To fix: {issueOf('SUMMARY_REQUIRED')}</Text> : null}
        </View>

        {/* Site log entries (D-R5.22) */}
        <View style={formStyles.card}>
          <Text style={formStyles.label} accessibilityRole="header">
            Attach site log entries
          </Text>
          <Text style={formStyles.meta}>Entries from this project&apos;s site log. Attached entries are sent with the report; the others stay in the site log.</Text>
          {attachable.length === 0 && <Text style={[formStyles.meta, { marginTop: 8 }]}>No site log entries to attach.</Text>}
          {attachable.map((e) => {
            const on = draft.siteLogEntryIds.includes(e.id);
            const label = siteLogEntryLabel(e);
            const rec = e.captureId ? entryCaptures.get(e.captureId) : undefined;
            const uri = e.kind === 'PHOTO' && rec ? captureDisplayUri(rec) : null;
            const when = `${entryDay(e, data.timeZone)} ${timeInZone(e.capturedAt, data.timeZone)}`;
            return (
              <TouchableOpacity
                key={e.id}
                style={[styles.entry, on && styles.entryOn]}
                disabled={readOnly}
                onPress={() => update((d) => (on ? detachEntry(d, e.id, nowIso()) : attachEntry(d, e.id, nowIso())))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: readOnly }}
                accessibilityLabel={`${label.kind}, ${when}, ${label.status}${label.text ? `, ${label.text}` : ''}`}
              >
                <Text style={styles.check}>{on ? '☑' : '☐'}</Text>
                {uri ? <Image source={{ uri }} style={styles.thumb} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={formStyles.label}>
                    {label.kind} · {when}
                  </Text>
                  <Text style={formStyles.meta}>{on ? 'Attached' : 'Not attached'} · {label.status}</Text>
                  {label.text ? (
                    <Text style={formStyles.meta} numberOfLines={2}>
                      {label.text}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {editor.saveError ? <Text style={formStyles.error}>Not saved: {editor.saveError}</Text> : null}
        {error ? <Text style={formStyles.error}>{error}</Text> : null}

        {!readOnly && (
          <>
            <TouchableOpacity
              style={[formStyles.primaryButton, { marginTop: 8 }, (!check.canSubmit || busy) && formStyles.disabled]}
              disabled={!check.canSubmit || Boolean(busy)}
              onPress={() => void submit()}
              accessibilityRole="button"
              accessibilityState={{ disabled: !check.canSubmit || Boolean(busy), busy: Boolean(busy) }}
              accessibilityLabel={check.canSubmit ? 'Submit the report' : 'Submit the report, not available until everything is fixed'}
            >
              <Text style={formStyles.primaryButtonText}>{busy ?? 'Submit report'}</Text>
            </TouchableOpacity>
            <Text style={[formStyles.meta, { marginTop: 8 }]}>
              {check.canSubmit
                ? 'Works offline: the report is saved on the phone and sends with its photos when you are online. It cannot be changed after you submit.'
                : 'Fix the items above to submit.'}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FORM_COLORS.page },
  header: { paddingHorizontal: 20, paddingBottom: 20 },
  closeText: { fontSize: 13, color: '#B5DDD3', fontWeight: '700', marginBottom: 8, paddingVertical: 4 },
  title: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: '#D7EEE8', marginTop: 4 },
  body: { padding: 16 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: FORM_COLORS.brand, paddingVertical: 4 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0', marginTop: 8 },
  entryOn: { backgroundColor: '#EEF7F4' },
  check: { fontSize: 20, color: FORM_COLORS.brand, width: 24 },
  thumb: { width: 56, height: 42, borderRadius: 6, backgroundColor: '#E2E8F0' },
});
