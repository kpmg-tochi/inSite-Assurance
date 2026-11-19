import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  Alert,
} from "react-native";
import Toast from "react-native-toast-message";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { formatElapsedTime } from "@insite/shared";
import { SiteEvidenceCameraModal, type SiteEvidenceBatchSubmission } from "../components/camera";
import { VoiceNoteBubble, VoiceNoteRecorder, type VoiceRecordingResult } from "../components/audio";
import { EmptyStateCard, InfoCallout, InSiteLoader, Pill, type PillVariant } from "../components/common";
import { BackButton } from "../components/inputs/Buttons";
import { acquireFix, geofenceBadgeText, previewGeofence, type GeofencePreview } from "../services/locationService";
import { useProfile } from "../context/ProfileContext";
import {
  useItemReportStatusQuery,
  useSendWbsMessageMutation,
  useWbsChatMessagesQuery,
  wbsQueryKeys,
} from "../queries/wbs/useWbsQueries";
import { personaCopy } from "../utils/personaCopy";
import { projectCadenceSettings } from "../utils/activeCadence";
import { cadenceCopy } from "../utils/projectCadence";
import { briefCardCopy } from "../storage/briefMeta";
import { reportQueryLabel, reportStatusView } from "../utils/reportStatus";
import {
  HELD_EXPLANATION,
  listHeldReports,
  prepareHeldReportForReconfirm,
  removeHeldMessage,
  removeHeldReport,
  updateHeldMessage,
  type HeldReport,
} from "../storage/heldItems";
import { saveCapture } from "../storage/captureStore";
import type { ChatCaptureView, WbsChatMessageRecord } from "../storage/wbsRepository";
import { getMediaUrl } from "../api/evidence/evidenceApi";
import type { RootStackParamList } from "../navigation/types";
import { MaterialCommunityIcons } from "@expo/vector-icons";

/** Time of a message, formatted at render from its ISO timestamp. */
function timeLabel(iso: string): string {
  return formatElapsedTime(iso) || "";
}

/** The only states a capture badge may show: what the app or server actually computed. */
function captureBadge(c: ChatCaptureView | undefined): { text: string; variant: PillVariant } | null {
  if (!c) return null;
  if (c.isMocked) return { text: "Mock location flagged", variant: "negative" };
  if (c.locationAvailable === false) return { text: "Location unavailable", variant: "warning" };
  if (c.uploadState === "PENDING_UPLOAD") return { text: "Pending upload", variant: "gray" };
  if (c.integrityPassed === false) return { text: "Failed integrity check", variant: "negative" };
  const geofenceText = geofenceBadgeText(c.geofenceStatus, c.distanceOutsideMeters);
  if (geofenceText && c.geofenceStatus) {
    return { text: geofenceText, variant: c.geofenceStatus === "OUTSIDE" ? "warning" : "positive" };
  }
  // Captures registered before the server reported a status (Phase 6) only have the boolean.
  if (c.isWithinGeofence === true) return { text: "In geofence", variant: "positive" };
  if (c.isWithinGeofence === false) return { text: "Outside geofence", variant: "warning" };
  return { text: "Uploaded", variant: "info" };
}

/** Shows the local file, or fetches a short-lived signed URL for a server-only capture. */
const CaptureImage: React.FC<{ projectId: string; capture: ChatCaptureView; style: any }> = ({
  projectId,
  capture,
  style,
}) => {
  const [uri, setUri] = useState<string | null>(capture.localUri);
  useEffect(() => {
    if (capture.localUri || !capture.objectKey || !projectId) return;
    let alive = true;
    getMediaUrl(projectId, capture.objectKey)
      .then((u) => alive && setUri(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, capture.localUri, capture.objectKey]);
  return uri ? <Image source={{ uri }} style={style} resizeMode="cover" /> : <View style={[style, { backgroundColor: "#E2E8F0" }]} />;
};

export const WbsChatThreadScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "WbsThread">>();
  const {
    wbsItem,
    activeQueryNotificationId,
    queryPrompt,
    workdayReportId: routeWorkdayReportId,
    reportQueryId: routeReportQueryId,
  } = route.params;
  const { activeProjectId, activeContext, activeSessionId, displayName } = useProfile();
  const userName = displayName || "Field Engineer";
  // Known once the device has synced with this project (provisioned sessions start on first use).
  const mySessionId = activeSessionId;
  const [inputText, setInputText] = useState("");
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [here, setHere] = useState<GeofencePreview | "LOCATING" | "NO_FIX">("LOCATING");
  const insets = useSafeAreaInsets();

  const copy = personaCopy(activeContext?.fieldPersonaType, projectCadenceSettings(activeContext?.projectId).reportingCadence);
  const periodCopy = cadenceCopy(projectCadenceSettings(activeContext?.projectId).reportingCadence);
  const { data: messages = [], isLoading: loadingMessages } = useWbsChatMessagesQuery(wbsItem.id, activeProjectId);
  const { data: myReport } = useItemReportStatusQuery(activeProjectId, wbsItem.id);
  // Only statuses stored from the server (this device's reports, or another device's of the same account).
  const myReportStatus = myReport ? reportStatusView(myReport.serverStatus, myReport.syncStatus) : null;
  const sendMessage = useSendWbsMessageMutation(wbsItem.id);
  const queryClient = useQueryClient();
  const [heldReports, setHeldReports] = useState<HeldReport[]>([]);
  const loadHeldReports = useCallback(() => {
    if (!activeProjectId) return;
    listHeldReports(activeProjectId, wbsItem.id).then(setHeldReports).catch(() => setHeldReports([]));
  }, [activeProjectId, wbsItem.id]);
  useFocusEffect(loadHeldReports);

  const runHeldAction = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      Toast.show({ type: "success", props: { title: "Done", message: done } });
    } catch (err) {
      Toast.show({
        type: "error",
        props: { title: "Could not complete", message: (err as Error)?.message || "Try again." },
      });
    } finally {
      loadHeldReports();
      void queryClient.invalidateQueries({ queryKey: wbsQueryKeys.messages(wbsItem.id) });
    }
  };

  // Header shows where the phone is now, computed locally (the server checks every capture again).
  useEffect(() => {
    let alive = true;
    acquireFix().then((fix) => {
      if (alive) setHere(fix ? previewGeofence(fix, activeProjectId) : "NO_FIX");
    });
    return () => {
      alive = false;
    };
  }, []);

  const herePill: { text: string; variant: PillVariant } =
    here === "LOCATING"
      ? { text: "Locating…", variant: "darkGlass" }
      : here === "NO_FIX"
        ? { text: "Location unavailable", variant: "warning" }
        : here.status
          ? {
              text: geofenceBadgeText(here.status, here.distanceOutsideMeters, here.chainageLabel) ?? "",
              variant: here.status === "OUTSIDE" ? "warning" : "positive",
            }
          : { text: "Geofence unknown", variant: "darkGlass" };

  const openServerQueryMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if ((m.messageType === "AI_QUERY" || m.messageType === "MONITOR_QUERY") && m.queryDetails?.status === "OPEN") {
        return m;
      }
    }
    return undefined;
  }, [messages]);

  const effectiveReportId =
    openServerQueryMsg?.workdayReportId || openServerQueryMsg?.queryDetails?.workdayReportId || routeWorkdayReportId;
  const effectiveQueryId = openServerQueryMsg?.reportQueryId || openServerQueryMsg?.queryDetails?.id || routeReportQueryId;
  const hasOpenQuery = Boolean(openServerQueryMsg || (activeQueryNotificationId && effectiveQueryId));

  const onOpenReport = () =>
    navigation.navigate("EodConfirmModal", {
      wbsItem,
      resolveNotificationId: activeQueryNotificationId,
      workdayReportId: hasOpenQuery ? (effectiveReportId ?? undefined) : undefined,
      reportQueryId: hasOpenQuery ? (effectiveQueryId ?? undefined) : undefined,
      initialSummary: hasOpenQuery && !openServerQueryMsg ? queryPrompt : undefined,
    });

  const isMine = (m: WbsChatMessageRecord) =>
    m.syncStatus !== "SERVER" || (mySessionId !== null && m.senderSessionId === mySessionId);

  const fail = (err: unknown) =>
    Toast.show({
      type: "error",
      props: { title: "Not saved", message: (err as Error)?.message || "Could not save on this device." },
    });

  const base = {
    projectId: activeProjectId,
    wbsItemId: wbsItem.id,
    senderName: userName,
    senderSessionId: mySessionId,
    // The role name comes from the server; the server sets it again when the message arrives.
    senderRole: activeContext?.roleName ?? "Field reporter",
    workdayReportId: hasOpenQuery ? (effectiveReportId ?? null) : null,
    reportQueryId: hasOpenQuery ? (effectiveQueryId ?? null) : null,
  };

  const handleSendText = async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    try {
      await sendMessage.mutateAsync({ ...base, messageType: "TEXT_COMMENT", textContent: text });
    } catch (err) {
      setInputText(text);
      fail(err);
    }
  };

  const handleBatchCaptured = async (batch: SiteEvidenceBatchSubmission) => {
    if (batch.photos.length === 0) return;
    setShowCameraModal(false);
    try {
      for (const [i, photo] of batch.photos.entries()) {
        const capture = await saveCapture({
          projectId: activeProjectId,
          wbsItemId: wbsItem.id,
          mediaType: "SITE_PHOTO",
          sourceUri: photo.uri,
          mimeType: "image/jpeg",
          fileExtension: "jpg",
          caption: batch.caption || null,
          // The fix taken at this photo's shutter; none means "location unavailable", never a default.
          fix: photo.gps ?? null,
          capturedAt: photo.capturedAt,
        });
        await sendMessage.mutateAsync({
          ...base,
          messageType: "PHOTO",
          captureId: capture.id,
          textContent: i === 0 ? batch.caption || null : null,
        });
      }
    } catch (err) {
      fail(err);
    }
  };

  const handleVoiceNoteRecorded = async (result: VoiceRecordingResult) => {
    setShowVoiceRecorder(false);
    try {
      const fix = await acquireFix();
      const capture = await saveCapture({
        projectId: activeProjectId,
        wbsItemId: wbsItem.id,
        mediaType: "VOICE_NOTE",
        sourceUri: result.uri,
        mimeType: result.mimeType,
        fileExtension: result.fileName.split(".").pop() || "m4a",
        durationSeconds: result.durationMs / 1000,
        fix,
        capturedAt: new Date().toISOString(),
      });
      await sendMessage.mutateAsync({ ...base, messageType: "VOICE_NOTE", captureId: capture.id });
    } catch (err) {
      fail(err);
    }
  };

  const renderMessageBody = (msg: WbsChatMessageRecord): React.ReactNode => {
      if (msg.messageType === "MORNING_BRIEF") {
        // Title follows the persona the server wrote this brief for; older cached briefs use the session's.
        const briefCopy = briefCardCopy(msg.brief, activeContext?.fieldPersonaType);
        const standards = msg.brief?.appliedStandards ?? [];
        return (
          <View key={msg.id} style={styles.briefCard}>
            <View style={styles.briefBadgeRow}>
              <Text style={styles.briefBadgeText}>
                Morning brief{msg.briefDate ? ` · ${msg.briefDate}` : ""}
              </Text>
            </View>
            <Text style={styles.briefTitle}>{briefCopy.briefCardTitle}</Text>
            <Text style={styles.briefBody}>{msg.textContent}</Text>
            {standards.length > 0 && (
              <View style={styles.standardsBox}>
                <Text style={styles.standardsHeading}>{briefCopy.standardsHeading}</Text>
                {standards.map((s) => (
                  <Text key={s.code} style={styles.standardsItem}>
                    <Text style={styles.standardsCode}>{s.code}</Text>
                    {s.summaryRule ? `: ${s.summaryRule}` : s.title ? `: ${s.title}` : ""}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      }

      if (msg.messageType === "AI_QUERY" || msg.messageType === "MONITOR_QUERY") {
        const source = msg.queryDetails?.source;
        const isStandardsQuery = source === "AI_STANDARDS_CHECK";
        const isAiQuery = isStandardsQuery || source === "AI_OMISSION_CHECK" || (!source && msg.messageType === "AI_QUERY");
        const queryStatus = msg.queryDetails?.status || "OPEN";
        const isOpen = queryStatus === "OPEN";
        const omitted = msg.queryDetails?.aiOmissionPayload?.omittedItems || [];
        const violations = isStandardsQuery ? (msg.queryDetails?.standardsViolations ?? []) : [];
        return (
          <View key={msg.id} style={[styles.queryCard, !isOpen && styles.queryCardResolved]}>
            <View style={styles.queryHeaderRow}>
              <Pill
                variant={!isOpen ? "positive" : isStandardsQuery ? "negative" : isAiQuery ? "warning" : "info"}
                text={reportQueryLabel(source, msg.messageType)}
              />
              <Text style={styles.queryTimeText}>
                {queryStatus} · {timeLabel(msg.createdAt)}
              </Text>
            </View>
            <Text style={styles.querySenderText}>{msg.senderName}</Text>
            <Text style={styles.queryBodyText}>{msg.textContent}</Text>
            {violations.length > 0 && (
              <View style={styles.omittedListBox}>
                {violations.map((v, idx) => (
                  <View key={`${v.standardCode}-${idx}`} style={styles.violationItem}>
                    <Text style={styles.violationTitle}>
                      {v.standardCode}
                      {v.severity === "CRITICAL" ? " · Critical" : " · Warning"}
                      {v.standardTitle ? ` · ${v.standardTitle}` : ""}
                    </Text>
                    <Text style={styles.omittedListItem}>{v.violationSummary}</Text>
                    <Text style={styles.violationFix}>Required: {v.requiredRectification}</Text>
                  </View>
                ))}
              </View>
            )}
            {omitted.length > 0 && (
              <View style={styles.omittedListBox}>
                {omitted.map((item, idx) => (
                  <Text key={idx} style={styles.omittedListItem}>
                    • {item}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      }

      if (msg.messageType === "QUERY_RESPONSE") {
        return (
          <View key={msg.id} style={styles.queryResponseCard}>
            <Text style={styles.queryResponseBadge}>Revision submitted · {timeLabel(msg.createdAt)}</Text>
            <Text style={styles.queryResponseText}>{msg.textContent}</Text>
          </View>
        );
      }

      if (msg.messageType === "PHOTO" && msg.capture) {
        const badge = captureBadge(msg.capture);
        return (
          <View key={msg.id} style={styles.photoMessageContainer}>
            <CaptureImage projectId={activeProjectId} capture={msg.capture} style={styles.photoImage} />
            <View style={styles.photoCaptionBox}>
              {Boolean(msg.textContent) && <Text style={styles.photoCaptionText}>{msg.textContent}</Text>}
              <View style={styles.photoMetaRow}>
                {badge && <Pill variant={badge.variant} text={badge.text} />}
                <Text style={styles.photoMetaText}>{timeLabel(msg.createdAt)}</Text>
              </View>
            </View>
          </View>
        );
      }

      if (msg.messageType === "VOICE_NOTE") {
        const badge = captureBadge(msg.capture);
        return (
          <VoiceNoteBubble
            key={msg.id}
            senderName={msg.senderName}
            audioUri={msg.capture?.localUri ?? undefined}
            durationMs={msg.capture?.durationSeconds != null ? msg.capture.durationSeconds * 1000 : undefined}
            timestamp={timeLabel(msg.createdAt)}
            chainageLabel={badge?.text}
            isMe={isMine(msg)}
          />
        );
      }

      const isMe = isMine(msg);
      return (
        <View key={msg.id} style={[styles.chatBubble, isMe ? styles.chatBubbleMe : styles.chatBubbleOther]}>
          <Text style={[styles.bubbleSender, isMe && styles.bubbleSenderMe]}>
            {msg.senderName}
            {/* Older messages carry a code such as ENGINEER instead of a role name. */}
            {msg.senderRole && !/^[A-Z_]+$/.test(msg.senderRole) ? ` · ${msg.senderRole}` : ""}
          </Text>
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.textContent}</Text>
          <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
            {msg.syncStatus === "QUEUED" ? "Waiting to send · " : ""}
            {timeLabel(msg.createdAt)}
          </Text>
        </View>
      );
  };

  /** Phase 5 Step 8: an item queued under a session that has ended waits for the person. */
  const onHeldPress = (msg: WbsChatMessageRecord) => {
    Alert.alert('Captured under an ended session', HELD_EXPLANATION, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void runHeldAction(() => removeHeldMessage(msg.id), 'Removed from this device.'),
      },
      {
        text: 'Update',
        onPress: () =>
          void runHeldAction(() => updateHeldMessage(msg.id), 'Re-validated and queued under your current session.'),
      },
    ]);
  };

  const onHeldReportPress = (report: HeldReport) => {
    Alert.alert(
      'Report from an ended session',
      `Your ${report.workdayDate} report was confirmed under a project session that has since ended, so it will not be sent as it is. Remove it, or re-confirm it under your current session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void runHeldAction(() => removeHeldReport(report.id), 'Report removed from this device.'),
        },
        {
          text: 'Re-confirm',
          onPress: () =>
            void runHeldAction(async () => {
              await prepareHeldReportForReconfirm(report.id);
              navigation.navigate('EodConfirmModal', { wbsItem, initialSummary: report.summaryText });
            }, 'Check the report and confirm it again.'),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient
        colors={["#0891B2", "#1E3A8A", "#312E81", "#1E1B4B"]}
        locations={[0, 0.35, 0.75, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.9 }}
        style={[styles.headerGradient, { paddingTop: Math.max(insets.top + 8, 20) }]}
      >
        <View style={styles.headerTop}>
          <View style={styles.closeRow}>
            <BackButton onPress={() => navigation.goBack()} />
            <Text style={styles.threadWbsTitle}>WBS {wbsItem.wbsCode}</Text>
          </View>
          <Pill variant={herePill.variant} text={herePill.text} />
        </View>
        <Text style={styles.threadWbsDesc} numberOfLines={1}>
          {wbsItem.description}
        </Text>
      </LinearGradient>

      <View style={styles.curvedContainer}>
        <ScrollView contentContainerStyle={styles.chatStream} showsVerticalScrollIndicator={false}>
          {hasOpenQuery && !openServerQueryMsg && (
            <InfoCallout
              variant="warning"
              title="Clarification requested"
              description={
                queryPrompt ||
                "Add photos, voice notes or a reason in this chat, then revise your report below."
              }
            />
          )}
          {loadingMessages ? (
            <InSiteLoader size="sm" label="Loading WBS thread..." />
          ) : messages.length === 0 ? (
            <EmptyStateCard
              title={`WBS ${wbsItem.wbsCode} thread`}
              description="Add photos, voice notes and notes here during the day. Submit your full report at the end of the day."
            />
          ) : null}
          {heldReports.map((report) => (
            <TouchableOpacity key={report.id} onPress={() => onHeldReportPress(report)} activeOpacity={0.8}>
              <InfoCallout
                variant="warning"
                title="Report from an ended session"
                description={`${report.workdayDate}: not sent. Tap to remove it or re-confirm it under your current session.`}
              />
            </TouchableOpacity>
          ))}
          {messages.map((msg) => {
            const content = renderMessageBody(msg);
            if (!msg.heldAfterSessionEnd) return content;
            return (
              <View key={msg.id}>
                {content}
                <TouchableOpacity
                  style={styles.heldRow}
                  onPress={() => onHeldPress(msg)}
                  accessibilityRole="button"
                  accessibilityLabel="Captured under an ended session. Tap to remove or update."
                >
                  <MaterialCommunityIcons name="alert-circle" size={16} color="#B45309" />
                  <Text style={styles.heldText}>Not sent: captured under an ended session. Tap to decide.</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.composerContainer, { paddingBottom: Math.max(insets.bottom + 6, 12) }]}>
          {showVoiceRecorder && (
            <View style={styles.voiceRecorderWrapper}>
              <VoiceNoteRecorder
                submitLabel="Send voice note"
                onRecordingComplete={handleVoiceNoteRecorded}
                onCancel={() => setShowVoiceRecorder(false)}
              />
            </View>
          )}

          <View style={styles.composerRow}>
            <TouchableOpacity
              style={styles.cameraIconBtn}
              onPress={() => setShowCameraModal(true)}
              activeOpacity={0.8}
              accessibilityLabel="Take a site photo"
            >
              <MaterialCommunityIcons name={"camera"} size={16} color={"#fff"} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cameraIconBtn, showVoiceRecorder && styles.micIconBtnActive]}
              onPress={() => setShowVoiceRecorder((prev) => !prev)}
              activeOpacity={0.8}
              accessibilityLabel="Record a voice note"
            >
              <MaterialCommunityIcons name={"microphone"} size={16} color={"#fff"} />
            </TouchableOpacity>
            <TextInput
              style={styles.composerInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={`Note for WBS ${wbsItem.wbsCode} (e.g. cement arrived late)`}
              placeholderTextColor="#94A3B8"
            />
            <TouchableOpacity
              style={styles.sendIconBtn}
              onPress={handleSendText}
              activeOpacity={0.8}
              accessibilityLabel="Send note"
            >
              <Text style={styles.sendIconText}>➤</Text>
            </TouchableOpacity>
          </View>

          {myReportStatus && (
            <View style={styles.reportStatusRow}>
              <Text style={styles.reportStatusLabel}>
                {myReport?.fromThisDevice === false ? `${periodCopy.reportNoun} · another device` : periodCopy.reportNoun}
              </Text>
              <Pill variant={myReportStatus.variant} text={myReportStatus.label} />
            </View>
          )}
          {(wbsItem.isReportedToday || myReport) && !hasOpenQuery ? (
            <View style={[styles.quickEodBar, styles.quickEodBarCompleted]}>
              <Text style={styles.quickEodBarCompletedText}>{`${periodCopy.submittedLabel} ✓`}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.quickEodBar, hasOpenQuery && styles.quickEodBarResubmit]}
              onPress={onOpenReport}
              activeOpacity={0.8}
            >
              <Text style={styles.quickEodBarText}>
                {hasOpenQuery
                  ? myReportStatus?.needsAction
                    ? "Revise report (returned for revision)"
                    : "Revise report (query open)"
                  : copy.endOfDayButton}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <SiteEvidenceCameraModal
        visible={showCameraModal}
        wbsCode={wbsItem.wbsCode}
        onSubmit={handleBatchCaptured}
        onClose={() => setShowCameraModal(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  heldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#FEF3C7",
    alignSelf: "flex-start",
  },
  heldText: { fontSize: 11, fontWeight: "700", color: "#92400E" },
  container: {
    flex: 1,
    backgroundColor: "#1E1B4B",
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  curvedContainer: {
    flex: 1,
    marginTop: -16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#F8FAFC",
    overflow: "hidden",
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  closeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButtonWrap: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButton: {
    fontSize: 13,
    fontWeight: "700",
    color: "#38BDF8",
  },
  inZoneBadge: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  inZoneBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#065F46",
  },
  threadWbsTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  threadWbsDesc: {
    fontSize: 11,
    color: "#BFDBFE",
    marginTop: 2,
  },
  chatStream: {
    padding: 16,
    gap: 12,
  },
  briefCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    gap: 6,
  },
  briefBadgeRow: {
    alignSelf: "flex-start",
  },
  briefBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#00338D",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  briefTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0C233C",
  },
  briefBody: {
    fontSize: 11,
    color: "#334155",
    lineHeight: 16,
  },
  standardsBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#CBD5E1",
    gap: 3,
  },
  standardsHeading: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1E293B",
  },
  standardsItem: {
    fontSize: 11,
    color: "#334155",
    lineHeight: 16,
  },
  standardsCode: {
    fontWeight: "700",
    color: "#1E3A8A",
  },
  violationItem: {
    gap: 2,
    marginBottom: 6,
  },
  violationTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#991B1B",
  },
  violationFix: {
    fontSize: 11,
    fontWeight: "600",
    color: "#1E293B",
    lineHeight: 15,
  },
  reportStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  reportStatusLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#475569",
  },
  eodCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "#00338D",
    gap: 6,
  },
  eodTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#00338D",
  },
  eodBody: {
    fontSize: 11,
    color: "#334155",
    lineHeight: 16,
  },
  eodButton: {
    backgroundColor: "#00338D",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  eodButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  photoMessageContainer: {
    alignSelf: "flex-end",
    width: "85%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  photoImage: {
    width: "100%",
    height: 160,
  },
  photoCaptionBox: {
    padding: 10,
    gap: 4,
  },
  photoCaptionText: {
    fontSize: 11,
    color: "#0F172A",
    fontWeight: "600",
    lineHeight: 15,
  },
  photoMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  photoMetaText: {
    fontSize: 10,
    color: "#94A3B8",
  },
  chatBubble: {
    maxWidth: "82%",
    borderRadius: 14,
    padding: 12,
    gap: 3,
  },
  chatBubbleMe: {
    alignSelf: "flex-end",
    backgroundColor: "#00338D",
  },
  chatBubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  bubbleSender: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  bubbleSenderMe: {
    color: "#BFDBFE",
  },
  bubbleText: {
    fontSize: 12,
    color: "#0F172A",
    lineHeight: 17,
  },
  bubbleTextMe: {
    color: "#FFFFFF",
  },
  bubbleTime: {
    fontSize: 9,
    color: "#94A3B8",
    alignSelf: "flex-end",
  },
  bubbleTimeMe: {
    color: "#93C5FD",
  },
  composerContainer: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    padding: 12,
    gap: 8,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cameraIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  micIconBtnActive: {
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  voiceRecorderWrapper: {
    marginBottom: 4,
  },
  cameraIconText: {
    fontSize: 18,
  },
  composerInput: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12,
    color: "#0F172A",
  },
  sendIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#00338D",
    alignItems: "center",
    justifyContent: "center",
  },
  sendIconText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  quickEodBar: {
    backgroundColor: "#0C233C",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  quickEodBarResubmit: {
    backgroundColor: "#B45309",
  },
  quickEodBarCompleted: {
    backgroundColor: "#E2E8F0",
  },
  quickEodBarText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  quickEodBarCompletedText: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "700",
  },
  queryCard: {
    backgroundColor: "#FFFBEB",
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderLeftWidth: 4,
    borderLeftColor: "#D97706",
    gap: 5,
  },
  queryCardResolved: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    borderLeftColor: "#059669",
  },
  queryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  queryTimeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  querySenderText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0F172A",
  },
  queryBodyText: {
    fontSize: 12,
    color: "#334155",
    lineHeight: 18,
  },
  omittedListBox: {
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 8,
    padding: 8,
    gap: 3,
    marginTop: 2,
  },
  omittedListItem: {
    fontSize: 11,
    color: "#92400E",
    fontWeight: "600",
  },
  queryResponseCard: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    backgroundColor: "#ECFDF5",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#A7F3D0",
    padding: 12,
    gap: 4,
  },
  queryResponseBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: "#065F46",
  },
  queryResponseText: {
    fontSize: 12,
    color: "#064E3B",
    lineHeight: 17,
  },
  photoBubbleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    backgroundColor: "#E2E8F0",
  },
  photoGridItem: {
    width: "49%",
    height: 115,
    flexGrow: 1,
  },
  photoGridItemFull: {
    width: "100%",
    height: 145,
  },
});
