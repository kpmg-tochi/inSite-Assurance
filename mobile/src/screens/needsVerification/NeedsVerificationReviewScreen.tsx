import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXISTING_CONDITION_LABELS, needsVerificationFacts } from '@insite/shared';
import type { RootStackScreenProps } from '../../navigation/types';
import { nowIso } from '../../storage/db/database';
import {
  getNeedsVerification,
  getNeedsVerificationForm,
  getOpenVerificationDraft,
  queueVerificationSubmission,
  saveVerificationDraft,
  verificationCaptureFacts,
} from '../../storage/needsVerificationStore';
import { InfoCallout } from '../../components/common';
import { FormHeader, formScreenStyles as styles, formStyles, IssueGroupsCard, requestFormScreen } from '../../components/form';
import { useFormDraftEditor, type DraftCaptureSource } from '../../components/form/useDraftEditor';
import { formScreens } from '../../utils/visitForm';
import { reviewIssueGroups } from '../../utils/formUiModel';
import {
  checkVerificationDraft,
  locatedSitesText,
  VERIFICATION_WAITING_TEXT,
  verificationLabel,
  verificationSnapshot,
  type CachedNeedsVerificationForm,
  type NeedsVerificationDraft,
  type NeedsVerificationDraftStatus,
  type StoredNeedsVerification,
} from '../../utils/needsVerification';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';

/**
 * Needs pipeline wave 5 (N8): review and submit a field verification. Lists what still blocks the
 * submission (answers, a location per site, photos; each linking back to its section), what differs
 * from the needs assessment, and the notes. Submit queues NEEDS_VERIFICATION_SUBMISSION behind its
 * photos; it works offline.
 */

type Loaded = { v: StoredNeedsVerification; form: CachedNeedsVerificationForm; status: NeedsVerificationDraftStatus; lastError: string | null };
type Phase = { kind: 'LOADING' } | { kind: 'BLOCKED'; title: string; message: string } | { kind: 'READY'; data: Loaded };

const CAPTURES: DraftCaptureSource = {
  factsFor: verificationCaptureFacts,
  factOf: (rec) => ({ clientCaptureId: rec.id, hasFix: Boolean(rec.fix), isMocked: rec.fix?.isMocked ?? false, geofenceStatus: null }),
};

export default function NeedsVerificationReviewScreen({ route, navigation }: RootStackScreenProps<'NeedsVerificationReview'>) {
  const { verificationId } = route.params;
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'LOADING' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = phase.kind === 'READY' ? phase.data : null;
  const editor = useFormDraftEditor<NeedsVerificationDraft>(saveVerificationDraft, data ? CAPTURES : null);
  const { draft, update, setDraft, saver } = editor;

  const load = useCallback(async () => {
    setPhase({ kind: 'LOADING' });
    try {
      const v = await getNeedsVerification(verificationId);
      if (!v) return setPhase({ kind: 'BLOCKED', title: 'Site verification not on this phone', message: 'Pull down on Home to refresh, then open it again.' });
      const open = await getOpenVerificationDraft(v.id);
      if (!open) return setPhase({ kind: 'BLOCKED', title: 'Nothing to review', message: 'Start the form from the site verification first.' });
      const form = await getNeedsVerificationForm(v.id, open.draft.formHash);
      if (!form) return setPhase({ kind: 'BLOCKED', title: 'Form not on this phone', message: 'The form of this site verification is no longer on the phone.' });
      setDraft(open.draft);
      setPhase({ kind: 'READY', data: { v, form, status: open.status, lastError: open.lastError } });
    } catch (err) {
      setPhase({ kind: 'BLOCKED', title: 'Could not open the review', message: formatMobileErrorMessage(err) });
    }
  }, [verificationId, setDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = useMemo(() => (data && draft ? checkVerificationDraft(data.form.form, draft, editor.factList) : null), [data, draft, editor.factList]);
  const screens = useMemo(() => (data ? formScreens(verificationSnapshot(data.form.form)) : []), [data]);
  const groups = check ? reviewIssueGroups(screens, check) : [];
  const readOnly = data?.status !== 'DRAFT';
  const differing = useMemo(() => {
    if (!data || !draft) return [];
    return needsVerificationFacts(data.form.form, draft.answers, draft.siteLocations).rowFacts.filter((r) => r.differs);
  }, [data, draft]);

  const toSection = async (screenKey: string) => {
    await saver.flush().catch(() => undefined);
    requestFormScreen(verificationId, screenKey);
    navigation.popTo('NeedsVerificationForm', { verificationId });
  };

  const submit = async () => {
    if (!draft || !check?.canSubmit) return;
    setError(null);
    try {
      setBusy('Saving…');
      await saver.flush();
      await queueVerificationSubmission(draft.id, { submittedAtDevice: nowIso() });
      navigation.popTo('NeedsVerification', { verificationId });
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <FormHeader
      title="Review and submit"
      subtitle={data ? `${verificationLabel(data.v.dto)} · ${data.v.dto.title}` : null}
      backLabel="‹ Back to the form"
      backA11yLabel="Back to the form"
      onBack={() => void saver.flush().catch(() => undefined).then(() => navigation.goBack())}
      topInset={insets.top}
    />
  );

  if (phase.kind !== 'READY' || !data || !draft || !check) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <View style={styles.body}>
          {phase.kind === 'BLOCKED' ? <InfoCallout variant="warning" title={phase.title} description={phase.message} /> : <ActivityIndicator style={{ marginTop: 32 }} accessibilityLabel="Opening the review" />}
        </View>
      </View>
    );
  }

  const form = data.form.form;
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {header}
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {readOnly && (
          <View style={{ marginBottom: 12 }}>
            <InfoCallout variant="info" title="Waiting to send" description={data.lastError ? `${VERIFICATION_WAITING_TEXT} Last attempt: ${data.lastError}` : VERIFICATION_WAITING_TEXT} />
          </View>
        )}

        {!readOnly && <IssueGroupsCard groups={groups} onGo={(key) => void toSection(key)} />}

        <View style={formStyles.card}>
          <Text style={formStyles.label} accessibilityRole="header">
            Sites
          </Text>
          <Text style={formStyles.meta}>{locatedSitesText(form.sites.length, draft.siteLocations, form.sites.map((s) => s.siteNumber))}.</Text>
        </View>

        <View style={formStyles.card}>
          <Text style={formStyles.label} accessibilityRole="header">
            Compared with the needs assessment
          </Text>
          <Text style={[formStyles.meta, differing.length > 0 && formStyles.warningNote]}>
            {differing.length === 0 ? 'Nothing you recorded differs from the needs assessment.' : `${differing.length} facilit${differing.length === 1 ? 'y differs' : 'ies differ'} from the needs assessment:`}
          </Text>
          {differing.map((r) => (
            <Text key={r.rowId} style={formStyles.meta}>
              • {r.facilityName} ({r.unitId}), site {r.siteNumber}: assessment {r.recordedQuantity}, {EXISTING_CONDITION_LABELS[r.recordedCondition].toLowerCase()}
              {r.countedQuantity !== null || r.countedCondition ? `; counted ${r.countedQuantity ?? '–'}${r.countedCondition ? `, ${EXISTING_CONDITION_LABELS[r.countedCondition].toLowerCase()}` : ''}` : ''}
            </Text>
          ))}
        </View>

        <View style={formStyles.card}>
          <Text style={formStyles.label}>Notes for the reviewer</Text>
          <TextInput
            style={[formStyles.input, { minHeight: 110 }, readOnly && formStyles.inputDisabled]}
            multiline
            editable={!readOnly}
            value={draft.notes}
            onChangeText={(t) => update((d) => ({ ...d, notes: t }))}
            maxLength={4000}
            placeholder="Anything the reviewer should know (optional)"
            accessibilityLabel="Notes for the reviewer"
          />
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
              accessibilityLabel={check.canSubmit ? 'Submit the site verification' : 'Submit the site verification, not available until everything is fixed'}
            >
              <Text style={formStyles.primaryButtonText}>{busy ?? 'Submit site verification'}</Text>
            </TouchableOpacity>
            <Text style={[formStyles.meta, { marginTop: 8 }]}>
              {check.canSubmit
                ? 'Works offline: the site verification is saved on the phone and sends with its photos when you are online. It cannot be changed after you submit.'
                : 'Fix the items above to submit.'}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}
