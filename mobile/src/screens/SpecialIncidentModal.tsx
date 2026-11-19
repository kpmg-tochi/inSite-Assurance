import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Linking,
} from "react-native";
import Toast from "react-native-toast-message";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { InSiteCamera, type CameraCaptureResult } from "../components/camera";
import { useProfile } from "../context/ProfileContext";
import { useSubmitIncidentMutation } from "../queries/incidents/useIncidentMutations";
import type { RootStackParamList } from "../navigation/types";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { defaultColors } from "../styles/commonStyles";

export const SpecialIncidentModal: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeProjectId: projectId } = useProfile();
  const onClose = () => navigation.goBack();
  const onSubmitted = () => navigation.goBack();
  const [category, setCategory] = useState<
    "WHISTLEBLOWING" | "SITE_EMERGENCY" | "CRITICAL_DELAY" | "MATERIAL_FAILURE"
  >("WHISTLEBLOWING");
  const [severity, setSeverity] = useState<"CRITICAL" | "HIGH" | "MEDIUM">(
    "HIGH",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isConfidential, setIsConfidential] = useState(true);
  const [capturedPhoto, setCapturedPhoto] =
    useState<CameraCaptureResult | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const submitIncidentMutation = useSubmitIncidentMutation();
  const isSubmitting = submitIncidentMutation.isPending;

  const handleSubmit = async () => {
    if (!description.trim()) {
      Toast.show({
        type: "error",
        props: {
          title: "Required",
          message: "Please describe the incident or escalation reason.",
        },
      });
      return;
    }

    try {
      await submitIncidentMutation.mutateAsync({
        projectId,
        localPhotoUris: capturedPhoto ? [capturedPhoto.uri] : [],
        payload: {
          category,
          severity,
          title: title.trim() || `${category.replace("_", " ")} Report`,
          description: description.trim(),
          isConfidentialWhistleblower: isConfidential,
          // Only a real fix from the photo; no fix means no coordinates.
          ...(capturedPhoto?.gps
            ? {
                deviceGpsCoordinates: {
                  latitude: capturedPhoto.gps.latitude,
                  longitude: capturedPhoto.gps.longitude,
                  accuracyMeters: capturedPhoto.gps.accuracyMeters ?? undefined,
                },
              }
            : {}),
        },
      });

      Toast.show({
        type: "success",
        props: {
          title: "Incident saved",
          message: isConfidential
            ? "Saved on this device as a protected disclosure. It will be sent to the Monitor and Lender as soon as there is a connection."
            : "Saved on this device. It will be sent as soon as there is a connection.",
        },
      });
      onSubmitted();
    } catch (e: any) {
      Toast.show({
        type: "error",
        props: {
          title: "Submission Error",
          message: e.message || "Failed to submit incident report.",
        },
      });
    }
  };

  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={["#881337", "#9F1239", "#1E1B4B"]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.9 }}
        style={[
          styles.headerGradient,
          { paddingTop: Math.max(insets.top + 8, 20) },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.iconTag}>
            <Text style={styles.iconTagText}>!</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.title}>Special Incident &amp; Escalation</Text>
            <Text style={styles.subtitle}>
              Direct Alert to Monitor &amp; Lender
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.7}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <View
        style={[
          styles.curvedContainer,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* Emergency Services Disclaimer & Direct Dial Links */}
          <View style={styles.emergencyDisclaimerCard}>
            <Text style={styles.emergencyDisclaimerTitle}>
              Emergency Services Disclaimer
            </Text>
            <Text style={styles.emergencyDisclaimerBody}>
              To report a life-threatening medical emergency, active fire, or
              immediate criminal activity, call the relevant emergency services
              first before submitting an incident report here. Tap a number
              below to open your phone dialpad:
            </Text>
            <View style={styles.dialLinksRow}>
              {[
                {
                  number: "112",
                  label: "112 · National (Police / Fire / Medical)",
                },
                { number: "767", label: "767 · Lagos Emergency (LASEMA)" },
                { number: "122", label: "122 · FRSC Road Rescue" },
              ].map((item) => (
                <TouchableOpacity
                  key={item.number}
                  style={styles.dialLinkChip}
                  onPress={() => {
                    Linking.openURL(`tel:${item.number}`).catch(() => {
                      Toast.show({
                        type: "warning",
                        props: {
                          title: "Dialer Unavailable",
                          message: `Please dial ${item.number} manually.`,
                        },
                      });
                    });
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="link"
                  accessibilityLabel={`Call ${item.label}`}
                >
                  <Text style={styles.dialLinkText}>📞 {item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Category Picker */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Select Escalation Category *</Text>
            <View style={styles.categoryGrid}>
              {[
                { key: "WHISTLEBLOWING", label: "Whistleblowing / Fraud" },
                { key: "SITE_EMERGENCY", label: "Site Safety Emergency" },
                { key: "CRITICAL_DELAY", label: "Critical Delay Blocker" },
                { key: "MATERIAL_FAILURE", label: "Material Quality Failure" },
              ].map((cat) => (
                <TouchableOpacity
                  key={cat.key}
                  style={[
                    styles.categoryBtn,
                    category === cat.key && styles.categoryBtnActive,
                  ]}
                  onPress={() => setCategory(cat.key as any)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.categoryBtnText,
                      category === cat.key && styles.categoryBtnTextActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Confidential Whistleblower Shield Card */}
          <TouchableOpacity
            style={styles.shieldCard}
            onPress={() => setIsConfidential(!isConfidential)}
            activeOpacity={0.8}
          >
            <View style={styles.shieldTop}>
              <Text style={styles.shieldTitle}>
                Confidential Shield: {isConfidential ? "ENABLED" : "DISABLED"}
              </Text>
              <View style={[styles.switch, isConfidential && styles.switchOn]}>
                <View
                  style={[
                    styles.switchKnob,
                    isConfidential && styles.switchKnobOn,
                  ]}
                />
              </View>
            </View>
            <Text style={styles.shieldBody}>
              When enabled, this submission is strictly hidden from the
              contractor portal and routed directly to the Independent Project
              Monitor and Lender Credit Risk Officer under statutory
              whistleblower protection.
            </Text>
          </TouchableOpacity>

          {/* Incident Details */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Incident Headline (Optional)</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Sub-standard steel rebar batch delivered on site"
              placeholderTextColor="#94A3B8"
            />

            <View style={{ marginTop: 12 }}>
              <Text style={styles.fieldLabel}>
                Incident Description &amp; Evidence Summary
                <Text style={{ color: "red" }}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { height: 100, textAlignVertical: "top", marginTop: 8 },
                ]}
                value={description}
                onChangeText={setDescription}
                placeholder="Provide exact location, chainage, contractor personnel involved, and observed defect or safety risk..."
                placeholderTextColor="#94A3B8"
                multiline
              />
            </View>
          </View>

          {/* Optional Photo Attachment */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Photo Evidence Attachment</Text>
            <TouchableOpacity
              style={[
                styles.photoButton,
                capturedPhoto && styles.photoButtonAttached,
              ]}
              onPress={() => setShowCameraModal(true)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name={"camera"}
                size={16}
                color={defaultColors.primary}
              />

              <Text style={styles.photoButtonText}>
                {capturedPhoto
                  ? `Live Photo Attached (${capturedPhoto.width}x${capturedPhoto.height})`
                  : "Snap Supporting Photo"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.8}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting
                ? "Transmitting Escalation..."
                : "Transmit Escalation to Monitor & Lender"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <Modal visible={showCameraModal} animationType="slide">
        <InSiteCamera
          captureType="shutter"
          geoTag={true}
          initialFacing="back"
          title="Incident Evidence Capture"
          subtitle="Live geotagged photo only"
          onCapture={(result) => {
            setCapturedPhoto(result);
            setShowCameraModal(false);
          }}
          onCancel={() => setShowCameraModal(false)}
        />
      </Modal>
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
  closeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconTag: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#E11D48",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#F43F5E",
  },
  iconTagText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  subtitle: {
    fontSize: 11,
    color: "#93C5FD",
  },
  closeText: {
    fontSize: 13,
    color: "#93C5FD",
    fontWeight: "700",
  },
  body: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryBtn: {
    flex: 1,
    minWidth: "46%",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  categoryBtnActive: {
    backgroundColor: "#E11D48",
    borderColor: "#E11D48",
  },
  categoryBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#334155",
  },
  categoryBtnTextActive: {
    color: "#FFFFFF",
  },
  shieldCard: {
    backgroundColor: "#FFF1F2",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#FECDD3",
    gap: 6,
  },
  shieldTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shieldTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#9F1239",
  },
  switch: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#CBD5E1",
    padding: 2,
  },
  switchOn: {
    backgroundColor: "#E11D48",
  },
  switchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
  },
  switchKnobOn: {
    marginLeft: 16,
  },
  shieldBody: {
    fontSize: 11,
    color: "#881337",
    lineHeight: 16,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: "#0F172A",
  },
  photoButton: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    paddingVertical: 14,
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  photoButtonAttached: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderStyle: "solid",
  },
  photoButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#00338D",
  },
  submitButton: {
    backgroundColor: "#E11D48",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  emergencyDisclaimerCard: {
    backgroundColor: "#FFFBEB",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#FDE68A",
    gap: 8,
  },
  emergencyDisclaimerTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#92400E",
  },
  emergencyDisclaimerBody: {
    fontSize: 11,
    color: "#78350F",
    lineHeight: 16,
  },
  dialLinksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  dialLinkChip: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F59E0B",
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dialLinkText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400E",
    textDecorationLine: "underline",
  },
});
