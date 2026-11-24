import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { INSPECTION_VISIT_TYPE_LABELS, type InspectionFindingDto } from "@insite/shared";
import { EmptyStateCard, InfoCallout, InSiteLoader, Pill } from "../components/common";
import { SiteEvidenceCameraModal, type SiteEvidenceBatchSubmission } from "../components/camera";
import { useProfile } from "../context/ProfileContext";
import { fetchInspectionFindings } from "../api/inspections/inspectionsApi";
import { saveCapture } from "../storage/captureStore";
import { queueFindingResolution } from "../storage/inspectionStore";
import { formatMobileErrorMessage } from "../utils/errorFormatter";
import { personaCopy } from "../utils/personaCopy";
import type { RootStackParamList } from "../navigation/types";

/**
 * Inspection findings (Phase 14). A contractor sees the findings aimed at its package and resolves
 * them with photos; a verifier may record the fix too. Photos go through the normal capture path and
 * the resolution is queued behind them, so it works offline. The server decides who may resolve.
 */

export const findingsQueryKey = (projectId: string | null) => ["inspection-findings", projectId] as const;

const SEVERITY_VARIANT: Record<InspectionFindingDto["severity"], "warning" | "negative" | "info"> = {
  MINOR: "info",
  MAJOR: "warning",
  CRITICAL: "negative",
};

export default function InspectionFindingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { activeProjectId: projectId, activeContext } = useProfile();
  const copy = personaCopy(activeContext?.fieldPersonaType);
  const query = useQuery({
    queryKey: findingsQueryKey(projectId),
    queryFn: () => fetchInspectionFindings(projectId!),
    enabled: Boolean(projectId),
  });
  const [acting, setActing] = useState<InspectionFindingDto | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const findings = query.data ?? [];
  const open = findings.filter((f) => f.status === "OPEN");
  const closed = findings.filter((f) => f.status !== "OPEN");

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient colors={["#B45309", "#6546FC", "#1E1B4B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.closeText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{copy.findingsEntry}</Text>
        <Text style={styles.subtitle}>{copy.findingsSubtitle}</Text>
      </LinearGradient>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {query.isLoading && <InSiteLoader />}
        {query.isError && (
          <InfoCallout variant="warning" title="Could not load findings" description={`${formatMobileErrorMessage(query.error)} Come back when you are online.`} />
        )}
        {!query.isLoading && !query.isError && findings.length === 0 && (
          <EmptyStateCard title="No findings" description="Nothing has been raised for you on this project." />
        )}
        {open.map((f) => (
          <FindingCard key={f.id} finding={f} queued={queued.has(f.id)} onResolve={() => setActing(f)} />
        ))}
        {closed.length > 0 && <Text style={styles.sectionLabel}>Closed</Text>}
        {closed.map((f) => (
          <FindingCard key={f.id} finding={f} queued={false} onResolve={() => undefined} />
        ))}
        <TouchableOpacity onPress={() => query.refetch()} style={styles.refresh} activeOpacity={0.7}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </ScrollView>
      {acting && projectId && (
        <ResolveSheet
          projectId={projectId}
          finding={acting}
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

function FindingCard({ finding: f, queued, onResolve }: { finding: InspectionFindingDto; queued: boolean; onResolve: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.reference}>
          {f.inspectionVisitType ? INSPECTION_VISIT_TYPE_LABELS[f.inspectionVisitType] : "Visit"} · {f.inspectionVisitDate}
        </Text>
        <Pill variant={f.status === "OPEN" ? SEVERITY_VARIANT[f.severity] : "positive"} text={f.status === "OPEN" ? f.severity : f.status} />
      </View>
      <Text style={styles.cardTitle}>{f.checklistItemLabel}</Text>
      <Text style={styles.cardText}>{f.description}</Text>
      {f.contractorName ? <Text style={styles.cardMeta}>{f.contractorName}</Text> : null}
      {f.resolvedNotes ? <Text style={styles.cardText}>Resolution: {f.resolvedNotes}</Text> : null}
      {queued ? (
        <Text style={styles.queued}>Update saved. It sends when you are online.</Text>
      ) : (
        f.canResolve && (
          <TouchableOpacity style={styles.primaryButton} onPress={onResolve} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>Mark as resolved</Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

function ResolveSheet({ projectId, finding, onClose, onQueued }: { projectId: string; finding: InspectionFindingDto; onClose: () => void; onQueued: () => void }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [captureIds, setCaptureIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPhotos = async (batch: SiteEvidenceBatchSubmission) => {
    setCameraOpen(false);
    try {
      const ids: string[] = [];
      for (const photo of batch.photos) {
        const capture = await saveCapture({
          projectId,
          wbsItemId: null,
          mediaType: "SITE_PHOTO",
          sourceUri: photo.uri,
          mimeType: "image/jpeg",
          fileExtension: "jpg",
          caption: batch.caption || `Fix: ${finding.checklistItemLabel}`,
          fix: photo.gps ?? null,
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
      await queueFindingResolution(projectId, { findingId: finding.id, notes, captureIds });
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
        <Text style={styles.sheetTitle}>Mark as resolved</Text>
        <Text style={styles.cardMeta}>
          {finding.checklistItemLabel} · {finding.description}
        </Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setCameraOpen(true)} activeOpacity={0.8}>
          <Text style={styles.secondaryButtonText}>{captureIds.length > 0 ? `Photos taken: ${captureIds.length}. Add more` : "Take photos of the fix"}</Text>
        </TouchableOpacity>
        <TextInput style={styles.input} multiline value={notes} onChangeText={setNotes} maxLength={2000} placeholder="What was done" />
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
      <SiteEvidenceCameraModal visible={cameraOpen} wbsCode={finding.checklistItemLabel} onSubmit={onPhotos} onClose={() => setCameraOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  closeText: { fontSize: 13, color: "#FDE68A", fontWeight: "700", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: "#E0E7FF", marginTop: 4 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: "#64748B", textTransform: "uppercase", marginTop: 12, marginBottom: 6 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  reference: { fontSize: 11, fontWeight: "800", color: "#64748B", flexShrink: 1 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#0F172A" },
  cardText: { fontSize: 12, color: "#475569", marginTop: 4 },
  cardMeta: { fontSize: 11, color: "#64748B", marginTop: 6 },
  queued: { fontSize: 12, color: "#0369A1", fontWeight: "600", marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  primaryButton: { backgroundColor: "#6546FC", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 10, alignSelf: "flex-start" },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  secondaryButton: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 10 },
  secondaryButtonText: { color: "#0F172A", fontWeight: "600", fontSize: 13 },
  refresh: { alignSelf: "center", padding: 12 },
  refreshText: { color: "#6546FC", fontWeight: "700", fontSize: 13 },
  sheetBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  input: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, padding: 12, minHeight: 80, marginTop: 12, textAlignVertical: "top", fontSize: 13 },
  error: { color: "#B91C1C", fontSize: 12, marginTop: 8 },
});
