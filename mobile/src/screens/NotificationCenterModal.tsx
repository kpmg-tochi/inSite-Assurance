import React from 'react';
import {
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  getInAppNotifications,
  markNotificationAsRead,
  InAppNotificationItem,
} from '../services/pushNotificationService';
import { EmptyStateCard, Pill } from '../components/common';
import { GradientHeaderLayout } from '../components/common/GradientHeaderLayout';
import { useProfile } from '../context/ProfileContext';
import { getWbsThreads } from '../storage/wbsRepository';
import type { RootStackParamList } from '../navigation/types';

export const NotificationCenterModal: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeProjectId } = useProfile();
  const notifications = getInAppNotifications();

  const onClose = () => navigation.goBack();

  const handlePress = async (notif: InAppNotificationItem) => {
    markNotificationAsRead(notif.id);
    if (notif.actionPayload?.openBacklogModal) {
      navigation.replace('BacklogModal');
    } else if (notif.actionPayload?.targetWbsItemId) {
      const threads = await getWbsThreads(activeProjectId);
      const target = threads.find(
        (t) => t.id === notif.actionPayload?.targetWbsItemId
      );
      navigation.goBack();
      if (target) {
        navigation.navigate('WbsThread', { wbsItem: target });
      }
    }
  };

  return (
    <GradientHeaderLayout
      title="Notification Center"
      subtitle="Critical updates on assurance verifications &amp; queries."
      rightAction={
        <TouchableOpacity
          onPress={onClose}
          activeOpacity={0.7}
          style={styles.closeBtn}
          accessibilityLabel="Close notification modal"
        >
          <Text style={styles.closeText}>Close ✕</Text>
        </TouchableOpacity>
      }
      contentContainerStyle={styles.body}
    >
      {notifications.length === 0 ? (
        <EmptyStateCard
          title="All Caught Up"
          description="Verification approvals, monitor queries, and daily brief alerts will appear here."
        />
      ) : null}

      {notifications.map((n) => {
        const isApproval = n.type === 'ASSURANCE_APPROVED';
        const isQuery = n.type === 'MONITOR_QUERY';

        return (
          <TouchableOpacity
            key={n.id}
            style={[styles.card, !n.isRead && styles.cardUnread]}
            onPress={() => handlePress(n)}
            activeOpacity={0.8}
          >
            <View style={styles.topRow}>
              <Pill
                variant={isApproval ? 'positive' : isQuery ? 'negative' : 'info'}
                text={
                  isApproval
                    ? 'Assurance Approved'
                    : isQuery
                    ? 'Monitor Query'
                    : 'Facility Update'
                }
              />
              <Text style={styles.timeText}>{n.createdAt}</Text>
            </View>

            <Text style={styles.notifTitle}>{n.title}</Text>
            <Text style={styles.notifMessage}>{n.message}</Text>

            {isApproval && (
              <View style={styles.actionPill}>
                <Text style={styles.actionPillText}>Tap to Review &amp; Confirm Backlog →</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  closeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  closeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    gap: 12,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    gap: 8,
  },
  cardUnread: {
    borderColor: '#00338D',
    borderLeftWidth: 4,
    backgroundColor: '#FAFCFF',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagSuccess: {
    backgroundColor: '#ECFDF5',
  },
  tagDanger: {
    backgroundColor: '#FFF1F2',
  },
  tagInfo: {
    backgroundColor: '#EFF6FF',
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  tagSuccessText: {
    color: '#065F46',
  },
  tagDangerText: {
    color: '#BE123C',
  },
  tagInfoText: {
    color: '#00338D',
  },
  timeText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  notifMessage: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  actionPill: {
    backgroundColor: '#EFF6FF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  actionPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#00338D',
  },
});
