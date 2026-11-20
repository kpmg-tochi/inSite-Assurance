import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Toast from "react-native-toast-message";
import { GradientHeaderLayout, Pill } from "../common";
import { BackButton, PrimaryButton } from "../inputs/Buttons";
import {
  assuranceRegistrationError,
  assuranceRegistrationFields,
  type AssuranceRegistrationSetup,
} from "../../utils/assuranceRegistration";

export interface CredentialsSubmissionPayload {
  /** Phase 12: absent when the project hides registration or an optional number was left empty. */
  registrationNumber?: string;
  registrationBodyCode?: string;
  experienceSummary: string;
}

interface Props {
  onBack: () => void;
  onSubmit: (payload: CredentialsSubmissionPayload) => void;
  /** Phase 12: the project's registration policy and bodies (from the baseline pack). */
  registration: AssuranceRegistrationSetup;
}

export const AssuranceCredentialsStep: React.FC<Props> = ({
  onBack,
  onSubmit,
  registration,
}) => {
  const { rules, bodies } = registration;
  const [bodyCode, setBodyCode] = useState<string | null>(null);
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [experienceSummary, setExperienceSummary] = useState("");
  const selectedBody = bodies.find((b) => b.code === bodyCode);

  const handlePressSubmit = () => {
    const error = assuranceRegistrationError(rules, { number: registrationNumber, bodyCode });
    if (error) {
      Toast.show({ type: "error", props: { title: "Registration", message: error } });
      return;
    }
    if (experienceSummary.trim().length < 5) {
      Toast.show({
        type: "error",
        props: { title: "Required", message: "Add a short summary of your field experience." },
      });
      return;
    }
    onSubmit({
      ...assuranceRegistrationFields(rules, { number: registrationNumber, bodyCode }),
      experienceSummary: experienceSummary.trim(),
    });
  };

  return (
    <GradientHeaderLayout
      title={rules.visible ? "Professional Accreditation" : "Field Experience"}
      subtitle={
        rules.visible
          ? rules.required
            ? "Provide your professional registration and site experience."
            : "Add your professional registration if you hold one, and your site experience."
          : "Tell the reviewer about your site experience."
      }
      leftAction={<BackButton onPress={onBack} text="Back" />}
      rightAction={<Pill variant="darkGlass" text="Step 3 of 3" />}
      contentContainerStyle={styles.body}
    >
      <View style={styles.card}>
        {rules.visible && (
          <>
            <Text style={styles.fieldLabel}>
              Registration body{" "}
              {rules.required ? <Text style={{ color: "red" }}>*</Text> : <Text style={styles.optional}>(optional)</Text>}
            </Text>
            <View style={styles.pillsRow}>
              {bodies.map((body) => (
                <TouchableOpacity
                  key={body.code}
                  style={[styles.pill, bodyCode === body.code && styles.pillActive]}
                  onPress={() => setBodyCode(bodyCode === body.code ? null : body.code)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillText, bodyCode === body.code && styles.pillTextActive]}>{body.code}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {selectedBody && <Text style={styles.helpText}>{selectedBody.fullName}</Text>}

            <View style={{ marginTop: 14 }}>
              <Text style={styles.fieldLabel}>
                {rules.label}{" "}
                {rules.required && <Text style={{ color: "red" }}>*</Text>}
              </Text>
              <TextInput
                style={styles.input}
                value={registrationNumber}
                onChangeText={setRegistrationNumber}
                placeholder={selectedBody?.exampleNumber ? `e.g. ${selectedBody.exampleNumber}` : "Registration number"}
                placeholderTextColor="#94A3B8"
                autoCapitalize="characters"
              />
              {!!rules.helpText && <Text style={styles.helpText}>{rules.helpText}</Text>}
            </View>
          </>
        )}

        <View style={{ marginTop: rules.visible ? 14 : 0 }}>
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
  optional: {
    color: "#94A3B8",
    fontWeight: "600",
  },
  helpText: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 6,
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
