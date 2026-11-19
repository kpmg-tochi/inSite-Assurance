import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { WbsItemRecord } from "../storage/wbsRepository";
import {
  Avatar,
  BrandGradient,
  EmptyStateCard,
  InSiteLoader,
  Pill,
  ToastBanner,
} from "../components/common";
import { useProfile } from "../context/ProfileContext";
import { useNotificationsQuery } from "../queries/notifications/useNotificationQueries";
import { useSyncStatus, useWbsInboxQuery } from "../queries/wbs/useWbsQueries";
import { formatMobileErrorMessage } from "../utils/errorFormatter";
import type { RootStackParamList } from "../navigation/types";
import { Feather } from "@expo/vector-icons";

type InboxTab = "ACTIVE" | "REPORTED";

export const WbsInboxScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    activeProjectId: projectId,
    projectCode,
    userInitials,
    isVerified,
    activeContext,
    refreshAssuranceStatus,
  } = useProfile();
  const syncStatus = useSyncStatus();

  const onSelectWbsThread = (wbsItem: WbsItemRecord) =>
    navigation.navigate("WbsThread", { wbsItem });
  const onOpenProfile = () => navigation.navigate("ProfileModal");
  const onOpenNotifications = () => navigation.navigate("NotificationsModal");
  const onOpenIncidentModal = () => navigation.navigate("IncidentModal");
  const onOpenBacklogModal = () => navigation.navigate("BacklogModal");
  const [dismissedError, setDismissedError] = useState(false);
  const [activeTab, setActiveTab] = useState<InboxTab>("ACTIVE");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllUnblocked, setShowAllUnblocked] = useState(false);

  const { data: notifications = [] } = useNotificationsQuery(
    projectId,
    Boolean(activeContext),
  );
  const unreadNotifs = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );
  const insets = useSafeAreaInsets();

  const {
    data: inboxData,
    isLoading: loading,
    isRefetching: refreshing,
    error: queryError,
    refetch,
  } = useWbsInboxQuery(projectId);

  const threads = inboxData?.items ?? [];
  const errorMsg = !dismissedError
    ? inboxData?.syncError
      ? formatMobileErrorMessage(inboxData.syncError)
      : queryError
        ? formatMobileErrorMessage(queryError)
        : null
    : null;

  const loadData = async () => {
    setDismissedError(false);
    await refetch();
  };

  const onRefresh = async () => {
    setDismissedError(false);
    await Promise.all([refetch(), refreshAssuranceStatus()]);
  };

  const activeThreads = useMemo(
    () => threads.filter((t) => !t.isReportedToday),
    [threads],
  );
  const reportedThreads = useMemo(
    () => threads.filter((t) => t.isReportedToday),
    [threads],
  );

  const filteredActive = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeThreads;
    return activeThreads.filter(
      (t) =>
        t.wbsCode.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [activeThreads, searchQuery]);

  const planAItems = useMemo(
    () =>
      filteredActive.filter(
        (t) => t.planningTier === "PLAN_A" || t.isScheduledToday,
      ),
    [filteredActive],
  );

  const fallbackItems = useMemo(
    () =>
      filteredActive
        .filter(
          (t) =>
            t.planningTier !== "PLAN_A" &&
            !t.isScheduledToday &&
            (t.planningTier === "FALLBACK_BACKLOG" || !t.isHoldPoint),
        )
        .slice(0, 3),
    [filteredActive],
  );

  const remainingUnblocked = useMemo(() => {
    const shownIds = new Set([
      ...planAItems.map((i) => i.id),
      ...fallbackItems.map((i) => i.id),
    ]);
    return filteredActive.filter((t) => !shownIds.has(t.id));
  }, [filteredActive, planAItems, fallbackItems]);

  const renderThreadCard = (thread: WbsItemRecord, isFallback = false) => (
    <TouchableOpacity
      key={thread.id}
      style={[
        styles.wbsCard,
        thread.isScheduledToday && styles.wbsCardScheduled,
      ]}
      onPress={() => onSelectWbsThread(thread)}
      activeOpacity={0.7}
    >
      <View style={styles.wbsCardTop}>
        <Text style={styles.wbsCode}>WBS {thread.wbsCode}</Text>
        <View style={styles.badgesRow}>
          {thread.isHoldPoint && <Pill variant="warning" text="Hold-Point" />}
          {thread.isScheduledToday && (
            <Pill variant="info" text="Plan A · Today" />
          )}
          {isFallback && !thread.isScheduledToday && (
            <Pill variant="gray" text="Fallback Ready" />
          )}
          {thread.isReportedToday && (
            <Pill variant="positive" text="Reported" />
          )}
        </View>
      </View>

      <Text style={styles.wbsDescription} numberOfLines={2}>
        {thread.description}
      </Text>

      <View style={styles.lastMessageRow}>
        <Text style={styles.lastMessageText} numberOfLines={1}>
          {thread.lastMessageText || "Tap to open WBS thread"}
        </Text>
        <Text style={styles.lastMessageTime}>
          {thread.lastMessageTimestamp}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Top Gradient Header with Safe Area Insets */}
      <View
        style={[
          styles.headerGradient,
          { paddingTop: Math.max(insets.top + 8, 20) },
        ]}
      >
        <BrandGradient />

        {/* Top Utility Row */}
        <View style={styles.headerTopRow}>
          <View style={styles.brandGroup}>
            {Boolean(projectCode) && (
              <Pill variant="darkGlass" text={projectCode} />
            )}
          </View>

          {/* Right Action Icons + Profile Avatar with presence badge */}
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={onOpenNotifications}
              activeOpacity={0.7}
              accessibilityLabel="Notifications"
            >
              <Text style={styles.iconText}>
                <Feather name="bell" size={16} color={"#fff"} />
              </Text>
              {unreadNotifs > 0 && <View style={styles.notificationDot} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.incidentButton}
              onPress={onOpenIncidentModal}
              activeOpacity={0.8}
              accessibilityLabel="Report emergency or incident"
            >
              <Text style={styles.incidentButtonText}>!</Text>
            </TouchableOpacity>

            <Avatar
              size="xs"
              forceInitials={userInitials}
              showOnlineDot
              onPress={onOpenProfile}
              accessibilityLabel="Profile and project switcher"
            />
          </View>
        </View>

        {/* Big Bold Screen Title (Like Image 2 "Activity") */}
        <View style={styles.titleRow}>
          <Text style={styles.screenTitle}>Deliverables</Text>
          <Text style={styles.screenSubtitle}>Daily Field WBS Breakdown</Text>
        </View>

        {/* Filter Pills (Styled like Image 2 "All", "DMs", "Mentions", etc.) */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[
              styles.pillBtn,
              activeTab === "ACTIVE" && styles.pillBtnActive,
            ]}
            onPress={() => setActiveTab("ACTIVE")}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.pillBtnText,
                activeTab === "ACTIVE" && styles.pillBtnTextActive,
              ]}
            >
              Active ({activeThreads.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.pillBtn,
              activeTab === "REPORTED" && styles.pillBtnActive,
            ]}
            onPress={() => setActiveTab("REPORTED")}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.pillBtnText,
                activeTab === "REPORTED" && styles.pillBtnTextActive,
              ]}
            >
              Reported ({reportedThreads.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Curved Content Container (overlapping gradient header with borderTopRadius: 24) */}
      <View
        style={[
          styles.curvedContainer,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        {/* Unverified Mode Warning Banner */}
        {!isVerified && (
          <TouchableOpacity
            style={styles.unverifiedBanner}
            onPress={onOpenBacklogModal}
            activeOpacity={0.9}
          >
            <View style={styles.unverifiedBannerContent}>
              <Pill variant="warning" text="Verification Pending" />
              <Text style={styles.unverifiedText}>
                Your reports are sent and held by the server until your identity
                is approved, then submitted automatically. Tap for sync status.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Sync status: shown whenever something is waiting, paused or failed */}
        {(syncStatus.pendingCount > 0 || syncStatus.deadCount > 0 || syncStatus.pausedReason) && (
          <TouchableOpacity
            style={styles.unverifiedBanner}
            onPress={onOpenBacklogModal}
            activeOpacity={0.9}
          >
            <View style={styles.unverifiedBannerContent}>
              <Pill
                variant={syncStatus.deadCount > 0 || syncStatus.pausedReason ? "negative" : "info"}
                text={
                  syncStatus.pausedReason
                    ? "Sending paused"
                    : syncStatus.deadCount > 0
                      ? `${syncStatus.deadCount} not sent`
                      : syncStatus.isOnline
                        ? "Sending"
                        : "Offline"
                }
              />
              <Text style={styles.unverifiedText}>
                {syncStatus.pausedReason
                  ? syncStatus.pausedReason
                  : `${syncStatus.pendingCount} item(s) saved on this device and waiting to send. Tap for details.`}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Error Toast Banner */}
        <ToastBanner
          visible={Boolean(errorMsg)}
          type="warning"
          message={errorMsg || ""}
          onRetry={loadData}
          onDismiss={() => setDismissedError(true)}
        />

        {/* WBS Threads List */}
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <InSiteLoader
              size="md"
              label="Syncing WBS deliverables & morning briefs..."
            />
          ) : activeTab === "ACTIVE" ? (
            <>
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search WBS code or activity..."
                placeholderTextColor="#94A3B8"
              />

              {filteredActive.length === 0 ? (
                <EmptyStateCard
                  title="No Active WBS Items"
                  description="No scheduled or unblocked BOQ deliverables match your current filter. Pull down to refresh from the server."
                  actionLabel="Refresh Deliverables"
                  onAction={loadData}
                />
              ) : (
                <>
                  {planAItems.length > 0 && (
                    <View style={styles.groupBlock}>
                      <Text style={styles.sectionTitle}>
                        Plan A · Scheduled Today
                      </Text>
                      {planAItems.map((t) => renderThreadCard(t, false))}
                    </View>
                  )}

                  {fallbackItems.length > 0 && (
                    <View style={styles.groupBlock}>
                      <Text style={styles.sectionTitle}>Available tasks</Text>
                      {fallbackItems.map((t) => renderThreadCard(t, true))}
                    </View>
                  )}

                  {remainingUnblocked.length > 0 && (
                    <View style={styles.groupBlock}>
                      <TouchableOpacity
                        style={styles.expandPoolBtn}
                        onPress={() => setShowAllUnblocked((prev) => !prev)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.expandPoolText}>
                          {showAllUnblocked
                            ? `Hide Other Unblocked WBS Items (${remainingUnblocked.length})`
                            : `Show All Other Unblocked WBS Items (${remainingUnblocked.length})`}
                        </Text>
                      </TouchableOpacity>
                      {(showAllUnblocked || searchQuery.trim().length > 0) &&
                        remainingUnblocked.map((t) =>
                          renderThreadCard(t, false),
                        )}
                    </View>
                  )}
                </>
              )}
            </>
          ) : reportedThreads.length === 0 ? (
            <EmptyStateCard
              title="No Completed / Reported Items Yet"
              description="WBS items move here once today's End-of-Day report is signed off or 100% certified."
            />
          ) : (
            reportedThreads.map((t) => renderThreadCard(t, false))
          )}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1E1B4B",
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingBottom: 26,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerBrand: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  headerBrandAccent: {
    color: "#38BDF8",
    fontWeight: "700",
  },
  projectPill: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
  },
  projectPillText: {
    color: "#E0F2FE",
    fontSize: 10,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  iconText: {
    fontSize: 14,
  },
  notificationDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#E11D48",
  },
  incidentButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#E11D4890",
    borderWidth: 1,
    borderColor: "#E11D48",
    alignItems: "center",
    justifyContent: "center",
  },
  incidentButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  avatarButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderWidth: 1.5,
    borderColor: "#38BDF8",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  avatarOnlineDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#10B981",
    borderWidth: 1.5,
    borderColor: "#1E1B4B",
  },
  titleRow: {
    marginTop: 14,
    marginBottom: 12,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.72)",
    marginTop: 2,
  },
  filterPillsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pillBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  pillBtnActive: {
    backgroundColor: "#00338D",
    borderColor: "#38BDF8",
  },
  pillBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.75)",
  },
  pillBtnTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  curvedContainer: {
    flex: 1,
    marginTop: -16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#F8FAFC",
    overflow: "hidden",
  },
  unverifiedBanner: {
    backgroundColor: "#FFFBEB",
    borderBottomWidth: 1,
    borderBottomColor: "#FDE68A",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  unverifiedBannerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  unverifiedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
    color: "#92400E",
    fontSize: 10,
    fontWeight: "700",
  },
  unverifiedText: {
    flex: 1,
    fontSize: 11,
    color: "#78350F",
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
    fontWeight: "800",
    color: "#0F172A",
  },
  sectionSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  wbsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    gap: 8,
  },
  wbsCardScheduled: {
    borderColor: "#00338D",
    borderWidth: 1.5,
  },
  wbsCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  wbsCode: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0C233C",
  },
  badgesRow: {
    flexDirection: "row",
    gap: 6,
  },
  badgeWarning: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeWarningText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#92400E",
  },
  badgeInfo: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeInfoText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#00338D",
  },
  badgeDanger: {
    backgroundColor: "#FFF1F2",
    borderColor: "#FECDD3",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeDangerText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#BE123C",
  },
  wbsDescription: {
    fontSize: 12,
    color: "#334155",
    lineHeight: 17,
    fontWeight: "500",
  },
  lastMessageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 8,
    marginTop: 4,
  },
  lastMessageText: {
    fontSize: 11,
    color: "#64748B",
    flex: 1,
    marginRight: 8,
  },
  lastMessageTime: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
  },
  tabsBar: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2.5,
    borderBottomColor: "transparent",
  },
  tabBtnActive: {
    borderBottomColor: "#00338D",
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  tabBtnTextActive: {
    color: "#00338D",
  },
  searchInput: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12,
    color: "#0F172A",
    marginBottom: 8,
  },
  groupBlock: {
    gap: 8,
    marginBottom: 10,
  },
  badgeFallback: {
    backgroundColor: "#F1F5F9",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeFallbackText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#334155",
  },
  badgeSuccess: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  badgeSuccessText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#065F46",
  },
  expandPoolBtn: {
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  expandPoolText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#00338D",
  },
});
