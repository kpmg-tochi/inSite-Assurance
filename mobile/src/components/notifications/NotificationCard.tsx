import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  formatElapsedTime,
  type MobileNotificationDto,
  type MobileNotificationType,
} from "@insite/shared";
import Pill, { type PillVariant } from "../common/Pill";
import { reportQueryLabel } from "../../utils/reportStatus";
import { SubtleGradient } from "../common/SubtleGradient";
import {
  borderRadius,
  defaultColors,
  defaultShadow,
} from "../../styles/commonStyles";

interface NotificationVisualConfig {
  icon: React.ComponentProps<typeof Feather>["name"];
  accentColor: string;
  iconBg: string;
  badgeText: string;
  pillVariant: PillVariant;
  ctaLabel?: string;
}

const NOTIFICATION_VISUALS: Record<
  MobileNotificationType,
  NotificationVisualConfig
> = {
  ASSURANCE_PENDING: {
    icon: "clock",
    accentColor: "#D97706",
    iconBg: "#FEF3C7",
    badgeText: "Pending Assurance",
    pillVariant: "warning",
  },
  ASSURANCE_APPROVED: {
    icon: "check-circle",
    accentColor: "#059669",
    iconBg: "#ECFDF5",
    badgeText: "Assurance Approved",
    pillVariant: "positive",
  },
  ASSURANCE_REJECTED: {
    icon: "alert-triangle",
    accentColor: "#DC2626",
    iconBg: "#FFF1F2",
    badgeText: "Resubmission Needed",
    pillVariant: "negative",
    ctaLabel: "Re-verify Identity",
  },
  BACKLOG_REVIEW_REQUIRED: {
    icon: "layers",
    accentColor: "#00338D",
    iconBg: "#EFF6FF",
    badgeText: "Backlog Review",
    pillVariant: "info",
    ctaLabel: "Review AI Summary",
  },
  REPORT_QUERY: {
    icon: "message-square",
    accentColor: "#B45309",
    iconBg: "#FFFBEB",
    badgeText: "Query · Clarification",
    pillVariant: "warning",
    ctaLabel: "Open WBS Chat",
  },
  HOLD_POINT_ALERT: {
    icon: "shield",
    accentColor: "#BE123C",
    iconBg: "#FFF1F2",
    badgeText: "Hold Point",
    pillVariant: "negative",
    ctaLabel: "Submit Hold-Point Proof",
  },
  MORNING_DELIVERABLE_READY: {
    icon: "sun",
    accentColor: "#0284C7",
    iconBg: "#E0F2FE",
    badgeText: "Morning Brief",
    pillVariant: "info",
    ctaLabel: "Open Deliverable",
  },
  SITE_GEOFENCE_WARNING: {
    icon: "map-pin",
    accentColor: "#D97706",
    iconBg: "#FEF3C7",
    badgeText: "Geofence Alert",
    pillVariant: "warning",
  },
  REPORT_OVERDUE: {
    icon: "alert-circle",
    accentColor: "#DC2626",
    iconBg: "#FEE2E2",
    badgeText: "Report overdue",
    pillVariant: "negative",
  },
  // Phase 10
  DEFECT_UPDATE: {
    icon: "tool",
    accentColor: "#0369A1",
    iconBg: "#E0F2FE",
    badgeText: "Defect",
    pillVariant: "info",
    ctaLabel: "Open defects",
  },
  // Phase 14
  INSPECTION_FINDING: {
    icon: "alert-triangle",
    accentColor: "#B45309",
    iconBg: "#FEF3C7",
    badgeText: "Finding",
    pillVariant: "warning",
    ctaLabel: "Open findings",
  },
};

export interface NotificationCardProps {
  notification: MobileNotificationDto;
  onPress: (notification: MobileNotificationDto) => void;
}

/**
 * Type-aware Notification card that differentiates passive informational notifications
 * from action-required notifications (which stay unread until their target action completes).
 */
export const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  onPress,
}) => {
  const visuals =
    NOTIFICATION_VISUALS[notification.type] ??
    NOTIFICATION_VISUALS.ASSURANCE_PENDING;
  const elapsedLabel = formatElapsedTime(notification.createdAt);
  const wbsCode = notification.metadata?.wbsCode;
  // Report queries say where they came from (Phase 7): standards check, omission check or monitor.
  const querySource = notification.metadata?.querySource;
  const badgeText =
    notification.type === "REPORT_QUERY" && querySource
      ? reportQueryLabel(querySource)
      : visuals.badgeText;
  const rawCodes = (notification.metadata as Record<string, unknown> | undefined)?.standardCodes;
  const standardCodes =
    querySource === "AI_STANDARDS_CHECK" && Array.isArray(rawCodes)
      ? rawCodes.filter((c): c is string => typeof c === "string" && c.length > 0)
      : [];
  const showActionButton = Boolean(
    visuals.ctaLabel &&
      (notification.requiresAction || notification.actionType !== "NONE"),
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
          {/* Top Metadata Row: Pill + WBS code + Unread dot + Elapsed time */}
          <View style={styles.metaRow}>
            <View style={styles.metaLeft}>
              <Pill
                variant={notification.isRead ? "gray" : visuals.pillVariant}
                text={badgeText}
              />
              {wbsCode ? (
                <Text style={styles.wbsTag}>WBS {wbsCode}</Text>
              ) : null}
              {standardCodes.length > 0 ? (
                <Text style={styles.wbsTag} numberOfLines={1}>
                  {standardCodes.join(", ")}
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
                <Text style={styles.actionHint}>Stays unread until sent</Text>
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
  wbsTag: {
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
