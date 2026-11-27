import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { EmptyStateCard, GradientHeaderLayout, InfoCallout, InSiteLoader } from '../../components/common';
import { BackButton, HomeButton, PrimaryButton } from '../../components/inputs/Buttons';
import { DetailLine, OutlineButton, SectionCard, StatusBadges, visitUiStyles } from '../../components/visit/VisitUi';
import { SiteLocationCard } from '../../components/needsVerification/SiteLocationCard';
import { useOutboxStatus, useVisitData } from '../../hooks/useVisitData';
import {
  copyRefusedVerificationDraft,
  deleteVerificationDraft,
  ensureEditableVerificationDraft,
  getCurrentNeedsVerificationForm,
  getNeedsVerification,
  listVerificationDrafts,
  recordVerificationSiteLocation,
  saveVerificationDraft,
  verificationDraftOutboxState,
} from '../../storage/needsVerificationStore';
import { downloadMissingVerificationForms, getNeedsVerificationSyncState } from '../../services/needsVerificationSync';
import { acquireFix } from '../../services/locationService';
import type { RootStackParamList } from '../../navigation/types';
import { projectToday } from '../../utils/visitCalendar';
import {
  locatedSitesText,
  NO_LOCATION_FIX_MESSAGE,
  siteLocationFromFix,
  verificationBadges,
  verificationFormAccess,
  verificationFormButton,
  verificationPurposeText,
  verificationView,
  type StoredNeedsVerificationDraft,
} from '../../utils/needsVerification';
import type { DroppedAnswer } from '../../utils/visitForm';
import { formatDay, formatTime } from '../../utils/visitText';
import { formatMobileErrorMessage } from '../../utils/errorFormatter';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const droppedText = (dropped: DroppedAnswer[]) => dropped.map((d) => `• ${d.label}: ${d.reason}`).join('\n');

/**
 * Needs pipeline wave 5 (N8): one field verification of a proposed project. What it is (reference,
 * programme, purpose, due date, who assigned it, instructions), its state with the phone's unsent
 * overlays, each school site with "Record location here" (distance from the stored point and
 * accuracy; no map component exists in the app, so sites are a list), and start / continue / correct
 * the form. Refused drafts can be copied onto the current form or deleted. Everything works offline
 * once the form is on the phone.
 */
export function NeedsVerificationScreen() {
  const navigation = useNavigation<Nav>();
  const { verificationId } = useRoute<RouteProp<RootStackParamList, 'NeedsVerification'>>().params;
  const outbox = useOutboxStatus();
  const [working, setWorking] = useState<string | null>(null);

  const { data, loading, reload } = useVisitData(
    async () => {
      const v = await getNeedsVerification(verificationId);
      if (!v) return { v: null } as const;
      const [form, drafts] = await Promise.all([getCurrentNeedsVerificationForm(v.id), listVerificationDrafts(v.id)]);
      const open = drafts.find((d) => d.status === 'DRAFT' || d.status === 'QUEUED') ?? null;
      const queued = open?.status === 'QUEUED' ? await verificationDraftOutboxState(open.draft.id) : null;
      return { v, form, drafts, open, queued, formError: getNeedsVerificationSyncState().formErrors[v.id] ?? null };
    },
    [verificationId],
    ['verifications', 'captures']
  );
  // The outbox state of a queued submission follows the outbox.
  useEffect(() => {
    reload();
  }, [outbox.pendingCount, outbox.deadCount, reload]);

  if (loading && !data) {
    return (
      <GradientHeaderLayout title="Site verification" leftAction={<BackButton onPress={() => navigation.goBack()} />}>
        <InSiteLoader size="md" />
      </GradientHeaderLayout>
    );
  }
  if (!data || !data.v) {
    return (
      <GradientHeaderLayout title="Site verification" leftAction={<BackButton onPress={() => navigation.goBack()} />}>
        <EmptyStateCard title="This site verification is not on the phone" description="It may have been cancelled or reassigned. Pull down on Home to refresh." />
      </GradientHeaderLayout>
    );
  }

  const { v, form, drafts, open, queued, formError } = data;
  const dto = v.dto;
  const view = verificationView(v, projectToday(deviceZone()));
  const access = verificationFormAccess(v, { open, latest: drafts[0] ?? null });
  const editable = access.mode === 'EDIT' || access.mode === 'START';
  const shown = open ?? drafts[0] ?? null;
  const locations = shown?.draft.siteLocations ?? [];
  const refused = drafts.filter((d) => d.status === 'REFUSED');
  const sent = drafts.filter((d) => d.status === 'SENT');
  const returned = dto.submission?.status === 'RETURNED' ? dto.submission : null;
  const remap = open?.status === 'DRAFT' ? open.draft.remap : null;
  const button = verificationFormButton(access);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (working) return;
    setWorking(label);
    try {
      await fn();
    } catch (err) {
      Toast.show({ type: 'error', props: { title: 'Could not continue', message: formatMobileErrorMessage(err) } });
    } finally {
      setWorking(null);
    }
  };

  const openForm = () =>
    run('form', async () => {
      const d = await ensureEditableVerificationDraft(v.id);
      if (d.draft.remap?.dropped.length && access.mode === 'START') {
        Alert.alert('Take these again', `Photos and voice notes of the returned site verification cannot be reused:\n${droppedText(d.draft.remap.dropped)}`);
      }
      navigation.navigate('NeedsVerificationForm', { verificationId: v.id });
    });

  const recordLocation = (siteNumber: number) =>
    run(`site-${siteNumber}`, async () => {
      const fix = await acquireFix();
      if (!fix) throw new Error(NO_LOCATION_FIX_MESSAGE);
      await recordVerificationSiteLocation(v.id, siteLocationFromFix(siteNumber, fix));
    });

  const copyRefused = (d: StoredNeedsVerificationDraft) =>
    run('copy', async () => {
      const fresh = await copyRefusedVerificationDraft(d.draft.id);
      if (fresh.draft.remap?.dropped.length) Alert.alert('Some answers were dropped', droppedText(fresh.draft.remap.dropped));
      navigation.navigate('NeedsVerificationForm', { verificationId: v.id });
    });

  const removeRefused = (d: StoredNeedsVerificationDraft) =>
    Alert.alert('Delete this site verification?', 'It was refused by the server and will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run('delete', () => deleteVerificationDraft(d.draft.id)) },
    ]);

  const downloadForm = () =>
    run('download', async () => {
      const n = await downloadMissingVerificationForms();
      reload();
      if (n === 0 && !(await getCurrentNeedsVerificationForm(v.id))) throw new Error('Could not download the form. Check your connection and try again.');
    });

  return (
    <GradientHeaderLayout
      title={view.label}
      subtitle={dto.title}
      leftAction={<BackButton onPress={() => navigation.goBack()} />}
      rightAction={<HomeButton onPress={() => navigation.popTo('Home')} />}
      contentContainerStyle={styles.body}
    >
      <StatusBadges badges={verificationBadges(view)} />
      {v.local.removedFromFeedAt ? (
        <InfoCallout variant="warning" title="No longer assigned to you" description="The server no longer lists this site verification for you. Your answers on this phone are kept." />
      ) : null}
      {dto.status === 'CANCELLED' ? <InfoCallout variant="warning" title="Cancelled" description={dto.cancelReason ? `Reason: ${dto.cancelReason}` : 'This site verification was cancelled.'} /> : null}
      {returned && dto.status === 'RETURNED' ? (
        <InfoCallout
          variant="warning"
          title="Returned to you"
          description={`${returned.reviewedByName ?? 'The reviewer'}${returned.reviewedAt ? `, ${formatTime(returned.reviewedAt)}` : ''}: ${returned.reviewReason ?? 'Check the answers and submit again.'}`}
        />
      ) : null}
      {formError ? <InfoCallout variant="warning" title="Form not downloaded" description={formError} /> : null}

      <SectionCard title={verificationPurposeText(dto)}>
        <DetailLine label="Proposed project" value={`${dto.reference} · ${dto.title}`} />
        <DetailLine label="Programme" value={dto.programmeName} />
        <DetailLine label="Due" value={`${formatDay(dto.dueDate, true)}${view.overdue ? ' (overdue)' : ''}`} />
        <DetailLine label="Assigned by" value={`${dto.assignedBy.name}, ${formatTime(dto.assignedAt)}`} />
        <DetailLine label="Needs assessment" value={`Version ${dto.versionNumber}`} />
        <DetailLine label="To check" value={`${dto.sites.length} site${dto.sites.length === 1 ? '' : 's'}, ${dto.rowCount} facilit${dto.rowCount === 1 ? 'y' : 'ies'}`} />
        {dto.instructions ? <DetailLine label="Instructions" value={dto.instructions} /> : null}
      </SectionCard>

      {remap ? (
        <View style={styles.notice}>
          <InfoCallout
            variant="warning"
            title={remap.dropped.length ? 'Take these again' : 'Answers moved'}
            description={remap.dropped.length ? droppedText(remap.dropped) : 'Your earlier answers were moved onto this site verification. Nothing was lost.'}
          />
          <OutlineButton text="OK" tone="neutral" onPress={() => void run('remap', () => saveVerificationDraft({ ...open!.draft, remap: null }))} />
        </View>
      ) : null}

      <SectionCard
        title="School sites"
        subtitle={`${locatedSitesText(dto.sites.length, locations, dto.sites.map((s) => s.siteNumber))}. Stand at each school and record the location there.`}
      >
        {dto.sites.map((site) => (
          <SiteLocationCard
            key={site.siteNumber}
            site={site}
            location={locations.find((l) => l.siteNumber === site.siteNumber) ?? null}
            editable={editable && Boolean(form)}
            busy={working === `site-${site.siteNumber}`}
            onRecord={() => void recordLocation(site.siteNumber)}
          />
        ))}
      </SectionCard>

      {editable && !form ? (
        <SectionCard title="The form is not on this phone yet" subtitle="Connect once to download it; after that the site verification works offline.">
          <OutlineButton text="Download the form" icon="download" onPress={() => void downloadForm()} disabled={Boolean(working)} />
        </SectionCard>
      ) : button ? (
        <PrimaryButton text={button} onPress={() => void openForm()} isWorking={working === 'form'} />
      ) : null}

      {open?.status === 'QUEUED' && (
        <SectionCard title="Site verification saved" subtitle="Waiting to send">
          <Text style={visitUiStyles.body}>
            {queued?.status === 'DEAD' || queued?.status === 'HELD'
              ? `Not sent: ${queued.lastError ?? 'the server refused it.'} Open the outbox to retry.`
              : queued?.lastError
                ? `Trying again: ${queued.lastError}`
                : 'It is sent after its photos, as soon as there is a connection.'}
          </Text>
          <View style={visitUiStyles.row}>
            <OutlineButton text="See the answers" icon="eye" tone="neutral" onPress={() => navigation.navigate('NeedsVerificationForm', { verificationId: v.id })} />
            <OutlineButton text="Open the outbox" icon="upload-cloud" tone="neutral" onPress={() => navigation.navigate('Outbox')} />
          </View>
        </SectionCard>
      )}

      {refused.map((d) => (
        <SectionCard key={d.draft.id} title="Site verification refused" subtitle={`Last changed ${formatTime(d.updatedAt)}`}>
          <Text style={visitUiStyles.errorText}>{d.lastError ?? 'The server refused this site verification.'}</Text>
          <View style={visitUiStyles.row}>
            {!open && access.mode === 'READ_ONLY' && access.canCopy && (
              <OutlineButton text="Copy into a new site verification" icon="copy" onPress={() => void copyRefused(d)} disabled={Boolean(working)} />
            )}
            <OutlineButton text="Delete" icon="trash-2" tone="danger" onPress={() => removeRefused(d)} disabled={Boolean(working)} />
          </View>
        </SectionCard>
      ))}

      {sent.length > 0 && (
        <View style={styles.notice}>
          <Text style={visitUiStyles.muted}>Site verification sent from this phone, {formatTime(sent[0].updatedAt)}.</Text>
          {access.mode === 'READ_ONLY' && access.draft.status === 'SENT' ? (
            <OutlineButton text="See the answers sent" icon="eye" tone="neutral" onPress={() => navigation.navigate('NeedsVerificationForm', { verificationId: v.id })} />
          ) : null}
        </View>
      )}
      {access.mode === 'BLOCKED' && dto.status !== 'CANCELLED' ? <Text style={visitUiStyles.muted}>{access.message}</Text> : null}
    </GradientHeaderLayout>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 40 },
  notice: { gap: 8 },
});
