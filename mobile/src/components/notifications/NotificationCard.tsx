import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  formatElapsedTime,
  type MobileNotificationDto,
  type MobileNotificationType,
} from "@insite/shared";
import Pill, { type PillVariant } from "../common/Pill";
import { SubtleGradient } from "../common/SubtleGradient";
import {
  borderRadius,
  defaultColors,
  defaultShadow,
} from "../../styles/commonStyles";
import { PROJECT_ALERT_BADGE, projectAlertOf } from "../../utils/notificationTarget";

interface NotificationVisualConfig {
  icon: React.ComponentProps<typeof Feather>["name"];
  accentColor: string;
  iconBg: string;
  badgeText: string;
  pillVariant: PillVariant;
  ctaLabel?: string;
}

/**
 * Redesign R5e: the visit app's notification types. Types of the pre-R5 app (reports, chat, hold
 * points, inspections) that the server may still have stored show as a plain update.
 */
const GENERIC_VISUAL: NotificationVisualConfig = {
  icon: "bell",
  accentColor: "#475569",
  iconBg: "#F1F5F9",
  badgeText: "Update",
  pillVariant: "gray",
};

const NOTIFICATION_VISUALS: Partial<Record<MobileNotificationType, NotificationVisualConfig>> = {
  // Phase 10
  DEFECT_UPDATE: {
    icon: "tool",
    accentColor: "#005A4A",
    iconBg: "#E0F2FE",
    badgeText: "Defect",
    pillVariant: "info",
    ctaLabel: "Open defects",
  },
  // Redesign R4: visit notifications (OPEN_VISIT opens the visit).
  VISIT_ASSIGNED: {
    icon: "calendar",
    accentColor: "#00715D",
    iconBg: "#D7EEE8",
    badgeText: "Monitoring visit",
    pillVariant: "info",
    ctaLabel: "Open monitoring visit",
  },
  VISIT_CHANGED: {
    icon: "calendar",
    accentColor: "#00715D",
    iconBg: "#D7EEE8",
    badgeText: "Monitoring visit changed",
    pillVariant: "info",
    ctaLabel: "Open monitoring visit",
  },
  VISIT_REMINDER: {
    icon: "bell",
    accentColor: "#B45309",
    iconBg: "#FEF3C7",
    badgeText: "Confirm monitoring visit",
    pillVariant: "warning",
    ctaLabel: "Open monitoring visit",
  },
  VISIT_RETURNED: {
    icon: "corner-up-left",
    accentColor: "#B45309",
    iconBg: "#FEF3C7",
    badgeText: "Returned",
    pillVariant: "warning",
    ctaLabel: "Open monitoring visit",
  },
  VISIT_APPROVED: {
    icon: "check-circle",
    accentColor: "#047857",
    iconBg: "#D1FAE5",
    badgeText: "Accepted",
    pillVariant: "info",
    ctaLabel: "Open monitoring visit",
  },
};

/** UBEC IRL: early-warning alerts on the project (stalled, site update overdue) open the project. */
const ALERT_VISUAL: Omit<NotificationVisualConfig, "badgeText"> = {
  icon: "alert-triangle",
  accentColor: "#B91C1C",
  iconBg: "#FEE2E2",
  pillVariant: "warning",
  ctaLabel: "Open project",
};

/** Actions that open a screen (the others only mark the notification read). */
const OPENING_ACTIONS = new Set(["OPEN_VISIT", "OPEN_DEFECTS"]);

export interface NotificationCardProps {
  notification: MobileNotificationDto;
  /** The project's code, shown when the account has more than one project. */
  projectLabel?: string | null;
  onPress: (notification: MobileNotificationDto) => void;
}

/**
 * Type-aware Notification card that differentiates passive informational notifications
 * from action-required notifications (which stay unread until their target action completes).
 */
export const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  projectLabel,
  onPress,
}) => {
  const alertKey = projectAlertOf(notification);
  const visuals: NotificationVisualConfig = alertKey
    ? { ...ALERT_VISUAL, badgeText: PROJECT_ALERT_BADGE[alertKey] }
    : NOTIFICATION_VISUALS[notification.type] ?? GENERIC_VISUAL;
  const elapsedLabel = formatElapsedTime(notification.createdAt);
  const badgeText = visuals.badgeText;
  const showActionButton = Boolean(
    visuals.ctaLabel && (alertKey !== null || OPENING_ACTIONS.has(notification.actionType)),
  );

  return (
    <TouchableOpacity
      style={[
        styles.card,
        !notification.isRead && [
          styles.cardUnread,
          { borderColor: visuals.accentColor },
        ],
      ]}
      onPress={() => onPress(notification)}
      activeOpacity={0.82}
    >
      {!notification.isRead && (
        <SubtleGradient
          colors={[visuals.accentColor, visuals.accentColor]}
          opacity="0.10"
        />
      )}

      {/* Left vertical type strip */}
      <View
        style={[
          styles.accentStrip,
          {
            backgroundColor: notification.isRead
              ? "#CBD5E1"
              : visuals.accentColor,
          },
        ]}
      />

      <View style={styles.innerRow}>
        {/* Leading Type Icon */}
        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor: notification.isRead
                ? "#F1F5F9"
                : visuals.iconBg,
            },
          ]}
        >
          <Feather
            name={visuals.icon}
            size={18}
            color={notification.isRead ? "#64748B" : visuals.accentColor}
          />
        </View>

        <View style={styles.contentColumn}>
          {/* Top Metadata Row: Pill + project code + Unread dot + Elapsed time */}
          <View style={styles.metaRow}>
            <View style={styles.metaLeft}>
              <Pill
                variant={notification.isRead ? "gray" : visuals.pillVariant}
                text={badgeText}
              />
              {projectLabel ? (
                <Text style={styles.projectTag} numberOfLines={1}>
                  {projectLabel}
                </Text>
              ) : null}
            </View>

            <View style={styles.metaRight}>
              {!notification.isRead && (
                <View
                  style={[
                    styles.unreadDot,
                    { backgroundColor: visuals.accentColor },
                  ]}
                />
              )}
              <Text style={styles.timeText}>{elapsedLabel}</Text>
            </View>
          </View>

          {/* Notification Title & Message */}
          <Text
            style={[
              styles.title,
              notification.isRead && styles.titleRead,
            ]}
          >
            {notification.title}
          </Text>
          <Text
            style={[
              styles.message,
              notification.isRead && styles.messageRead,
            ]}
          >
            {notification.message}
          </Text>
          {notification.actionedAt ? (
            <Text style={styles.passiveHint}>
              Answered{notification.actionedByName ? ` by ${notification.actionedByName}` : ""}
            </Text>
          ) : null}

          {/* Footer Action Row */}
          {showActionButton ? (
            <View style={styles.footerRow}>
              <View
                style={[
                  styles.ctaChip,
                  {
                    backgroundColor: notification.isRead
                      ? "#F1F5F9"
                      : visuals.accentColor,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.ctaText,
                    notification.isRead && styles.ctaTextRead,
                  ]}
                >
                  {notification.isRead && notification.requiresAction
                    ? "Completed · View"
                    : visuals.ctaLabel}
                </Text>
                <Feather
                  name="arrow-right"
                  size={12}
                  color={notification.isRead ? "#475569" : "#FFFFFF"}
                />
              </View>

              {notification.requiresAction && !notification.isRead ? (
                <Text style={styles.actionHint}>Stays unread until done</Text>
              ) : null}
            </View>
          ) : !notification.isRead ? (
            <Text style={styles.passiveHint}>Tap to mark as read</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: borderRadius.large,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    position: "relative",
    ...defaultShadow,
  },
  cardUnread: {
    backgroundColor: "#FFFFFF",
  },
  accentStrip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  innerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 16,
    gap: 12,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  contentColumn: {
    flex: 1,
    gap: 5,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  metaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  metaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  projectTag: {
    fontSize: 10,
    fontWeight: "700",
    color: defaultColors.secondaryText,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  timeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    lineHeight: 19,
  },
  titleRead: {
    fontWeight: "700",
    color: "#334155",
  },
  message: {
    fontSize: 12.5,
    color: "#475569",
    lineHeight: 18,
  },
  messageRead: {
    color: "#64748B",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    gap: 8,
  },
  ctaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  ctaText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  ctaTextRead: {
    color: "#475569",
  },
  actionHint: {
    fontSize: 10,
    fontWeight: "600",
    color: "#94A3B8",
    flexShrink: 1,
    textAlign: "right",
  },
  passiveHint: {
    fontSize: 10,
    fontWeight: "600",
    color: "#94A3B8",
    marginTop: 2,
  },
});
