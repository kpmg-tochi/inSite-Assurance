import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  calendarDateInTimeZone,
  INSPECTION_OVERALL_FINDING_LABELS,
  INSPECTION_VISIT_TYPE_LABELS,
  isFailedAnswer,
  type ChecklistItem,
  type InspectionOverallFinding,
  type InspectionVisitType,
} from "@insite/shared";
import { EmptyStateCard, InfoCallout } from "../components/common";
import { SiteEvidenceCameraModal, type SiteEvidenceBatchSubmission } from "../components/camera";
import { useProfile } from "../context/ProfileContext";
import { getLoadedBaselinePack } from "../storage/baselineStore";
import { projectTimeZone } from "../storage/reportStore";
import { saveCapture } from "../storage/captureStore";
import { newId, nowIso } from "../storage/db/database";
import {
  discardInspectionDraft,
  loadOpenInspectionDraft,
  queueInspection,
  saveInspectionDraft,
} from "../storage/inspectionStore";
import { acquireFix } from "../services/locationService";
import {
  buildInspectionRequest,
  confirmIssues,
  emptyAnswer,
  failedItems,
  newDraft,
  sectionIssues,
  templateForVisit,
  visitTypesOffered,
  type InspectionDraft,
} from "../utils/inspections";
import { personaCopy } from "../utils/personaCopy";
import { formatMobileErrorMessage } from "../utils/errorFormatter";
import type { RootStackParamList } from "../navigation/types";

/**
 * Site inspection (Phase 14): choose the visit type, then one screen per checklist section with
 * photos per item through the live camera, then the overall finding and a summary, then confirm.
 * The draft is saved on every change (it survives an app restart). Confirming queues one
 * SITE_INSPECTION outbox row behind the photos; nothing is sent before that.
 */

const FINDINGS: InspectionOverallFinding[] = ["SATISFACTORY", "MINOR_ISSUES", "MAJOR_ISSUES"];

export default function InspectionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { activeProjectId: projectId, activeContext } = useProfile();
  const copy = personaCopy(activeContext?.fieldPersonaType);
  const pack = getLoadedBaselinePack(projectId)?.inspections;
  const [draft, setDraft] = useState<InspectionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraFor, setCameraFor] = useState<ChecklistItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    loadOpenInspectionDraft(projectId)
      .then((d) => setDraft(d))
      .catch((err) => setError(formatMobileErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  const template = useMemo(() => {
    if (!draft || !pack) return null;
    return pack.templates.find((t) => t.id === draft.templateId) ?? null;
  }, [draft, pack]);
  const sections = template?.sections ?? [];

  const update = (next: InspectionDraft) => {
    const stamped = { ...next, updatedAt: nowIso() };
    setDraft(stamped);
    saveInspectionDraft(stamped).catch((err) => setError(formatMobileErrorMessage(err)));
  };

  const setAnswer = (key: string, patch: Partial<InspectionDraft["answers"][string]>) => {
    if (!draft) return;
    update({ ...draft, answers: { ...draft.answers, [key]: { ...(draft.answers[key] ?? emptyAnswer()), ...patch } } });
  };

  const start = (visitType: InspectionVisitType) => {
    const t = templateForVisit(pack, visitType);
    if (!t || !projectId) return;
    const tz = projectTimeZone(projectId);
    update(newDraft({ id: newId(), projectId, visitType, template: t, visitDate: calendarDateInTimeZone(new Date(), tz), now: nowIso() }));
  };

  const onPhotos = async (batch: SiteEvidenceBatchSubmission) => {
    const item = cameraFor;
    setCameraFor(null);
    if (!item || !draft || !projectId) return;
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
          caption: batch.caption || item.label,
          // The fix taken at this photo's shutter; none means "location unavailable", never a default.
          fix: photo.gps ?? null,
          capturedAt: photo.capturedAt,
        });
        ids.push(capture.id);
      }
      const current = draft.answers[item.key] ?? emptyAnswer();
      setAnswer(item.key, { captureIds: [...current.captureIds, ...ids] });
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    }
  };

  const confirm = async () => {
    if (!draft || !template) return;
    setBusy(true);
    setError(null);
    try {
      const fix = await acquireFix();
      const confirmedAt = nowIso();
      const request = buildInspectionRequest(draft, sections, {
        geotag: fix
          ? { latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: fix.accuracyMeters, altitudeMeters: fix.altitudeMeters, isMocked: fix.isMocked, capturedAt: fix.capturedAt }
          : null,
        confirmedAt,
      });
      await queueInspection(draft, request);
      setDone(true);
    } catch (err) {
      setError(formatMobileErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!draft) return;
    await discardInspectionDraft(draft.id).catch(() => undefined);
    setDraft(null);
  };

  const header = (
    <LinearGradient colors={["#6546FC", "#1E3A8A", "#1E1B4B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
        <Text style={styles.closeText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{draft ? INSPECTION_VISIT_TYPE_LABELS[draft.visitType] : copy.inspectionEntry}</Text>
      <Text style={styles.subtitle}>
        {draft && template
          ? `${template.name} v${template.version} · ${draft.visitDate}${draft.step < sections.length ? ` · section ${draft.step + 1} of ${sections.length}` : " · summary"}`
          : "Saved on this phone as you go. It sends when you confirm and are online."}
      </Text>
    </LinearGradient>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <ActivityIndicator style={{ marginTop: 32 }} />
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <View style={styles.body}>
          <InfoCallout variant="info" title="Inspection saved" description="It sends with its photos when you are online. Failed items reach the contractor as findings." />
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Visit type picker.
  if (!draft) {
    const offered = visitTypesOffered(pack);
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <ScrollView contentContainerStyle={styles.body}>
          {offered.length === 0 ? (
            <EmptyStateCard title="No checklists on this phone" description="Open the project while online to download its inspection checklists." />
          ) : (
            <>
              <Text style={styles.sectionLabel}>Choose the visit type</Text>
              {offered.map((v) => (
                <TouchableOpacity key={v} style={styles.card} onPress={() => start(v)} activeOpacity={0.8}>
                  <Text style={styles.cardTitle}>{INSPECTION_VISIT_TYPE_LABELS[v]}</Text>
                  <Text style={styles.cardMeta}>{templateForVisit(pack, v)?.name}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </View>
    );
  }

  if (!template) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {header}
        <View style={styles.body}>
          <InfoCallout variant="warning" title="Checklist not on this phone" description="The checklist this draft uses is no longer in the project data. Discard the draft and start again." />
          <TouchableOpacity style={styles.secondaryButton} onPress={discard} activeOpacity={0.8}>
            <Text style={styles.secondaryButtonText}>Discard draft</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const onSummary = draft.step >= sections.length;
  const section = sections[draft.step];
  const issues = onSummary ? [] : sectionIssues(draft, sections, draft.step);
  const issueFor = (key: string) => issues.filter((i) => i.itemKey === key).map((i) => i.message);
  const remaining = onSummary ? confirmIssues(draft, sections) : [];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {header}
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {!onSummary && section && (
          <>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => {
              const a = draft.answers[item.key] ?? emptyAnswer();
              const failed = isFailedAnswer(item, a.value);
              return (
                <View key={item.key} style={styles.card}>
                  <Text style={styles.cardTitle}>
                    {item.label}
                    {item.required ? "" : " (optional)"}
                  </Text>
                  {item.guidance ? <Text style={styles.cardMeta}>{item.guidance}</Text> : null}
                  <AnswerInput item={item} value={a.value} onChange={(value) => setAnswer(item.key, { value })} />
                  {(failed || item.responseType === "TEXT" || a.comment.length > 0) && item.responseType !== "TEXT" ? (
                    <TextInput
                      style={styles.input}
                      multiline
                      value={a.comment}
                      onChangeText={(comment) => setAnswer(item.key, { comment })}
                      maxLength={2000}
                      placeholder={failed ? "What is wrong (needed)" : "Comment"}
                    />
                  ) : null}
                  {!failed && item.responseType !== "TEXT" && a.comment.length === 0 && (
                    <TouchableOpacity onPress={() => setAnswer(item.key, { comment: " " })} activeOpacity={0.7}>
                      <Text style={styles.link}>Add a comment</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setCameraFor(item)} activeOpacity={0.8}>
                    <Text style={styles.secondaryButtonText}>
                      {a.captureIds.length > 0 ? `Photos: ${a.captureIds.length}. Add more` : item.photoRequired || item.responseType === "PHOTO_ONLY" ? "Take photo (needed)" : "Take photo"}
                    </Text>
                  </TouchableOpacity>
                  {issueFor(item.key).map((m) => (
                    <Text key={m} style={styles.error}>
                      {m}
                    </Text>
                  ))}
                </View>
              );
            })}
          </>
        )}

        {onSummary && (
          <>
            <Text style={styles.sectionTitle}>Overall finding</Text>
            <View style={styles.row}>
              {FINDINGS.map((f) => (
                <TouchableOpacity key={f} style={[styles.toggle, draft.overallFinding === f && styles.toggleOn]} onPress={() => update({ ...draft, overallFinding: f })} activeOpacity={0.8}>
                  <Text style={[styles.toggleText, draft.overallFinding === f && styles.toggleTextOn]}>{INSPECTION_OVERALL_FINDING_LABELS[f]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.sectionLabel}>Summary</Text>
            <TextInput
              style={[styles.input, { minHeight: 120 }]}
              multiline
              value={draft.summaryText}
              onChangeText={(summaryText) => update({ ...draft, summaryText })}
              maxLength={8000}
              placeholder="What you saw on this visit"
            />
            {failedItems(draft, sections).length > 0 && (
              <InfoCallout
                variant="warning"
                title="Failed items"
                description={`These become findings for the contractor: ${failedItems(draft, sections).join(", ")}.`}
              />
            )}
            {remaining.map((m) => (
              <Text key={m} style={styles.error}>
                {m}
              </Text>
            ))}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.row}>
          {draft.step > 0 && (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => update({ ...draft, step: draft.step - 1 })} activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>Back</Text>
            </TouchableOpacity>
          )}
          {!onSummary ? (
            <TouchableOpacity
              style={[styles.primaryButton, issues.length > 0 && styles.disabled]}
              disabled={issues.length > 0}
              onPress={() => update({ ...draft, step: draft.step + 1 })}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>{draft.step + 1 === sections.length ? "Summary" : "Next section"}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.primaryButton, (remaining.length > 0 || busy) && styles.disabled]} disabled={remaining.length > 0 || busy} onPress={confirm} activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>{busy ? "Saving…" : "Confirm inspection"}</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={discard} activeOpacity={0.7} style={{ marginTop: 16 }}>
          <Text style={styles.link}>Discard this draft</Text>
        </TouchableOpacity>
      </ScrollView>
      <SiteEvidenceCameraModal visible={Boolean(cameraFor)} wbsCode={cameraFor?.label ?? ""} onSubmit={onPhotos} onClose={() => setCameraFor(null)} />
    </View>
  );
}

function AnswerInput({ item, value, onChange }: { item: ChecklistItem; value: string | number | null; onChange: (v: string | number | null) => void }) {
  const choice = (options: Array<{ v: string | number; label: string }>) => (
    <View style={styles.row}>
      {options.map((o) => (
        <TouchableOpacity key={String(o.v)} style={[styles.toggle, value === o.v && styles.toggleOn]} onPress={() => onChange(value === o.v ? null : o.v)} activeOpacity={0.8}>
          <Text style={[styles.toggleText, value === o.v && styles.toggleTextOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
  switch (item.responseType) {
    case "RATING_1_5":
      return choice([1, 2, 3, 4, 5].map((n) => ({ v: n, label: String(n) })));
    case "PASS_FAIL_NA":
      return choice([
        { v: "PASS", label: "Pass" },
        { v: "FAIL", label: "Fail" },
        { v: "NA", label: "N/A" },
      ]);
    case "YES_NO":
      return choice([
        { v: "YES", label: "Yes" },
        { v: "NO", label: "No" },
      ]);
    case "NUMBER":
      return (
        <TextInput
          style={styles.inputSingle}
          keyboardType="decimal-pad"
          value={value === null ? "" : String(value)}
          onChangeText={(t) => {
            const n = Number(t.replace(",", "."));
            onChange(t.trim() === "" ? null : Number.isFinite(n) ? n : t);
          }}
          placeholder={item.unit ? `Value (${item.unit})` : "Value"}
        />
      );
    case "TEXT":
      return <TextInput style={styles.input} multiline value={typeof value === "string" ? value : ""} onChangeText={(t) => onChange(t)} maxLength={4000} placeholder="Answer" />;
    default:
      return <Text style={styles.cardMeta}>Photos only.</Text>;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  closeText: { fontSize: 13, color: "#C7D2FE", fontWeight: "700", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: "#E0E7FF", marginTop: 4 },
  body: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A", marginBottom: 10 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: "#64748B", textTransform: "uppercase", marginTop: 12, marginBottom: 6 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", padding: 14, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#0F172A" },
  cardMeta: { fontSize: 12, color: "#64748B", marginTop: 4 },
  row: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  toggle: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minWidth: 44, alignItems: "center" },
  toggleOn: { backgroundColor: "#6546FC", borderColor: "#6546FC" },
  toggleText: { fontSize: 13, fontWeight: "600", color: "#0F172A" },
  toggleTextOn: { color: "#FFFFFF" },
  input: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, padding: 12, minHeight: 64, marginTop: 10, textAlignVertical: "top", fontSize: 13, backgroundColor: "#FFFFFF" },
  inputSingle: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, padding: 10, marginTop: 10, fontSize: 14, backgroundColor: "#FFFFFF" },
  primaryButton: { backgroundColor: "#6546FC", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginTop: 10 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  secondaryButton: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 10, alignSelf: "flex-start" },
  secondaryButtonText: { color: "#0F172A", fontWeight: "600", fontSize: 13 },
  disabled: { opacity: 0.5 },
  link: { color: "#6546FC", fontWeight: "700", fontSize: 13, marginTop: 8 },
  error: { color: "#B91C1C", fontSize: 12, marginTop: 6 },
});
