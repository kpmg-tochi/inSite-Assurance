import React, { useCallback, useMemo } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import type { MobileNotificationDto } from "@insite/shared";
import {
  EmptyStateCard,
  InSiteLoader,
} from "../components/common";
import { GradientHeaderLayout } from "../components/common/GradientHeaderLayout";
import { IconButton } from "../components/inputs/Buttons";
import { NotificationCard } from "../components/notifications";
import { useProfile } from "../context/ProfileContext";
import type { RootStackParamList } from "../navigation/types";
import {
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from "../queries/notifications/useNotificationQueries";
import {
  getWbsThreads,
  syncWbsInboxFromServer,
  type WbsItemRecord,
} from "../storage/wbsRepository";
import { formatMobileErrorMessage } from "../utils/errorFormatter";

type NotificationListEntry =
  | {
      kind: "notification";
      id: string;
      notification: MobileNotificationDto;
    }
  | {
      kind: "divider";
      id: string;
      label: string;
    };

export const NotificationCenterModal: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { activeProjectId, activeContext } = useProfile();

  const {
    data: notifications = [],
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useNotificationsQuery(
    activeProjectId,
    Boolean(activeContext),
  );
  const markReadMutation = useMarkNotificationReadMutation(activeProjectId);

  const onClose = () => navigation.goBack();

  const findWbsItem = useCallback(
    async (
      wbsItemId?: string,
      wbsCode?: string,
    ): Promise<WbsItemRecord | undefined> => {
      if (!activeProjectId) return undefined;
      let threads = await getWbsThreads(activeProjectId);
      const matchFn = (t: WbsItemRecord) =>
        (wbsItemId && t.id === wbsItemId) ||
        (wbsCode && t.wbsCode === wbsCode);

      let target = threads.find(matchFn);
      if (!target) {
        const synced = await syncWbsInboxFromServer(activeProjectId).catch(
          () => null,
        );
        if (synced?.items) {
          threads = synced.items;
          target = threads.find(matchFn);
        }
      }
      return target;
    },
    [activeProjectId],
  );

  const handlePress = useCallback(
    async (notif: MobileNotificationDto) => {
      // Passive notifications mark read immediately on tap;
      // Action-required notifications remain unread until the required flow completes.
      if (!notif.requiresAction && !notif.isRead) {
        markReadMutation.mutate(notif.id);
      }
      // Already answered by someone on the project: open it, but there is nothing left to resolve.
      if (notif.actionedAt) {
        notif = { ...notif, requiresAction: false };
      }

      if (notif.actionType === "OPEN_REPORT_SUMMARY") {
        const target = await findWbsItem(
          notif.metadata?.wbsItemId,
          notif.metadata?.wbsCode,
        );
        if (target) {
          navigation.replace("EodConfirmModal", {
            wbsItem: target,
            resolveNotificationId: notif.requiresAction ? notif.id : undefined,
            initialSummary:
              typeof notif.metadata?.draftSummary === "string"
                ? notif.metadata.draftSummary
                : undefined,
            initialQuantity:
              typeof notif.metadata?.draftQuantity === "number"
                ? notif.metadata.draftQuantity
                : undefined,
            initialUnit:
              typeof notif.metadata?.unit === "string"
                ? notif.metadata.unit
                : undefined,
          });
          return;
        }
        navigation.replace("BacklogModal", {
          resolveNotificationId: notif.requiresAction ? notif.id : undefined,
        });
        return;
      }

      // Phase 10: defect assigned, fixed, closed or overdue.
      if (notif.actionType === "OPEN_DEFECTS") {
        navigation.replace("Defects");
        return;
      }

      // Phase 14: an inspection finding aimed at this contractor.
      if (notif.actionType === "OPEN_INSPECTION_FINDINGS") {
        navigation.replace("InspectionFindings");
        return;
      }

      if (notif.actionType === "OPEN_BACKLOG_REVIEW") {
        navigation.replace("BacklogModal", {
          resolveNotificationId: notif.requiresAction ? notif.id : undefined,
        });
        return;
      }

      if (notif.actionType === "OPEN_WBS_CHAT") {
        const target = await findWbsItem(
          notif.metadata?.wbsItemId,
          notif.metadata?.wbsCode,
        );
        if (!target) {
          Toast.show({
            type: "info",
            props: {
              title: "WBS Item Not Found",
              message:
                "Pull to refresh the Deliverables inbox, then try opening this query again.",
            },
          });
          return;
        }
        navigation.goBack();
        navigation.navigate("WbsThread", {
          wbsItem: target,
          activeQueryNotificationId: notif.requiresAction
            ? notif.id
            : undefined,
          queryPrompt: notif.requiresAction ? notif.message : undefined,
          workdayReportId:
            typeof notif.metadata?.workdayReportId === "string"
              ? notif.metadata.workdayReportId
              : undefined,
          reportQueryId:
            typeof notif.metadata?.reportQueryId === "string"
              ? notif.metadata.reportQueryId
              : undefined,
        });
        return;
      }

      if (notif.actionType === "OPEN_ASSURANCE_WIZARD") {
        navigation.replace("AssuranceWizard", {
          resolveNotificationId: notif.requiresAction ? notif.id : undefined,
        });
      }
    },
    [findWbsItem, markReadMutation, navigation],
  );

  // Build ordered list items (unread newest first -> divider -> read newest first)
  const listData = useMemo<NotificationListEntry[]>(() => {
    // Needs action (not yet answered by anyone) -> new -> older (read or answered).
    const needsAction = notifications.filter((n) => n.requiresAction && !n.actionedAt && !n.isRead);
    const unread = notifications.filter((n) => !n.isRead && !(n.requiresAction && !n.actionedAt));
    const read = notifications.filter((n) => n.isRead);

    const entries: NotificationListEntry[] = [];
    const group = (label: string, list: MobileNotificationDto[]) => {
      if (list.length === 0) return;
      entries.push({ kind: "divider", id: `divider-${label}`, label });
      for (const notification of list) {
        entries.push({ kind: "notification", id: notification.id, notification });
      }
    };
    group("Needs action", needsAction);
    group("New", unread);
    group("Older notifications", read);
    return entries;
  }, [notifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  return (
    <GradientHeaderLayout
      scrollable={false}
      title="Notification Center"
      subtitle={
        unreadCount > 0
          ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"} · Assurance, backlog & queries`
          : "Critical updates on assurance verifications & queries."
      }
      rightAction={<IconButton icon="close" onPress={onClose} />}
      contentContainerStyle={styles.layoutContent}
    >
      {isLoading ? (
        <View style={styles.loaderWrap}>
          <InSiteLoader size="md" label="Loading project notifications..." />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => {
                refetch();
              }}
              tintColor="#00715D"
            />
          }
          renderItem={({ item }) => {
            if (item.kind === "divider") {
              return (
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{item.label}</Text>
                  <View style={styles.dividerLine} />
                </View>
              );
            }

            return (
              <NotificationCard
                notification={item.notification}
                onPress={handlePress}
              />
            );
          }}
          ListEmptyComponent={
            error ? (
              <EmptyStateCard
                title="Unable to Load Notifications"
                description={formatMobileErrorMessage(error)}
              />
            ) : (
              <EmptyStateCard
                title="All Caught Up"
                description="Assurance decisions, queued report summaries, hold points, and monitor queries will appear here."
              />
            )
          }
        />
      )}
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  layoutContent: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
    gap: 12,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 6,
    paddingHorizontal: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#CBD5E1",
  },
  dividerText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    letterSpacing: 0.3,
  },
});
