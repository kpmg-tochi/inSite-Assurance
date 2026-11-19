import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatElapsedTime } from '@insite/shared';
import { EmptyStateCard, InfoCallout, InSiteLoader, Pill } from '../components/common';
import { useProfile } from '../context/ProfileContext';
import {
  useDeadLettersQuery,
  usePendingReportsQuery,
  useRetryOutboxItemMutation,
  useSyncStatus,
} from '../queries/wbs/useWbsQueries';
import type { RootStackParamList } from '../navigation/types';
import { personaCopy } from '../utils/personaCopy';
import { reportStatusView } from '../utils/reportStatus';

const KIND_LABEL: Record<string, string> = {
  CAPTURE: 'Photo or voice note',
  REPORT: 'Daily report',
  REVALIDATION: 'Report revision',
  CHAT_MESSAGE: 'Chat message',
  TELEMETRY: 'Presence ping',
  INCIDENT: 'Incident report',
  ASSURANCE: 'Identity submission',
};

/**
 * Sync status (Phase 4). Read-only: what is waiting to send, what failed (with Retry), and which
 * reports the server is holding until identity approval. The server releases held reports when
 * the identity check is approved; the device never re-submits them.
 */
export const BacklogReviewModal: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeProjectId: projectId, activeContext } = useProfile();
  const copy = personaCopy(activeContext?.fieldPersonaType);
  const insets = useSafeAreaInsets();
  const status = useSyncStatus();
  const { data: reports = [], isLoading } = usePendingReportsQuery(projectId);
  const { data: dead = [] } = useDeadLettersQuery();
  const retry = useRetryOutboxItemMutation();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#0891B2', '#1E3A8A', '#312E81', '#1E1B4B']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
          <Pill
            variant={status.pausedReason ? 'warning' : status.isOnline ? 'positive' : 'info'}
            text={status.pausedReason ? 'Paused' : status.isOnline ? 'Online' : 'Offline'}
          />
        </View>
        <Text style={styles.title}>Sync status</Text>
        <Text style={styles.subtitle}>
          {status.pendingCount === 0
            ? 'Everything on this device has been sent.'
            : `${status.pendingCount} item(s) waiting to send.`}
          {status.lastSyncedAt ? ` Last sent ${formatElapsedTime(status.lastSyncedAt)} ago.` : ''}
        </Text>
      </LinearGradient>

      <View style={styles.curvedContainer}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 20, 24) }]}
          showsVerticalScrollIndicator={false}
        >
          {status.pausedReason && (
            <InfoCallout variant="warning" title="Sending is paused" description={status.pausedReason} />
          )}
          {status.lastError && !status.pausedReason && (
            <InfoCallout variant="warning" title="Last error" description={status.lastError} />
          )}
          {status.storageEncrypted === false && (
            <InfoCallout
              variant="warning"
              title="Local data is not encrypted"
              description="This is a development build without SQLCipher. Release builds encrypt data on the device."
            />
          )}

          {dead.length > 0 && (
            <View style={styles.itemCard}>
              <Text style={styles.itemTitle}>Could not be sent ({dead.length})</Text>
              {dead.map((d) => (
                <View key={d.id} style={styles.itemMeta}>
                  <Text style={styles.itemMetaText} numberOfLines={2}>
                    {KIND_LABEL[d.kind] ?? d.kind}: {d.lastError ?? 'Unknown error'}
                  </Text>
                  <TouchableOpacity onPress={() => retry.mutate(d.id)} disabled={retry.isPending}>
                    <Text style={styles.closeText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {isLoading ? (
            <InSiteLoader size="md" label="Loading reports..." />
          ) : reports.length === 0 ? (
            <EmptyStateCard
              title="No reports waiting"
              description={copy.backlogEmptyDescription}
            />
          ) : (
            reports.map((r) => {
              const statusView = reportStatusView(r.serverStatus, r.syncStatus);
              return (
              <View key={r.id} style={styles.itemCard}>
                <View style={styles.itemTop}>
                  <Pill variant={statusView.variant} text={statusView.label} />
                  <Text style={styles.itemDate}>{r.workdayDate}</Text>
                </View>
                <Text style={styles.itemTitle}>{r.summaryText}</Text>
                <View style={styles.itemMeta}>
                  <Text style={styles.itemMetaText}>
                    {r.reportedQuantity} {r.unit} · {r.captureIds.length} capture(s)
                  </Text>
                </View>
                {statusView.needsAction && (
                  <Text style={styles.itemMetaText}>
                    A reviewer returned this report. Open the WBS thread to answer the query with a revision.
                  </Text>
                )}
              </View>
              );
            })
          )}

          {reports.some((r) => r.serverStatus === 'STAGED_UNVERIFIED') && (
            <InfoCallout
              variant="info"
              title="Held reports"
              description={copy.heldReportsDescription}
            />
          )}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  curvedContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -16,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  closeText: {
    fontSize: 13,
    color: '#93C5FD',
    fontWeight: '700',
  },
  badgeSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  badgeSuccessText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11,
    color: '#BFDBFE',
    marginTop: 4,
    lineHeight: 16,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  itemCardSelected: {
    borderColor: '#00338D',
    borderWidth: 1.5,
    backgroundColor: '#F8FAFC',
  },
  itemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wbsPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  wbsPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00338D',
  },
  itemDate: {
    fontSize: 10,
    color: '#94A3B8',
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  itemMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  itemMetaText: {
    fontSize: 11,
    color: '#64748B',
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00338D',
    marginBottom: 3,
  },
  infoText: {
    fontSize: 11,
    color: '#1E3A8A',
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

