import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  getLocalQueue,
  updateQueueItem,
  LocalCapturedItem,
} from '../storage/offline-outbox';

interface OutboxQueueScreenProps {
  onBackToCapture: () => void;
}

export function OutboxQueueScreen({ onBackToCapture }: OutboxQueueScreenProps) {
  const [queue, setQueue] = useState<LocalCapturedItem[]>(getLocalQueue());
  const [syncing, setSyncing] = useState(false);

  const pendingCount = queue.filter((item) => item.status !== 'SYNCED').length;

  const handleSyncAll = async () => {
    if (pendingCount === 0) {
      Alert.alert('All Synced', 'No pending items to sync in the outbox.');
      return;
    }

    try {
      setSyncing(true);
      // Simulate network batch sync
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Mark all confirmed items as SYNCED
      queue.forEach((item) => {
        if (item.status === 'CONFIRMED' || item.status === 'LOCAL_CAPTURED') {
          updateQueueItem(item.id, { status: 'SYNCED' });
        }
      });

      setQueue(getLocalQueue());
      Alert.alert(
        'Sync Successful',
        `Transferred ${pendingCount} field evidence capture(s) to InSite Assurance server.`
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Offline Outbox Queue</Text>
          <Text style={styles.subtitle}>
            {pendingCount} item{pendingCount === 1 ? '' : 's'} waiting to upload to portal.
          </Text>
        </View>
        <TouchableOpacity style={styles.backButton} onPress={onBackToCapture}>
          <Text style={styles.backButtonText}>&larr; Capture</Text>
        </TouchableOpacity>
      </View>

      {/* Sync Action Button */}
      <TouchableOpacity
        style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
        onPress={handleSyncAll}
        disabled={syncing}
      >
        {syncing ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.syncButtonText}>
            Sync All Confirmed Captures ({pendingCount})
          </Text>
        )}
      </TouchableOpacity>

      {/* Queue Items List */}
      <View style={styles.queueList}>
        {queue.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Outbox is empty</Text>
            <Text style={styles.emptyDesc}>
              Geotagged photos and audio notes captured on site will queue here.
            </Text>
          </View>
        ) : (
          queue.map((item) => {
            const isSynced = item.status === 'SYNCED';
            return (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemChainage}>
                    {item.chainageLabel || 'Site Coordinate'} · WBS {item.wbsCode || '02.01.2'}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      isSynced ? styles.statusSynced : styles.statusPending,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        isSynced ? styles.statusTextSynced : styles.statusTextPending,
                      ]}
                    >
                      {item.status.replace('_', ' ')}
                    </Text>
                  </View>
                </View>

                <Text style={styles.itemSummary}>
                  {item.confirmedSummary ||
                    item.rawWhisperTranscript ||
                    item.rawTextNote ||
                    'Field evidence capture'}
                </Text>

                <View style={styles.itemFooter}>
                  <Text style={styles.itemMeta}>
                    GPS: ±{item.gpsAccuracyMeters}m · {item.mediaType}
                  </Text>
                  <Text style={styles.itemMeta}>
                    Hash: {item.deviceSignatureHash.slice(0, 10)}...
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0C233C',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  backButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#00338D',
  },
  syncButton: {
    backgroundColor: '#00338D',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 16,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  queueList: {
    gap: 10,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  itemChainage: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00338D',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusPending: {
    backgroundColor: '#FEF3C7',
  },
  statusSynced: {
    backgroundColor: '#DCFCE7',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  statusTextPending: {
    color: '#92400E',
  },
  statusTextSynced: {
    color: '#166534',
  },
  itemSummary: {
    fontSize: 12,
    color: '#1E293B',
    lineHeight: 16,
    marginBottom: 8,
  },
  itemFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 6,
  },
  itemMeta: {
    fontSize: 10,
    color: '#64748B',
  },
});

