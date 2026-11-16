import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  EmptyStateCard,
  InfoCallout,
  InSiteLoader,
  Pill,
} from '../components/common';
import { PrimaryButton } from '../components/inputs/Buttons';
import { useProfile } from '../context/ProfileContext';
import {
  usePromoteBacklogMutation,
  useStagedBacklogQuery,
} from '../queries/wbs/useWbsQueries';
import type { RootStackParamList } from '../navigation/types';

export const BacklogReviewModal: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeProjectId: projectId } = useProfile();
  const onClose = () => navigation.goBack();
  const onBatchConfirmed = () => navigation.goBack();
  const insets = useSafeAreaInsets();
  const [deselectedIds, setDeselectedIds] = useState<Record<string, boolean>>({});

  const { data: rawItems = [], isLoading: loading } = useStagedBacklogQuery();
  const promoteMutation = usePromoteBacklogMutation(projectId);
  const isProcessing = promoteMutation.isPending;

  const backlogItems = rawItems.map((r) => ({
    ...r,
    selected: !deselectedIds[r.id],
  }));

  const toggleItem = (id: string) => {
    setDeselectedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleProcessBatch = async () => {
    const selectedIds = backlogItems.filter((i) => i.selected).map((i) => i.id);
    if (selectedIds.length === 0) {
      Toast.show({
        type: 'error',
        props: {
          title: 'No Items Selected',
          message: 'Select at least one queued report to sync.',
        },
      });
      return;
    }

    try {
      const result = await promoteMutation.mutateAsync(selectedIds);
      Toast.show({
        type: 'success',
        props: {
          title: 'Backlog Processed',
          message: `${result.syncedCount} report(s) synced to the project ledger.${
            result.queuedCount > 0
              ? ` ${result.queuedCount} remaining queued for connectivity.`
              : ''
          }`,
        },
      });
      onBatchConfirmed();
    } catch (err: any) {
      Toast.show({
        type: 'error',
        props: {
          title: 'Sync Error',
          message: err?.message || 'Unable to process queued backlog.',
        },
      });
    }
  };

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
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
          <Pill variant="positive" text="Account Verified" />
        </View>
        <Text style={styles.title}>Queued Report Backlog</Text>
        <Text style={styles.subtitle}>
          Your contractor credentials have been approved! Review and confirm your queued field
          submissions before sending them to the Independent Monitor.
        </Text>
      </LinearGradient>

      <View style={styles.curvedContainer}>
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: Math.max(insets.bottom + 20, 24) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <InSiteLoader size="md" label="Loading queued field reports..." />
          ) : backlogItems.length === 0 ? (
            <EmptyStateCard
              title="No Queued Reports in Backlog"
              description="All signed End-of-Day reports have already been synced to the server."
            />
          ) : (
            <>
              {backlogItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.itemCard, item.selected && styles.itemCardSelected]}
                  onPress={() => toggleItem(item.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.itemTop}>
                    <Pill
                      variant="info"
                      text={`WBS ${item.wbsCode || 'ITEM'}`}
                    />
                    <Text style={styles.itemDate}>{item.workdayDate}</Text>
                  </View>

                  <Text style={styles.itemTitle}>{item.summaryText}</Text>

                  <View style={styles.itemMeta}>
                    <Text style={styles.itemMetaText}>
                      Reported: {item.reportedQuantity} {item.unit}
                    </Text>
                    <Text style={styles.itemMetaText}>Status: {item.status}</Text>
                  </View>
                </TouchableOpacity>
              ))}

              <InfoCallout
                variant="info"
                title="Batch AI Verification"
                description="Confirming this backlog submits your queued reports and GPS provenance to the project BOQ reconciliation ledger."
              />

              <PrimaryButton
                onPress={handleProcessBatch}
                text={
                  isProcessing
                    ? 'Syncing Backlog...'
                    : 'Confirm & Sync Selected Reports'
                }
                isWorking={isProcessing}
                disabled={isProcessing}
              />
            </>
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

