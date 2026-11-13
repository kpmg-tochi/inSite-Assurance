import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";

interface Props {
  onVerificationSubmitted: () => void;
  onCancel: () => void;
}

type WizardStep = "STEP_1_ID" | "STEP_2_SELFIE" | "STEP_3_CREDENTIALS";

export const AssuranceVerificationWizard: React.FC<Props> = ({
  onVerificationSubmitted,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>("STEP_1_ID");

  // Step 1: ID
  const [idType, setIdType] = useState("NIN Slip / Card");
  const [idCaptured, setIdCaptured] = useState(false);

  // Step 2: Selfie Liveness
  const [livenessStage, setLivenessStage] = useState<
    "CENTER" | "LEFT" | "RIGHT" | "DONE"
  >("CENTER");

  // Step 3: Credentials (Text Only - No certificate upload)
  const [regulatoryBody, setRegulatoryBody] = useState("COREN");
  const [licenseNumber, setLicenseNumber] = useState("COREN R.49201");
  const [experienceSummary, setExperienceSummary] = useState(
    "8 years supervising reinforced concrete structures and culvert highway construction.",
  );

  const handleCaptureId = () => {
    setIdCaptured(true);
    Alert.alert(
      "ID Captured",
      "Clarity score: 98% (High definition). ID document attached.",
    );
  };

  const handleAdvanceFromId = () => {
    if (!idCaptured) {
      Alert.alert(
        "Capture Required",
        "Please snap a photo of your valid ID document inside the frame.",
      );
      return;
    }
    setCurrentStep("STEP_2_SELFIE");
  };

  const handleLivenessAction = () => {
    if (livenessStage === "CENTER") {
      setLivenessStage("LEFT");
    } else if (livenessStage === "LEFT") {
      setLivenessStage("RIGHT");
    } else if (livenessStage === "RIGHT") {
      setLivenessStage("DONE");
      Alert.alert(
        "Liveness Passed",
        "Facial geometry matched with ID photo (Confidence: 98.5%).",
      );
    } else {
      setCurrentStep("STEP_3_CREDENTIALS");
    }
  };

  const handleFinalSubmit = () => {
    if (!licenseNumber.trim()) {
      Alert.alert(
        "Required",
        "Please enter your professional license/registration number.",
      );
      return;
    }
    onVerificationSubmitted();
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>
              {currentStep === "STEP_1_ID"
                ? "Step 1 of 3 · ID Photo"
                : currentStep === "STEP_2_SELFIE"
                  ? "Step 2 of 3 · Live Selfie"
                  : "Step 3 of 3 · Qualifications"}
            </Text>
          </View>
        </View>
        <Text style={styles.screenTitle}>
          Contractor Assurance Verification
        </Text>
        <Text style={styles.screenSubtitle}>
          {currentStep === "STEP_1_ID"
            ? "Align your government ID inside the template brackets."
            : currentStep === "STEP_2_SELFIE"
              ? "Hold your face inside the oval and turn gently to confirm liveness."
              : "Provide your professional accreditation credentials."}
        </Text>
      </View>

      {/* STEP 1: ID DOCUMENT */}
      {currentStep === "STEP_1_ID" && (
        <ScrollView contentContainerStyle={styles.body}>
          {/* ID Type Selector */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Select Valid ID Type *</Text>
            <View style={styles.pillsRow}>
              {[
                "NIN Slip / Card",
                "Driver's License",
                "Voter PVC",
                "Passport",
              ].map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.pill, idType === type && styles.pillActive]}
                  onPress={() => setIdType(type)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      idType === type && styles.pillTextActive,
                    ]}
                  >
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ID Camera Viewfinder Simulation */}
          <View style={styles.viewfinderCard}>
            <View style={styles.viewfinderFrame}>
              {/* Corner Brackets */}
              <View style={[styles.cornerBracket, styles.bracketTL]} />
              <View style={[styles.cornerBracket, styles.bracketTR]} />
              <View style={[styles.cornerBracket, styles.bracketBL]} />
              <View style={[styles.cornerBracket, styles.bracketBR]} />

              <View style={styles.viewfinderCenter}>
                <Text style={styles.viewfinderText}>
                  {idCaptured
                    ? "ID Photo Captured & Sharpness Verified"
                    : `Align ${idType} inside frame`}
                </Text>
                <Text style={styles.viewfinderSubtext}>
                  {idCaptured
                    ? "100% in-focus · No glare"
                    : "Ensure full card edges are visible"}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.captureButton,
                idCaptured && styles.captureButtonDone,
              ]}
              onPress={handleCaptureId}
              activeOpacity={0.8}
            >
              <Text style={styles.captureButtonText}>
                {idCaptured ? "Retake Photo" : "Capture ID Document"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, !idCaptured && { opacity: 0.5 }]}
            onPress={handleAdvanceFromId}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>
              Continue to Live Selfie (Step 2)
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* STEP 2: LIVE SELFIE WITH OVAL VIEWFINDER */}
      {currentStep === "STEP_2_SELFIE" && (
        <View style={styles.bodyDark}>
          <View style={styles.ovalMaskContainer}>
            <View style={styles.ovalMask}>
              <Text style={styles.livenessPrompt}>
                {livenessStage === "CENTER"
                  ? "Center your face"
                  : livenessStage === "LEFT"
                    ? "Turn head slowly LEFT"
                    : livenessStage === "RIGHT"
                      ? "Turn head slowly RIGHT"
                      : "Liveness Confirmed!"}
              </Text>
              <View style={styles.livenessCheckmark}>
                <Text style={styles.livenessCheckmarkText}>
                  {livenessStage === "DONE" ? "✓" : "..."}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.livenessInstructionBox}>
            <Text style={styles.livenessTitle}>
              {livenessStage === "DONE"
                ? "Biometric Check Completed"
                : "Active Liveness Verification"}
            </Text>
            <Text style={styles.livenessBody}>
              {livenessStage === "CENTER"
                ? "Position your face in the oval. Tap below to begin head turn motion."
                : livenessStage === "LEFT"
                  ? "Turn your face slightly to the left to detect depth."
                  : livenessStage === "RIGHT"
                    ? "Turn your face slightly to the right."
                    : "Facial signature bound to device key. Tap to continue."}
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleLivenessAction}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>
                {livenessStage === "CENTER"
                  ? "Start Liveness Check"
                  : livenessStage === "LEFT"
                    ? "Confirm Left Turn"
                    : livenessStage === "RIGHT"
                      ? "Confirm Right Turn"
                      : "Continue to Step 3"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* STEP 3: CREDENTIALS (NO CERTIFICATE UPLOAD) */}
      {currentStep === "STEP_3_CREDENTIALS" && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Regulatory Body *</Text>
            <View style={styles.pillsRow}>
              {["COREN", "QSRBN", "CORBON", "ARCON", "OTHER"].map((body) => (
                <TouchableOpacity
                  key={body}
                  style={[
                    styles.pill,
                    regulatoryBody === body && styles.pillActive,
                  ]}
                  onPress={() => setRegulatoryBody(body)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      regulatoryBody === body && styles.pillTextActive,
                    ]}
                  >
                    {body}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 14 }}>
              <Text style={styles.fieldLabel}>
                Registration / License Number *
              </Text>
              <TextInput
                style={styles.input}
                value={licenseNumber}
                onChangeText={setLicenseNumber}
                placeholder="e.g. COREN R.49201"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={{ marginTop: 14 }}>
              <Text style={styles.fieldLabel}>
                Field Experience &amp; Competence Summary *
              </Text>
              <TextInput
                style={[styles.input, { height: 90, textAlignVertical: "top" }]}
                value={experienceSummary}
                onChangeText={setExperienceSummary}
                placeholder="Brief summary of relevant engineering projects supervised..."
                placeholderTextColor="#94A3B8"
                multiline
              />
            </View>
          </View>

          {/* Frictionless Notice */}
          <View style={styles.frictionlessBox}>
            <Text style={styles.frictionlessTitle}>
              Frictionless Verification
            </Text>
            <Text style={styles.frictionlessText}>
              No certificate file upload is required. The Independent Project
              Monitor will verify your {regulatoryBody} registration number
              directly against official public registries.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleFinalSubmit}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>
              Submit Verification Package
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    backgroundColor: "#0C233C",
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cancelText: {
    fontSize: 13,
    color: "#93C5FD",
    fontWeight: "600",
  },
  stepBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  stepBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#93C5FD",
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: "#BFDBFE",
    marginTop: 4,
    lineHeight: 18,
  },
  body: {
    padding: 16,
    gap: 14,
  },
  bodyDark: {
    flex: 1,
    backgroundColor: "#0F172A",
    justifyContent: "space-between",
    padding: 20,
    paddingBottom: 30,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    marginBottom: 8,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  pillActive: {
    backgroundColor: "#00338D",
    borderColor: "#00338D",
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
  },
  pillTextActive: {
    color: "#FFFFFF",
  },
  viewfinderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 12,
  },
  viewfinderFrame: {
    height: 190,
    backgroundColor: "#0F172A",
    borderRadius: 14,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#38BDF8",
    borderStyle: "dashed",
  },
  cornerBracket: {
    position: "absolute",
    width: 24,
    height: 24,
    borderColor: "#10B981",
  },
  bracketTL: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 8,
  },
  bracketTR: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 8,
  },
  bracketBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  bracketBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },
  viewfinderCenter: {
    alignItems: "center",
    paddingHorizontal: 20,
  },
  viewfinderText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  viewfinderSubtext: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 4,
    textAlign: "center",
  },
  captureButton: {
    backgroundColor: "#0C233C",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  captureButtonDone: {
    backgroundColor: "#059669",
  },
  captureButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  ovalMaskContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 20,
  },
  ovalMask: {
    width: 200,
    height: 270,
    borderRadius: 100,
    borderWidth: 4,
    borderColor: "#10B981",
    backgroundColor: "#1E293B",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  livenessPrompt: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  livenessCheckmark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  livenessCheckmarkText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  livenessInstructionBox: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#334155",
    gap: 12,
  },
  livenessTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  livenessBody: {
    fontSize: 11,
    color: "#94A3B8",
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
    fontWeight: "600",
  },
  frictionlessBox: {
    backgroundColor: "#EFF6FF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  frictionlessTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#00338D",
    marginBottom: 3,
  },
  frictionlessText: {
    fontSize: 11,
    color: "#1E3A8A",
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: "#00338D",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
