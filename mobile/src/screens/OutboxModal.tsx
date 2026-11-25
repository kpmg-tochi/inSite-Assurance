import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatElapsedTime, formatProjectCode } from '@insite/shared';
import { EmptyStateCard, GradientHeaderLayout, InfoCallout, InSiteLoader, Pill, type PillVariant } from '../components/common';
import { IconButton } from '../components/inputs/Buttons';
import { OutlineButton, SectionCard, visitUiStyles } from '../components/visit/VisitUi';
import { useActiveBranding, useProfile } from '../context/ProfileContext';
import { useOutboxStatus, useVisitData } from '../hooks/useVisitData';
import { listOutboxItems, removeOutboxItem, resendHeldItem } from '../storage/outbox/outboxItems';
import { retryOutboxItem, runOutbox } from '../storage/outbox/outboxProcessor';
import { HELD_EXPLANATION } from '../storage/heldItems';
import type { RootStackParamList } from '../navigation/types';
import { personaCopy } from '../utils/personaCopy';
import { formatTime } from '../utils/visitText';
import { formatMobileErrorMessage } from '../utils/errorFormatter';
import {
  groupOutboxItems,
  OUTBOX_REMOVE_TEXT,
  type OutboxItemState,
  type OutboxRowView,
} from '../utils/outboxView';

const STATE_VARIANT: Record<OutboxItemState, PillVariant> = {
  WAITING: 'info',
  WAITING_FOR_OTHERS: 'info',
  RETRYING: 'warning',
  FAILED: 'negative',
  REFUSED: 'negative',
  HELD: 'warning',
};

/**
 * Redesign R5e: the Outbox. Everything on this phone that is not sent yet, per project: waiting,
 * failed and held items with their last error. Failed items can be retried; a refused visit report,
 * a failed response, defect update or incident, and a held photo can be removed (rules in
 * `utils/outboxView.ts`). Opened from the Home header badge.
 */
export const OutboxModal: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { projects, activeContext } = useProfile();
  const copy = personaCopy(activeContext?.fieldPersonaType, useActiveBranding().terminology);
  const status = useOutboxStatus();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: items, loading, error, reload } = useVisitData(listOutboxItems, [], ['drafts', 'visits', 'siteLog', 'captures']);
  // The list follows the outbox as it sends.
  useEffect(() => {
    reload();
  }, [status.pendingCount, status.deadCount, status.isSyncing, reload]);

  const names = useMemo(() => new Map(projects.map((p) => [p.projectId, `${formatProjectCode(p.projectCodePrefix)} · ${p.projectName}`])), [projects]);
  const groups = useMemo(() => groupOutboxItems(items ?? [], (id) => names.get(id) ?? null), [items, names]);
  const total = items?.length ?? 0;

  const run = useCallback(
    async (row: OutboxRowView, work: () => Promise<void>) => {
      setBusyId(row.item.id);
      try {
        await work();
      } catch (e) {
        Alert.alert('Could not do that', formatMobileErrorMessage(e));
      } finally {
        setBusyId(null);
        reload();
      }
    },
    [reload]
  );

  const confirmRemove = (row: OutboxRowView) => {
    const action = row.actions.remove;
    if (!action) return;
    const text = OUTBOX_REMOVE_TEXT[action];
    Alert.alert(text.title, text.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: text.button, style: 'destructive', onPress: () => void run(row, () => removeOutboxItem(row.item)) },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await runOutbox('manual');
    } finally {
      setRefreshing(false);
      reload();
    }
  };

  const summary =
    total === 0
      ? 'Everything on this phone has been sent.'
      : `${status.pendingCount} waiting${status.deadCount ? `, ${status.deadCount} failed` : ''}.`;

  return (
    <GradientHeaderLayout
      scrollable={false}
      title="Outbox"
      subtitle={`${summary}${status.lastSyncedAt ? ` Last sent ${lastSentText(formatElapsedTime(status.lastSyncedAt))}.` : ''}`}
      rightAction={<IconButton icon="close" onPress={() => navigation.goBack()} />}
      contentContainerStyle={styles.layout}
    >
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 24, 32) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#00715D" />}
      >
        <View style={visitUiStyles.row}>
          <Pill
            variant={status.pausedReason ? 'warning' : status.isOnline ? 'positive' : 'info'}
            text={status.pausedReason ? 'Paused' : status.isSyncing ? 'Sending' : status.isOnline ? 'Online' : 'Offline'}
          />
          {status.isOnline && total > 0 && !status.isSyncing ? (
            <OutlineButton text="Send now" icon="upload-cloud" onPress={() => void onRefresh()} />
          ) : null}
        </View>
        {status.pausedReason ? <InfoCallout variant="warning" title="Sending is paused" description={status.pausedReason} /> : null}
        {!status.isOnline && !status.pausedReason ? (
          <InfoCallout variant="info" title="Offline" description="Everything here is saved on this phone and sends when you are online." />
        ) : null}
        {status.storageEncrypted === false ? (
          <InfoCallout
            variant="warning"
            title="Local data is not encrypted"
            description="This is a development build without SQLCipher. Release builds encrypt data on the device."
          />
        ) : null}
        {error ? <InfoCallout variant="warning" title="Could not read the outbox" description={error} /> : null}

        {loading && !items ? (
          <InSiteLoader size="md" label="Reading the outbox..." />
        ) : groups.length === 0 ? (
          <EmptyStateCard title="Nothing waiting" description={copy.outboxEmptyDescription} />
        ) : (
          groups.map((g) => (
            <SectionCard key={g.projectId} title={g.projectName} subtitle={groupSubtitle(g.counts)}>
              {g.rows.map((row) => (
                <OutboxRow
                  key={row.item.id}
                  row={row}
                  busy={busyId === row.item.id}
                  onRetry={() => void run(row, () => retryOutboxItem(row.item.id))}
                  onResend={() => void run(row, () => resendHeldItem(row.item))}
                  onRemove={() => confirmRemove(row)}
                />
              ))}
            </SectionCard>
          ))
        )}
      </ScrollView>
    </GradientHeaderLayout>
  );
};

function groupSubtitle(counts: { waiting: number; failed: number; held: number }): string {
  const parts = [`${counts.waiting} waiting`];
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.held) parts.push(`${counts.held} on hold`);
  return parts.join(' · ');
}

function OutboxRow({
  row,
  busy,
  onRetry,
  onResend,
  onRemove,
}: {
  row: OutboxRowView;
  busy: boolean;
  onRetry: () => void;
  onResend: () => void;
  onRemove: () => void;
}) {
  const { item, actions } = row;
  const showError = item.lastError && (row.state === 'FAILED' || row.state === 'REFUSED' || row.state === 'RETRYING');
  return (
    <View style={styles.row} accessible={false}>
      <View style={styles.rowTop}>
        <Text style={visitUiStyles.strong}>{row.label}</Text>
        <Pill variant={STATE_VARIANT[row.state]} text={row.stateText} />
      </View>
      <Text style={visitUiStyles.muted}>Saved {formatTime(item.createdAt)}</Text>
      {showError ? <Text style={visitUiStyles.errorText}>{item.lastError}</Text> : null}
      {row.state === 'HELD' ? <Text style={visitUiStyles.muted}>{HELD_EXPLANATION}</Text> : null}
      {actions.retry || actions.resendHeld || actions.remove ? (
        <View style={visitUiStyles.row}>
          {actions.retry ? (
            <OutlineButton text="Retry" icon="refresh-cw" onPress={onRetry} disabled={busy} accessibilityLabel={`Retry ${row.label}`} />
          ) : null}
          {actions.resendHeld ? (
            <OutlineButton text="Send again" icon="upload-cloud" onPress={onResend} disabled={busy} accessibilityLabel={`Send ${row.label} again`} />
          ) : null}
          {actions.remove ? (
            <OutlineButton
              text={OUTBOX_REMOVE_TEXT[actions.remove].button}
              icon="trash-2"
              tone="danger"
              onPress={onRemove}
              disabled={busy}
              accessibilityLabel={`${OUTBOX_REMOVE_TEXT[actions.remove].button}: ${row.label}`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** "just now" or "5m ago" (formatElapsedTime returns "Just now" without a unit). */
function lastSentText(elapsed: string): string {
  return elapsed === 'Just now' ? 'just now' : `${elapsed} ago`;
}

const styles = StyleSheet.create({
  layout: { flex: 1, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  body: { padding: 16, gap: 12 },
  row: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
    gap: 6,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
