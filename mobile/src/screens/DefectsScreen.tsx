import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFECT_STATUS_LABELS, type DefectTicketDto } from "@insite/shared";
import { PHOTO_SAFEGUARDING_HINT } from "../utils/personaCopy";
import { EmptyStateCard, InfoCallout, InSiteLoader, Pill } from "../components/common";
import { SiteEvidenceCameraModal, type SiteEvidenceBatchSubmission } from "../components/camera";
import { useProfile } from "../context/ProfileContext";
import { fetchDefectTickets } from "../api/defects/defectsApi";
import { saveCapture } from "../storage/captureStore";
import { queueDefectAction } from "../storage/defectActionStore";
import { formatMobileErrorMessage } from "../utils/errorFormatter";
import type { RootStackParamList } from "../navigation/types";

/**
 * Defects (Phase 10; staff-only since R1d). The contractor fixes defects outside the platform; an
 * officer closes a ticket with site photos of the repair, or reopens one awaiting verification.
 * Photos go through the normal capture path (signed, geotagged, sent by the outbox) and the action
 * is queued behind them, so it works offline.
 */

const STATUS_VARIANT: Record<DefectTicketDto["status"], "primary" | "positive" | "warning" | "info"> = {
  OPEN: "warning",
  ASSIGNED: "warning",
  RECTIFIED_PENDING_VERIFICATION: "info",
  VERIFIED_CLOSED: "positive",
  REJECTED_NOT_A_DEFECT: "primary",
};

export const defectsQueryKey = (projectId: string | null) => ["defects", projectId] as const;

export default function DefectsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RootStackParamList, "Defects">>();
  const { activeProjectId } = useProfile();
  // Redesign R5b (D-R5.15): opened from the project screen with its id; the last opened project otherwise.
  const projectId = route.params?.projectId || activeProjectId;
  const query = useQuery({
    queryKey: defectsQueryKey(projectId),
    queryFn: () => fetchDefectTickets(projectId!),
    enabled: Boolean(projectId),
  });
  const [acting, setActing] = useState<DefectTicketDto | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());

  const tickets = query.data ?? [];
  const open = tickets.filter((t) => t.status !== "VERIFIED_CLOSED" && t.status !== "REJECTED_NOT_A_DEFECT");
  const closed = tickets.filter((t) => !open.includes(t));

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient
        colors={["#12915C", "#005A4A", "#0C201D", "#122F2A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.closeText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Defects</Text>
        <Text style={styles.subtitle}>Problems found after handover. Photos and updates send when you are online.</Text>
      </LinearGradient>

      <ScrollView style={styles.body} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {query.isLoading && <InSiteLoader />}
        {query.isError && (
          <InfoCallout
            variant="warning"
            title="Could not load defects"
            description={`${formatMobileErrorMessage(query.error)} Pull down or come back when you are online.`}
          />
        )}
        {!query.isLoading && !query.isError && tickets.length === 0 && (
          <EmptyStateCard title="No defects" description="Nothing has been raised on this project." />
        )}
        {open.map((t) => (
          <TicketCard key={t.id} ticket={t} queued={queued.has(t.id)} onAct={() => setActing(t)} />
        ))}
        {closed.length > 0 && <Text style={styles.sectionLabel}>Closed</Text>}
        {closed.map((t) => (
          <TicketCard key={t.id} ticket={t} queued={false} onAct={() => undefined} />
        ))}
        <TouchableOpacity onPress={() => query.refetch()} style={styles.refresh} activeOpacity={0.7}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </ScrollView>

      {acting && projectId && (
        <ActionSheet
          projectId={projectId}
          ticket={acting}
          onClose={() => setActing(null)}
          onQueued={() => {
            setQueued((s) => new Set(s).add(acting.id));
            setActing(null);
          }}
        />
      )}
    </View>
  );
}

function TicketCard({ ticket: t, queued, onAct }: { ticket: DefectTicketDto; queued: boolean; onAct: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.reference}>{t.reference}</Text>
        <Pill variant={STATUS_VARIANT[t.status]} text={DEFECT_STATUS_LABELS[t.status]} />
      </View>
      <Text style={styles.cardTitle}>{t.title}</Text>
      <Text style={styles.cardText}>{t.description}</Text>
      <Text style={styles.cardMeta}>
        {t.contractorName}
        {t.location ? ` · ${t.location}` : ""}
        {t.dueDate ? ` · due ${t.dueDate}` : ""}
        {t.isOverdue ? " · overdue" : ""}
      </Text>
      {t.resolutionReason ? <Text style={styles.cardText}>Note: {t.resolutionReason}</Text> : null}
      {queued ? (
        <Text style={styles.queued}>Update saved. It sends when you are online.</Text>
      ) : (
        <View style={styles.actions}>
          {t.actions.verify.allowed && (
            <TouchableOpacity style={styles.primaryButton} onPress={onAct} activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>Check the repair</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function ActionSheet({
  projectId,
  ticket,
  onClose,
  onQueued,
}: {
  projectId: string;
  ticket: DefectTicketDto;
  onClose: () => void;
  onQueued: () => void;
}) {
  const queryClient = useQueryClient();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [captureIds, setCaptureIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<"CLOSE" | "REOPEN">("CLOSE");
  // Only a ticket awaiting verification can be reopened; an open or assigned one is closed with photos.
  const canReopen = ticket.status === "RECTIFIED_PENDING_VERIFICATION";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPhotos = async (batch: SiteEvidenceBatchSubmission) => {
    setCameraOpen(false);
    try {
      const ids: string[] = [];
      for (const photo of batch.photos) {
        const capture = await saveCapture({
          projectId,
          mediaType: "SITE_PHOTO",
          sourceUri: photo.uri,
          mimeType: "image/jpeg",
          fileExtension: "jpg",
          caption: batch.caption || `${ticket.reference} verification`,
          // The fix taken at this photo's shutter; none means "location unavailable", never a default.
          fix: photo.gps ?? null,
          heading: photo.heading ?? null,
          capturedAt: photo.capturedAt,
        });
        ids.push(capture.id);
      }
      setCaptureIds((c) => [...c, ...ids]);
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await queueDefectAction(projectId, {
        ticketId: ticket.id,
        decision: canReopen ? decision : "CLOSE",
        notes,
        captureIds,
      });
      queryClient.invalidateQueries({ queryKey: defectsQueryKey(projectId) });
      onQueued();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheetBackdrop}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>Check the repair</Text>
        <Text style={styles.cardMeta}>
          {ticket.reference} · {ticket.title}
        </Text>
        <Text style={styles.cardText}>Take photos of the fixed defect before closing it. {PHOTO_SAFEGUARDING_HINT}.</Text>
        {canReopen && (
          <View style={styles.actions}>
            {(["CLOSE", "REOPEN"] as const).map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.toggle, decision === d && styles.toggleOn]}
                onPress={() => setDecision(d)}
                activeOpacity={0.8}
              >
                <Text style={[styles.toggleText, decision === d && styles.toggleTextOn]}>{d === "CLOSE" ? "Fixed: close" : "Not fixed: reopen"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setCameraOpen(true)} activeOpacity={0.8}>
          <Text style={styles.secondaryButtonText}>{captureIds.length > 0 ? `Photos taken: ${captureIds.length}. Add more` : "Take photos"}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          multiline
          value={notes}
          onChangeText={setNotes}
          maxLength={2000}
          placeholder={canReopen && decision === "REOPEN" ? "What is still wrong" : "Notes (optional)"}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={submit} disabled={busy} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>{busy ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <SiteEvidenceCameraModal visible={cameraOpen} title={`Defect ${ticket.reference}`} onSubmit={onPhotos} onClose={() => setCameraOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  closeText: { fontSize: 13, color: "#A7D8CB", fontWeight: "700", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: "#CBD5E1", marginTop: 4 },
  body: { flex: 1 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: "#64748B", textTransform: "uppercase", marginTop: 12, marginBottom: 6 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  reference: { fontSize: 11, fontWeight: "800", color: "#64748B" },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#0F172A" },
  cardText: { fontSize: 12, color: "#475569", marginTop: 4 },
  cardMeta: { fontSize: 11, color: "#64748B", marginTop: 6 },
  queued: { fontSize: 12, color: "#005A4A", fontWeight: "600", marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  primaryButton: { backgroundColor: "#005A4A", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  secondaryButton: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 10 },
  secondaryButtonText: { color: "#0F172A", fontWeight: "600", fontSize: 13 },
  refresh: { alignSelf: "center", padding: 12 },
  refreshText: { color: "#005A4A", fontWeight: "700", fontSize: 13 },
  sheetBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  toggle: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  toggleOn: { backgroundColor: "#005A4A", borderColor: "#005A4A" },
  toggleText: { fontSize: 12, fontWeight: "600", color: "#0F172A" },
  toggleTextOn: { color: "#FFFFFF" },
  input: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, padding: 12, minHeight: 80, marginTop: 12, textAlignVertical: "top", fontSize: 13 },
  error: { color: "#B91C1C", fontSize: 12, marginTop: 8 },
});
