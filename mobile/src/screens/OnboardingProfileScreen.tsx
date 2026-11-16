import React, { useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useProfile } from "../context/ProfileContext";
import { GradientHeaderLayout } from "../components/common/GradientHeaderLayout";
import KpmgLogo from "../../assets/KPMG-logo.svg";
import { PrimaryButton } from "../components/inputs/Buttons";
import { cardShadow, defaultColors } from "../styles/commonStyles";
import { getInitials } from "../utils/userUtils";
import Avatar from "../components/common/Avatar";
import type { RootStackParamList } from "../navigation/types";

export const OnboardingProfileScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { updateProfile } = useProfile();
  // Input fields start blank as requested
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Derive initials dynamically from user entry
  const avatarInitials = useMemo(
    () => getInitials(fullName, "ID"),
    [fullName],
  );

  // Validation
  const canSubmit = useMemo(() => {
    return fullName.trim().length > 0 && phoneNumber.trim().length > 0;
  }, [fullName, phoneNumber]);

  const handleSave = async () => {
    if (!canSubmit) {
      Toast.show({
        type: "error",
        props: {
          title: "Required Fields",
          message:
            "Please provide your full name and mobile phone number to activate your field profile.",
        },
      });
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        roleTitle: roleTitle.trim() || "Field Site Personnel",
        onboardingCompleted: true,
      });
      navigation.reset({
        index: 0,
        routes: [{ name: "EnterCode" }],
      });
    } catch (e) {
      Toast.show({
        type: "error",
        props: {
          title: "Storage Error",
          message: "Failed to save local profile to secure device storage.",
        },
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <GradientHeaderLayout
      title="Field Profile Setup"
      subtitle="Register your details for on-site assurance."
      rightAction={<KpmgLogo height={64} width={64} color="#fff" />}
      contentContainerStyle={styles.body}
    >
      <View style={{ gap: 16 }}>
        {/* Avatar Card */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <Avatar forceInitials={avatarInitials} editable />
            <View style={styles.avatarTextContainer}>
              <Text style={styles.cardLabel}>Identity Badge</Text>
              <Text style={styles.helperText}>
                Your Field Profile is attached to site evidence logs.
              </Text>
            </View>
          </View>
        </View>

        {/* Profile Form */}
        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>
              Full Name <Text style={{ color: "red" }}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="e.g. Engr. Chukwuma Okeke"
              placeholderTextColor="#94A3B8"
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>
              Mobile Phone Number <Text style={{ color: "red" }}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              placeholder="e.g. +234 803 555 0192"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Role / Site Title (Optional)</Text>
            <TextInput
              style={styles.input}
              value={roleTitle}
              onChangeText={setRoleTitle}
              placeholder="e.g. Senior Site Civil Engineer"
              placeholderTextColor="#94A3B8"
              autoCapitalize="words"
            />
          </View>
        </View>
      </View>

      {/* Continue */}
      <View style={styles.actionWrap}>
        <PrimaryButton
          onPress={handleSave}
          text="Save Profile & Continue"
          isWorking={isSaving}
          disabled={isSaving || !canSubmit}
          accessibilityLabel="Save Profile & Continue"
        />
      </View>
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingBottom: 24,
    justifyContent: "space-between",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: defaultColors.border,
    ...cardShadow,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  avatarTextContainer: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  helperText: {
    fontSize: 12,
    color: defaultColors.secondaryText,
    marginTop: 3,
    lineHeight: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: defaultColors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: defaultColors.primaryText,
    fontWeight: "600",
  },
  actionWrap: {
    marginTop: 8,
  },
});
