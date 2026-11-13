import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {
  getInAppNotifications,
  markNotificationAsRead,
  InAppNotificationItem,
} from '../services/pushNotificationService';

interface Props {
  onClose: () => void;
  onOpenBacklogModal: () => void;
  onSelectWbsItem: (wbsItemId: string) => void;
}

export const NotificationCenterModal: React.FC<Props> = ({
  onClose,
  onOpenBacklogModal,
  onSelectWbsItem,
}) => {
  const notifications = getInAppNotifications();

  const handlePress = (notif: InAppNotificationItem) => {
    markNotificationAsRead(notif.id);
    if (notif.actionPayload?.openBacklogModal) {
      onClose();
      onOpenBacklogModal();
    } else if (notif.actionPayload?.targetWbsItemId) {
      onClose();
      onSelectWbsItem(notif.actionPayload.targetWbsItemId);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Notification Center</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          Critical updates on assurance verifications, monitor queries, and hold-points.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
                <View
                  style={[
                    styles.tag,
                    isApproval ? styles.tagSuccess : isQuery ? styles.tagDanger : styles.tagInfo,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      isApproval
                        ? styles.tagSuccessText
                        : isQuery
                        ? styles.tagDangerText
                        : styles.tagInfoText,
                    ]}
                  >
                    {isApproval
                      ? 'Assurance Approved'
                      : isQuery
                      ? 'Monitor Query'
                      : 'Facility Update'}
                  </Text>
                </View>
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
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#0C233C',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  closeText: {
    fontSize: 13,
    color: '#93C5FD',
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    color: '#BFDBFE',
    lineHeight: 16,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  cardUnread: {
    borderColor: '#00338D',
    borderWidth: 1.5,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  tagSuccess: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1 },
  tagDanger: { backgroundColor: '#FFF1F2', borderColor: '#FECDD3', borderWidth: 1 },
  tagInfo: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 },
  tagText: { fontSize: 10, fontWeight: '700' },
  tagSuccessText: { color: '#065F46' },
  tagDangerText: { color: '#BE123C' },
  tagInfoText: { color: '#00338D' },
  timeText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  notifMessage: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  actionPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#0C233C',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 4,
  },
  actionPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});

