import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Toast from "react-native-toast-message";
import { GradientHeaderLayout, InfoCallout, Pill } from "../common";
import { BackButton, PrimaryButton } from "../inputs/Buttons";

export interface CredentialsSubmissionPayload {
  regulatoryBody: string;
  licenseNumber: string;
  experienceSummary: string;
}

interface Props {
  onBack: () => void;
  onSubmit: (payload: CredentialsSubmissionPayload) => void;
}

const REGULATORY_BODIES = [
  "COREN",
  "QSRBN",
  "CORBON",
  "ARCON",
  "OTHER",
] as const;

export const AssuranceCredentialsStep: React.FC<Props> = ({
  onBack,
  onSubmit,
}) => {
  const [regulatoryBody, setRegulatoryBody] = useState<string>("COREN");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [experienceSummary, setExperienceSummary] = useState("");

  const handlePressSubmit = () => {
    if (!licenseNumber.trim()) {
      Toast.show({
        type: "error",
        props: {
          title: "Required",
          message:
            "Please enter your professional license/registration number.",
        },
      });
      return;
    }

    onSubmit({
      regulatoryBody,
      licenseNumber: licenseNumber.trim(),
      experienceSummary: experienceSummary.trim(),
    });
  };

  return (
    <GradientHeaderLayout
      title="Professional Accreditation"
      subtitle="Provide your regulatory registration number and site engineering experience."
      leftAction={<BackButton onPress={onBack} text="Back" />}
      rightAction={<Pill variant="darkGlass" text="Step 3 of 3" />}
      contentContainerStyle={styles.body}
    >
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>
          Regulatory Body <Text style={{ color: "red" }}>*</Text>
        </Text>
        <View style={styles.pillsRow}>
          {REGULATORY_BODIES.map((body) => (
            <TouchableOpacity
              key={body}
              style={[
                styles.pill,
                regulatoryBody === body && styles.pillActive,
              ]}
              onPress={() => setRegulatoryBody(body)}
              activeOpacity={0.8}
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
            Registration / License Number{" "}
            <Text style={{ color: "red" }}>*</Text>
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
            Field Experience &amp; Competence Summary{" "}
            <Text style={{ color: "red" }}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, { height: 96, textAlignVertical: "top" }]}
            value={experienceSummary}
            onChangeText={setExperienceSummary}
            placeholder="Brief summary of relevant engineering projects supervised..."
            placeholderTextColor="#94A3B8"
            multiline
          />
        </View>
      </View>

      <PrimaryButton
        onPress={handlePressSubmit}
        text="Submit Verification Package"
        style={{ marginTop: "auto" }}
      />
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  body: {
    padding: 16,
    gap: 14,
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
});
