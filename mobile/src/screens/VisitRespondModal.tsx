import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import type { VisitResponseAction } from '@insite/shared';
import { EmptyStateCard, GradientHeaderLayout, InSiteLoader } from '../components/common';
import { IconButton, PrimaryButton } from '../components/inputs/Buttons';
import { DateGrid } from '../components/visit/DateGrid';
import { SectionCard, visitUiStyles } from '../components/visit/VisitUi';
import { useActiveBranding, useProfile } from '../context/ProfileContext';
import { useVisitData } from '../hooks/useVisitData';
import { hydrateBaselinePack } from '../storage/baselineStore';
import { getVisit, queueVisitResponse } from '../storage/visitStore';
import type { RootStackParamList } from '../navigation/types';
import { projectToday } from '../utils/visitCalendar';
import {
  allowedResponses,
  commentRequired,
  moveDates,
  proposeDateProblem,
  RESPONSE_ACTION_LABELS,
  RESPONSE_COMMENT_MAX,
  RESPONSE_COMMENT_MIN,
  responseProblem,
} from '../utils/visitResponses';
import { formatDay } from '../utils/visitText';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ACTION_HELP: Record<VisitResponseAction, string> = {
  CONFIRM: 'Tell the manager you will do this visit on its date.',
  MOVE: 'Move the visit to another day inside the window you are allowed. The new date is agreed at once.',
  PROPOSE: 'Ask the manager for a date outside your window. The visit keeps its date until the manager decides.',
  DECLINE: 'Say you cannot do this visit. The manager reassigns or reschedules it.',
};

/**
 * Redesign R5b (D-R5.11): Confirm, Move, Propose a date or Decline, queued as VISIT_RESPONSE and
 * shown as "Waiting to send" until the server has it. Move offers only the dates of the server's
 * window (`moveDates`); Propose takes any later date outside it. Move, Propose and Decline need a
 * comment.
 */
export function VisitRespondModal() {
  const navigation = useNavigation<Nav>();
  const { visitId, action: initialAction } = useRoute<RouteProp<RootStackParamList, 'VisitRespond'>>().params;
  const { projects } = useProfile();
  const { primaryColor } = useActiveBranding();
  const { data, loading } = useVisitData(
    async () => {
      const visit = await getVisit(visitId);
      const pack = visit ? await hydrateBaselinePack(visit.projectId) : null;
      return { visit, pack };
    },
    [visitId],
    ['visits', 'packs']
  );
  const [action, setAction] = useState<VisitResponseAction>(initialAction);
  const [date, setDate] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDate(null);
    setProblem(null);
  }, [action]);

  const visit = data?.visit ?? null;
  const pack = data?.pack ?? null;
  const canSubmit = Boolean(visit && projects.find((p) => p.projectId === visit.projectId)?.permissions.includes('visits:submit'));
  const today = projectToday(pack?.timezone);
  const workWeekDays = pack?.workWeekDays ?? null;
  const actions = visit ? allowedResponses(visit, { canSubmit, workWeekDays }) : [];

  const close = () => navigation.goBack();

  const submit = async () => {
    if (!visit) return;
    const input = { action, date, comment };
    const found = responseProblem(visit, input, { today, canSubmit, workWeekDays });
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    try {
      await queueVisitResponse(visit.id, input, { today, canSubmit, workWeekDays });
      Toast.show({
        type: 'success',
        props: { title: `${RESPONSE_ACTION_LABELS[action]} saved`, message: 'It is sent as soon as there is a connection.' },
      });
      close();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GradientHeaderLayout
      title={RESPONSE_ACTION_LABELS[action]}
      subtitle={visit ? `${visit.visit.projectCode} · ${formatDay(visit.visit.plannedDate, true)}` : undefined}
      rightAction={<IconButton icon="close" text="Close" onPress={close} />}
      contentContainerStyle={styles.body}
    >
      {loading && !data ? (
        <InSiteLoader size="md" />
      ) : !visit ? (
        <EmptyStateCard title="Visit not on this phone" description="Refresh your visits on Home and try again." />
      ) : actions.length === 0 ? (
        <EmptyStateCard
          title="Nothing to respond to"
          description={
            visit.local.pendingResponse
              ? 'Your last response is still waiting to send. You can respond again once it has gone.'
              : 'This visit no longer takes responses (it was checked in, completed or changed).'
          }
          actionLabel="Close"
          onAction={close}
        />
      ) : (
        <>
          {actions.length > 1 && (
            <View style={styles.segment} accessibilityRole="tablist">
              {actions.map((a) => {
                const on = a === action;
                return (
                  <TouchableOpacity
                    key={a}
                    style={[styles.segmentItem, on && { backgroundColor: primaryColor, borderColor: primaryColor }]}
                    onPress={() => setAction(a)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={RESPONSE_ACTION_LABELS[a]}
                  >
                    <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{RESPONSE_ACTION_LABELS[a]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {!actions.includes(action) ? (
            <Text style={visitUiStyles.errorText}>{RESPONSE_ACTION_LABELS[action]} is not available for this visit now. Pick another response.</Text>
          ) : (
            <>
              <Text style={visitUiStyles.body}>{ACTION_HELP[action]}</Text>

              {action === 'MOVE' && (
                <SectionCard
                  title="New date"
                  subtitle={visit.moveWindow ? `You can move between ${formatDay(visit.moveWindow.from)} and ${formatDay(visit.moveWindow.to)}.` : null}
                >
                  <View style={styles.chips}>
                    {moveDates(visit.visit.plannedDate, visit.moveWindow, workWeekDays).map((d) => {
                      const on = d === date;
                      return (
                        <TouchableOpacity
                          key={d}
                          style={[styles.chip, on && { backgroundColor: primaryColor, borderColor: primaryColor }]}
                          onPress={() => setDate(d)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`Move to ${formatDay(d, true)}`}
                        >
                          <Text style={[styles.chipText, on && styles.segmentTextOn]}>{formatDay(d)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </SectionCard>
              )}

              {action === 'PROPOSE' && (
                <SectionCard title="Date to propose" subtitle={date ? `Selected: ${formatDay(date, true)}` : 'Pick a date outside your move window.'}>
                  <DateGrid
                    initialDate={visit.visit.plannedDate > today ? visit.visit.plannedDate : today}
                    selected={date}
                    onSelect={setDate}
                    isEnabled={(d) => proposeDateProblem(visit.visit.plannedDate, visit.moveWindow, d, today) === null}
                  />
                </SectionCard>
              )}

              <SectionCard title={commentRequired(action) ? 'Comment (required)' : 'Comment (optional)'}>
                <TextInput
                  style={styles.input}
                  value={comment}
                  onChangeText={setComment}
                  placeholder={commentRequired(action) ? `Say why (at least ${RESPONSE_COMMENT_MIN} characters)` : 'Anything the manager should know'}
                  multiline
                  maxLength={RESPONSE_COMMENT_MAX}
                  accessibilityLabel={commentRequired(action) ? 'Comment, required' : 'Comment, optional'}
                />
              </SectionCard>

              {problem ? (
                <Text style={visitUiStyles.errorText} accessibilityLiveRegion="polite">
                  {problem}
                </Text>
              ) : null}
              <PrimaryButton text={`${RESPONSE_ACTION_LABELS[action]}`} onPress={() => void submit()} isWorking={busy} />
              <Text style={visitUiStyles.muted}>Saved on this phone first; it is sent when you are online.</Text>
            </>
          )}
        </>
      )}
    </GradientHeaderLayout>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 40 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segmentItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  segmentText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  segmentTextOn: { color: '#FFFFFF' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
});
