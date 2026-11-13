import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { getWbsThreads, WbsItemRecord } from '../storage/wbsRepository';
import { getUnreadNotificationCount } from '../services/pushNotificationService';

interface Props {
  projectCode: string;
  userInitials: string;
  isVerified: boolean;
  onSelectWbsThread: (wbsItem: WbsItemRecord) => void;
  onOpenProfile: () => void;
  onOpenNotifications: () => void;
  onOpenIncidentModal: () => void;
  onOpenBacklogModal: () => void;
}

export const WbsInboxScreen: React.FC<Props> = ({
  projectCode,
  userInitials,
  isVerified,
  onSelectWbsThread,
  onOpenProfile,
  onOpenNotifications,
  onOpenIncidentModal,
  onOpenBacklogModal,
}) => {
  const [threads, setThreads] = useState<WbsItemRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const unreadNotifs = getUnreadNotificationCount();

  const loadData = async () => {
    const list = await getWbsThreads('proj-lkk-402');
    setThreads(list);
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {/* Left Avatar */}
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={onOpenProfile}
            activeOpacity={0.8}
            accessibilityLabel="Profile and project switcher"
          >
            <Text style={styles.avatarText}>{userInitials}</Text>
          </TouchableOpacity>

          {/* Center Brand */}
          <View style={styles.headerCenter}>
            <Text style={styles.headerBrand}>InSite Assurance</Text>
            <Text style={styles.headerSubbrand}>{projectCode} · WBS Chat Inbox</Text>
          </View>

          {/* Right Action Icons */}
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={onOpenNotifications}
              activeOpacity={0.7}
              accessibilityLabel="Notifications"
            >
              <Text style={styles.iconText}>🔔</Text>
              {unreadNotifs > 0 && <View style={styles.notificationDot} />}
            </TouchableOpacity>

            {/* Special Emergency / Whistleblowing "!" Icon */}
            <TouchableOpacity
              style={styles.incidentButton}
              onPress={onOpenIncidentModal}
              activeOpacity={0.8}
              accessibilityLabel="Report emergency or whistleblowing incident"
            >
              <Text style={styles.incidentButtonText}>!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Unverified Mode Warning Banner */}
      {!isVerified && (
        <TouchableOpacity
          style={styles.unverifiedBanner}
          onPress={onOpenBacklogModal}
          activeOpacity={0.9}
        >
          <View style={styles.unverifiedBannerContent}>
            <Text style={styles.unverifiedBadge}>Verification Pending</Text>
            <Text style={styles.unverifiedText}>
              Reports queue locally without AI costs. Once verified, tap here to review your backlog.
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* WBS Threads List */}
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Actionable WBS Deliverables</Text>
          <Text style={styles.sectionSubtitle}>
            Select a BOQ item channel to submit daily photos, notes, or wrap-up reports.
          </Text>
        </View>

        {threads.map((thread) => (
          <TouchableOpacity
            key={thread.id}
            style={[
              styles.wbsCard,
              thread.isScheduledToday && styles.wbsCardScheduled,
            ]}
            onPress={() => onSelectWbsThread(thread)}
            activeOpacity={0.7}
          >
            {/* Top row of card: WBS Code + Badges */}
            <View style={styles.wbsCardTop}>
              <Text style={styles.wbsCode}>WBS {thread.wbsCode}</Text>
              <View style={styles.badgesRow}>
                {thread.isHoldPoint && (
                  <View style={styles.badgeWarning}>
                    <Text style={styles.badgeWarningText}>Hold-Point</Text>
                  </View>
                )}
                {thread.isScheduledToday && (
                  <View style={styles.badgeInfo}>
                    <Text style={styles.badgeInfoText}>Scheduled Today</Text>
                  </View>
                )}
                {thread.unreadCount > 0 && !thread.isHoldPoint && (
                  <View style={styles.badgeDanger}>
                    <Text style={styles.badgeDangerText}>Open Query</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Description */}
            <Text style={styles.wbsDescription} numberOfLines={2}>
              {thread.description}
            </Text>

            {/* Latest chat snippet */}
            <View style={styles.lastMessageRow}>
              <Text style={styles.lastMessageText} numberOfLines={1}>
                {thread.lastMessageText}
              </Text>
              <Text style={styles.lastMessageTime}>{thread.lastMessageTimestamp}</Text>
            </View>
          </TouchableOpacity>
        ))}
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
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#00338D',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  headerCenter: {
    flex: 1,
    marginLeft: 12,
  },
  headerBrand: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubbrand: {
    fontSize: 11,
    color: '#93C5FD',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconText: {
    fontSize: 14,
  },
  notificationDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#E11D48',
  },
  incidentButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E11D48',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F43F5E',
  },
  incidentButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  unverifiedBanner: {
    backgroundColor: '#FFFBEB',
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  unverifiedBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  unverifiedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    color: '#92400E',
    fontSize: 10,
    fontWeight: '700',
  },
  unverifiedText: {
    flex: 1,
    fontSize: 11,
    color: '#78350F',
    lineHeight: 15,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  sectionHeader: {
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  wbsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    gap: 8,
  },
  wbsCardScheduled: {
    borderColor: '#00338D',
    borderWidth: 1.5,
  },
  wbsCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wbsCode: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0C233C',
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 6,
  },
  badgeWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeWarningText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  badgeInfo: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeInfoText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#00338D',
  },
  badgeDanger: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeDangerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#BE123C',
  },
  wbsDescription: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 17,
    fontWeight: '500',
  },
  lastMessageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
    marginTop: 4,
  },
  lastMessageText: {
    fontSize: 11,
    color: '#64748B',
    flex: 1,
    marginRight: 8,
  },
  lastMessageTime: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
});

