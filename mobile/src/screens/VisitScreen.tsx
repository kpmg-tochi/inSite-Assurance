import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { VISIT_SUBMISSION_STATUS_LABELS, type VisitDetailDto } from '@insite/shared';
import { EmptyStateCard, GradientHeaderLayout, InfoCallout, InSiteLoader } from '../components/common';
import { BackButton, HomeButton, PrimaryButton } from '../components/inputs/Buttons';
import CheckInSheet from '../components/visit/CheckInSheet';
import { DetailLine, OutlineButton, SectionCard, StatusBadges, visitUiStyles } from '../components/visit/VisitUi';
import { useProfile } from '../context/ProfileContext';
import { useOutboxStatus, useVisitData } from '../hooks/useVisitData';
import { hydrateBaselinePack } from '../storage/baselineStore';
import {
  copyRefusedDraft,
  deleteDraft,
  dismissResponseError,
  draftFormState,
  draftOutboxState,
  getVisit,
  getVisitForm,
  listVisitDrafts,
  remapOpenDraftToCurrentForm,
  saveDraft,
  startCorrectionDraft,
  startDraft,
} from '../storage/visitStore';
import { downloadMissingForms, refreshVisitDetail } from '../services/visitSync';
import { geofenceBadgeText } from '../services/locationService';
import type { RootStackParamList } from '../navigation/types';
import { projectToday, visitView } from '../utils/visitCalendar';
import { allowedResponses, checkInAllowed, formStartable, RESPONSE_ACTION_LABELS } from '../utils/visitResponses';
import { personaCopy } from '../utils/personaCopy';
import { formatDay, formatTime, SEVERITY_TEXT, visitBadges } from '../utils/visitText';
import { formatMobileErrorMessage } from '../utils/errorFormatter';
import type { DroppedAnswer } from '../utils/visitForm';
import type { StoredVisitDraft } from '../utils/visitModel';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function droppedText(dropped: DroppedAnswer[]): string {
  return dropped.map((d) => `• ${d.label}: ${d.reason}`).join('\n');
}

/**
 * Redesign R5b: one visit. What it is (project, school, kind, dates, sprint and deliverables,
 * facilities, re-checks), its state with the phone's unsent overlays, the responses it takes, check
 * in (R5c sheet), start / resume the form (D-R5.19 re-map on a rebuilt form), refused drafts
 * (D-R5.20), correction of a returned report, and the reviewer comments (read-only, D-R5.21, online).
 */
export function VisitScreen() {
  const navigation = useNavigation<Nav>();
  const { visitId } = useRoute<RouteProp<RootStackParamList, 'Visit'>>().params;
  const { projects, branding, activeContext } = useProfile();
  const copy = personaCopy(activeContext?.fieldPersonaType, branding.terminology);
  const outbox = useOutboxStatus();

  const { data, loading, reload } = useVisitData(
    async () => {
      const visit = await getVisit(visitId);
      if (!visit) return { visit: null } as const;
      const [pack, form, drafts, formState] = await Promise.all([
        hydrateBaselinePack(visit.projectId),
        getVisitForm(visit.id),
        listVisitDrafts(visit.id),
        draftFormState(visit.id),
      ]);
      const open = drafts.find((d) => d.status === 'DRAFT' || d.status === 'QUEUED') ?? null;
      const queued = open?.status === 'QUEUED' ? await draftOutboxState(open.draft.id) : null;
      return { visit, pack, form, drafts, formState, open, queued };
    },
    [visitId],
    ['visits', 'forms', 'drafts', 'packs']
  );
  // The outbox state of a queued report follows the outbox.
  useEffect(() => {
    reload();
  }, [outbox.pendingCount, outbox.deadCount, reload]);

  const visit = data?.visit ?? null;
  const serverId = visit?.serverId ?? null;
  const projectId = visit?.projectId ?? null;

  // D-R5.21: the reviewer thread, online only.
  const [detail, setDetail] = useState<VisitDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  useEffect(() => {
    if (!serverId || !projectId) return;
    let cancelled = false;
    refreshVisitDetail(projectId, serverId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setDetailError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setDetailError('Comments and returned notes load when you are online.');
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, projectId]);

  // D-R5.19: a draft bound to a form that was rebuilt is moved onto the current form at once.
  const remapping = useRef(false);
  const formStateKind = data?.formState?.kind ?? null;
  useEffect(() => {
    if (formStateKind !== 'REBUILT' || !visit || remapping.current) return;
    remapping.current = true;
    remapOpenDraftToCurrentForm(visit.id)
      .catch((err) => Toast.show({ type: 'error', props: { title: 'Could not move your answers', message: formatMobileErrorMessage(err) } }))
      .finally(() => {
        remapping.current = false;
      });
  }, [formStateKind, visit]);

  const [checkInOpen, setCheckInOpen] = useState(false);
  const [working, setWorking] = useState(false);

  if (loading && !data) {
    return (
      <GradientHeaderLayout title="Visit" leftAction={<BackButton onPress={() => navigation.goBack()} />}>
        <InSiteLoader size="md" />
      </GradientHeaderLayout>
    );
  }
  if (!data || !data.visit) {
    return (
      <GradientHeaderLayout title="Visit" leftAction={<BackButton onPress={() => navigation.goBack()} />}>
        <EmptyStateCard
          title="This visit is not on the phone"
          description="It may have been reassigned or is outside the weeks kept offline. Pull down on Home to refresh."
        />
      </GradientHeaderLayout>
    );
  }

  const { pack, form, drafts, formState, open, queued } = data;
  const v = data.visit;
  const s = v.visit;
  const today = projectToday(pack?.timezone);
  const view = visitView(v, today);
  const canSubmit = Boolean(projects.find((p) => p.projectId === v.projectId)?.permissions.includes('visits:submit'));
  const responses = allowedResponses(v, { canSubmit, workWeekDays: pack?.workWeekDays });
  const sprint = s.sprint ? pack?.sprints.find((x) => x.id === s.sprint!.id) ?? null : null;
  const deliverables = sprint?.deliverables || form?.snapshot.context.sprint?.deliverables || null;
  const facilityBlocks = form?.snapshot.blocks.filter((b) => b.kind === 'FACILITY') ?? [];
  const rechecks = (form?.snapshot.blocks.filter((b) => b.kind === 'RECHECK') ?? []).flatMap((b) => b.fields.filter((f) => f.recheck));
  const refused = drafts.filter((d) => d.status === 'REFUSED');
  const sent = drafts.filter((d) => d.status === 'SENT');
  const remap = open?.status === 'DRAFT' ? open.draft.remap : null;
  const checkIn = v.local.checkIn;

  const run = async (fn: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    try {
      await fn();
    } catch (err) {
      Toast.show({ type: 'error', props: { title: 'Could not continue', message: formatMobileErrorMessage(err) } });
    } finally {
      setWorking(false);
    }
  };

  const openForm = () =>
    run(async () => {
      if (!open && s.status === 'RETURNED') {
        if (!v.serverId) throw new Error('This visit has not reached the server yet.');
        const d = detail ?? (await refreshVisitDetail(v.projectId, v.serverId).catch(() => null));
        if (!d) throw new Error('Connect to the internet to load the returned report, then try again.');
        const { dropped } = await startCorrectionDraft(v.id, d);
        if (dropped.length > 0) {
          Alert.alert('Take these again', `Photos and voice notes cannot be reused in a correction:\n${droppedText(dropped)}`);
        }
      } else if (!open) {
        await startDraft(v.id);
      }
      navigation.navigate('VisitForm', { visitId: v.id });
    });

  const copyRefused = (d: StoredVisitDraft) =>
    run(async () => {
      const { dropped } = await copyRefusedDraft(d.draft.id);
      if (dropped.length > 0) Alert.alert('Some answers were dropped', droppedText(dropped));
      navigation.navigate('VisitForm', { visitId: v.id });
    });

  const removeRefused = (d: StoredVisitDraft) =>
    Alert.alert('Delete this report?', 'It was refused by the server and will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run(() => deleteDraft(d.draft.id)) },
    ]);

  const downloadForm = () =>
    run(async () => {
      const n = await downloadMissingForms([v]);
      if (n === 0) throw new Error('Could not download the form. Check your connection and try again.');
    });

  const checkInText = checkIn
    ? `Checked in on this phone, ${formatTime(checkIn.checkedInAt)}${
        checkIn.latitude == null ? ', no location' : checkIn.geofenceStatus ? `, ${geofenceBadgeText(checkIn.geofenceStatus, checkIn.distanceOutsideMeters)}` : ''
      }${checkIn.sent ? '' : ` (${copy.waitingToSend.toLowerCase()})`}`
    : s.checkInAt
      ? `Checked in ${formatTime(s.checkInAt)}`
      : null;

  const startable = formStartable(v, canSubmit);
  const formButton = open ? copy.resumeFormButton : s.status === 'RETURNED' ? copy.correctFormButton : copy.startFormButton;

  return (
    <GradientHeaderLayout
      title={view.kindLabel}
      subtitle={`${s.projectCode} · ${s.projectName}`}
      leftAction={<BackButton onPress={() => navigation.goBack()} />}
      rightAction={<HomeButton onPress={() => navigation.popTo('Home')} />}
      contentContainerStyle={styles.body}
    >
      <StatusBadges badges={visitBadges(view)} />
      {v.local.createError ? <InfoCallout variant="warning" title="The server refused this visit" description={v.local.createError} /> : null}
      {v.local.removedFromFeedAt ? (
        <InfoCallout variant="warning" title="No longer in your visits" description="The server no longer lists this visit for you. Your report on this phone is kept." />
      ) : null}
      {v.local.responseError ? (
        <TouchableOpacity onPress={() => void dismissResponseError(v.id)} accessibilityRole="button" accessibilityLabel="Dismiss this message">
          <InfoCallout
            variant="warning"
            title={`${RESPONSE_ACTION_LABELS[v.local.responseError.action]} not sent`}
            description={`${v.local.responseError.message} Tap to dismiss.`}
          />
        </TouchableOpacity>
      ) : null}

      <SectionCard title="Visit">
        <DetailLine label={copy.beneficiaryLabel} value={pack?.school} />
        <DetailLine label="Date" value={`${formatDay(view.date, true)}${view.datePending ? ' (move waiting to send)' : ''}`} />
        {s.originalPlannedDate !== s.plannedDate ? <DetailLine label="First planned" value={formatDay(s.originalPlannedDate, true)} /> : null}
        <DetailLine label="Report due" value={s.submissionDeadline ? formatDay(s.submissionDeadline, true) : null} />
        <DetailLine label="Officers" value={s.assignees.map((a) => (a.isLead ? `${a.fullName} (lead)` : a.fullName)).join(', ')} />
        {s.sprint ? <DetailLine label="Sprint" value={`Sprint ${s.sprint.number}: ${s.sprint.name}`} /> : null}
        {deliverables ? <DetailLine label="Deliverables" value={deliverables} /> : null}
        {checkInText ? <DetailLine label="Check-in" value={checkInText} /> : null}
      </SectionCard>

      {responses.length > 0 && (
        <SectionCard title="Your response" subtitle="Saved on this phone and sent when you are online.">
          <View style={visitUiStyles.row}>
            {responses.map((a) => (
              <OutlineButton
                key={a}
                text={RESPONSE_ACTION_LABELS[a]}
                tone={a === 'DECLINE' ? 'danger' : 'primary'}
                onPress={() => navigation.navigate('VisitRespond', { visitId: v.id, action: a })}
              />
            ))}
          </View>
        </SectionCard>
      )}

      {remap ? (
        <View style={styles.notice}>
          <InfoCallout
            variant="warning"
            title="The form was rebuilt"
            description={
              remap.dropped.length > 0
                ? `Your answers were moved to the new form. These could not be kept:\n${droppedText(remap.dropped)}`
                : 'Your answers were moved to the new form. Nothing was lost.'
            }
          />
          <OutlineButton text="OK" tone="neutral" onPress={() => void run(() => saveDraft({ ...open!.draft, remap: null }))} />
        </View>
      ) : null}

      {checkInAllowed(v, canSubmit) && (
        <PrimaryButton text={copy.checkInButton} onPress={() => setCheckInOpen(true)} accessibilityLabel={`${copy.checkInButton} to ${view.kindLabel}`} />
      )}
      {startable && formState.kind === 'FORM_MISSING' ? (
        <SectionCard title="The form is not on this phone yet" subtitle="Connect once to download it; after that the visit works offline.">
          <OutlineButton text="Download the form" icon="download" onPress={() => void downloadForm()} disabled={working} />
        </SectionCard>
      ) : startable && open?.status !== 'QUEUED' ? (
        <PrimaryButton text={formButton} onPress={() => void openForm()} isWorking={working} />
      ) : null}
      {!canSubmit ? <Text style={visitUiStyles.muted}>Your role on this project can view visits but not submit them.</Text> : null}

      {open?.status === 'QUEUED' && (
        <SectionCard title="Report saved" subtitle={copy.waitingToSend}>
          <Text style={visitUiStyles.body}>
            {queued?.status === 'DEAD' || queued?.status === 'HELD'
              ? `Not sent: ${queued.lastError ?? 'the server refused it.'} Open the outbox to retry.`
              : queued?.lastError
                ? `Trying again: ${queued.lastError}`
                : 'It is sent after its photos and check-in, as soon as there is a connection.'}
          </Text>
          <OutlineButton text="Open the outbox" icon="upload-cloud" tone="neutral" onPress={() => navigation.navigate('Outbox')} />
        </SectionCard>
      )}

      {refused.map((d) => (
        <SectionCard key={d.draft.id} title="Report refused" subtitle={`Last changed ${formatTime(d.updatedAt)}`}>
          <Text style={visitUiStyles.errorText}>{d.lastError ?? 'The server refused this report.'}</Text>
          <View style={visitUiStyles.row}>
            {!open && startable && <OutlineButton text="Copy into a new report" icon="copy" onPress={() => void copyRefused(d)} disabled={working} />}
            <OutlineButton text="Delete" icon="trash-2" tone="danger" onPress={() => removeRefused(d)} disabled={working} />
          </View>
        </SectionCard>
      ))}

      {sent.length > 0 && (
<Text style={visitUiStyles.muted}>Report sent from this phone, {formatTime(sent[0].updatedAt)}.</Text>
      )}

      <SectionCard
        title="Facilities to check"
        subtitle={facilityBlocks.length === 0 ? (form ? 'This visit has no facility sections.' : `${s.facilityCount} facilit${s.facilityCount === 1 ? 'y' : 'ies'}`) : null}
      >
        {facilityBlocks.map((b) => (
          <View key={b.key} style={styles.item}>
            <Text style={visitUiStyles.strong}>{b.facility?.name ?? b.title}</Text>
            {b.units.length > 0 && <Text style={visitUiStyles.muted}>{b.units.map((u) => u.label).join(', ')}</Text>}
          </View>
        ))}
      </SectionCard>

      {(rechecks.length > 0 || s.recheckCount > 0) && (
        <SectionCard title="Findings to re-check" subtitle={rechecks.length === 0 ? `${s.recheckCount} in the form` : null}>
          {rechecks.map((f) => (
            <View key={f.path} style={styles.item}>
              <Text style={visitUiStyles.strong}>
                {f.recheck!.severity ? `${SEVERITY_TEXT[f.recheck!.severity as keyof typeof SEVERITY_TEXT] ?? f.recheck!.severity}: ` : ''}
                {f.recheck!.title}
              </Text>
              <Text style={visitUiStyles.muted}>Raised {formatDay(f.recheck!.raisedDate)}</Text>
            </View>
          ))}
        </SectionCard>
      )}

      <SectionCard title="Review and comments" subtitle={detailError ?? (v.serverId ? null : 'Available once the visit reaches the server.')}>
        {detail?.submissions
          .filter((sub) => sub.status === 'RETURNED' && sub.returnedNotes)
          .map((sub) => (
            <View key={sub.id} style={styles.item}>
              <Text style={visitUiStyles.strong}>
                Revision {sub.revisionNumber}: {VISIT_SUBMISSION_STATUS_LABELS[sub.status]}
              </Text>
              <Text style={visitUiStyles.body}>{sub.returnedNotes}</Text>
            </View>
          ))}
        {detail && detail.comments.length === 0 && !detail.submissions.some((sub) => sub.returnedNotes) ? (
          <Text style={visitUiStyles.muted}>No comments yet.</Text>
        ) : null}
        {detail?.comments
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((c) => (
            <View key={c.id} style={styles.item}>
              <Text style={visitUiStyles.strong}>
                {c.authorName} · {formatTime(c.createdAt)}
              </Text>
              <Text style={visitUiStyles.body}>{c.text}</Text>
            </View>
          ))}
        {detail ? <Text style={visitUiStyles.muted}>Replies are made on the web for now.</Text> : null}
      </SectionCard>

      <CheckInSheet
        visitId={v.id}
        visible={checkInOpen}
        onClose={() => setCheckInOpen(false)}
        onCheckedIn={() => {
          setCheckInOpen(false);
          void openForm();
        }}
      />
    </GradientHeaderLayout>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 40 },
  item: { gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  notice: { gap: 8 },
});
