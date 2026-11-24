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
import type { MobileNotificationDto } from "@insite/shared";
import {
  EmptyStateCard,
  InfoCallout,
  InSiteLoader,
} from "../components/common";
import { GradientHeaderLayout } from "../components/common/GradientHeaderLayout";
import { IconButton } from "../components/inputs/Buttons";
import { NotificationCard } from "../components/notifications";
import { useProfile } from "../context/ProfileContext";
import type { RootStackParamList } from "../navigation/types";
import {
  useAccountNotificationsQuery,
  useMarkNotificationReadMutation,
} from "../queries/notifications/useNotificationQueries";
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

/**
 * Notifications of every project on this account (redesign R5e), unread first. A visit notification
 * opens the visit, a defect notification the project's defects; anything else (including actions of
 * the pre-R5 app) is only marked read.
 */
export const NotificationCenterModal: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { account, projects } = useProfile();
  const projectIds = useMemo(() => projects.map((p) => p.projectId), [projects]);
  const projectLabel = useMemo(
    () => new Map(projects.map((p) => [p.projectId, p.projectCodePrefix])),
    [projects],
  );

  const {
    data,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useAccountNotificationsQuery(projectIds, Boolean(account));
  const notifications = useMemo(() => data?.items ?? [], [data]);
  const failedProjects = (data?.failedProjectIds ?? []).map((id) => projectLabel.get(id) ?? "a project");
  const markReadMutation = useMarkNotificationReadMutation();

  const onClose = () => navigation.goBack();

  const handlePress = useCallback(
    async (notif: MobileNotificationDto) => {
      // Passive notifications mark read immediately on tap;
      // Action-required notifications remain unread until the required flow completes.
      if (!notif.requiresAction && !notif.isRead) {
        markReadMutation.mutate(notif);
      }
      // Already answered by someone on the project: open it, but there is nothing left to resolve.
      if (notif.actionedAt) {
        notif = { ...notif, requiresAction: false };
      }

      // Redesign R4/R5b: a visit assigned, changed, reminded, returned or accepted.
      if (notif.actionType === "OPEN_VISIT" && notif.metadata?.visitId) {
        navigation.replace("Visit", { visitId: notif.metadata.visitId });
        return;
      }

      // Phase 10: defect assigned, fixed, closed or overdue.
      if (notif.actionType === "OPEN_DEFECTS") {
        navigation.replace("Defects", { projectId: notif.projectId });
        return;
      }
      // Any other action (including those of the pre-R5 app) has no screen: tapping marks it read.
    },
    [markReadMutation, navigation],
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
          ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"} across your projects`
          : "Updates on your visits across your projects."
      }
      rightAction={<IconButton icon="close" onPress={onClose} />}
      contentContainerStyle={styles.layoutContent}
    >
      {isLoading ? (
        <View style={styles.loaderWrap}>
          <InSiteLoader size="md" label="Loading notifications..." />
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
              tintColor="#00338D"
            />
          }
          ListHeaderComponent={
            failedProjects.length > 0 ? (
              <InfoCallout
                variant="warning"
                title="Some projects could not be read"
                description={`Notifications of ${failedProjects.join(", ")} are not shown. Pull to try again when you are online.`}
              />
            ) : undefined
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
                projectLabel={projects.length > 1 ? projectLabel.get(item.notification.projectId) ?? null : null}
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
                description="Visit changes, reminders and reviews will appear here."
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
