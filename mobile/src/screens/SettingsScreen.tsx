import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Toast from "react-native-toast-message";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import KpmgLogo from "../../assets/KPMG-logo.svg";
import { Pill } from "../components/common";
import Avatar from "../components/common/Avatar";
import { GradientHeaderLayout } from "../components/common/GradientHeaderLayout";
import { BackButton, PrimaryButton } from "../components/inputs/Buttons";
import { useProfile } from "../context/ProfileContext";
import type { RootStackParamList } from "../navigation/types";
import { useResetDemoMutation } from "../queries/projects/useProjectsQueries";
import { clearLocalData } from "../storage/db/database";
import { cardShadow, defaultColors } from "../styles/commonStyles";
import { formatMobileErrorMessage } from "../utils/errorFormatter";
import { getInitials } from "../utils/userUtils";

export const SettingsScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { account, persona, displayName, phoneNumber: knownPhone, savePersona, resetAll } = useProfile();
  // A signed-in account's name and phone come from the organisation; code users edit their own.
  const isAccount = Boolean(account);

  const [fullName, setFullName] = useState(displayName);
  const [phoneNumber, setPhoneNumber] = useState(knownPhone);
  const [isSaving, setIsSaving] = useState(false);

  const resetDemoMutation = useResetDemoMutation();
  const isResettingDemo = resetDemoMutation.isPending;

  const avatarInitials = useMemo(
    () => getInitials(fullName, "ID"),
    [fullName],
  );

  const canSave = useMemo(() => {
    return fullName.trim().length > 0 && phoneNumber.trim().length > 0;
  }, [fullName, phoneNumber]);

  const handleSaveProfile = async () => {
    if (!canSave) {
      Toast.show({
        type: "error",
        props: {
          title: "Required Fields",
          message: "Please enter both your full name and mobile phone number.",
        },
      });
      return;
    }

    setIsSaving(true);
    try {
      await savePersona({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        avatarBase64: persona?.avatarBase64 ?? null,
      });
      Toast.show({
        type: "success",
        props: {
          title: "Settings Saved",
          message: "Your field profile has been updated.",
        },
      });
    } catch {
      Toast.show({
        type: "error",
        props: {
          title: "Save Failed",
          message: "Unable to save profile updates to secure storage.",
        },
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRedoOnboarding = async () => {
    await resetAll();
    navigation.reset({
      index: 0,
      routes: [{ name: "Landing" }],
    });
  };

  const handleDemoVerificationFlow = () => {
    navigation.navigate("AssuranceWizard", { isPreviewDemo: true });
  };

  const performFullDemoReset = async () => {
    try {
      await resetDemoMutation.mutateAsync();
      await clearLocalData();
      await resetAll();
      queryClient.clear();

      Toast.show({
        type: "success",
        props: {
          title: "Demo Reset Complete",
          message:
            "Local cache and production database have been restored to the original seed.",
        },
      });

      navigation.reset({
        index: 0,
        routes: [{ name: "Landing" }],
      });
    } catch (err: any) {
      Toast.show({
        type: "error",
        props: {
          title: "Reset Failed",
          message: formatMobileErrorMessage(err),
        },
      });
    }
  };

  const handleConfirmResetDemo = () => {
    Alert.alert(
      "Reset Demo Environment?",
      "This will clear all local SQLite data and device profile settings, and reset all user-submitted chat messages and reports in the database back to the original seed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset Demo",
          style: "destructive",
          onPress: performFullDemoReset,
        },
      ],
    );
  };

  return (
    <GradientHeaderLayout
      title="Settings"
      subtitle="Manage your field profile and device preferences."
      leftAction={<BackButton onPress={() => navigation.goBack()} />}
      rightAction={<KpmgLogo height={56} width={56} color="#fff" />}
      contentContainerStyle={{
        ...styles.body,
        paddingBottom: Math.max(insets.bottom + 24, 32),
      }}
    >
      <View style={styles.sectionStack}>
        {/* Avatar Identity Card (matches OnboardingProfileScreen) */}
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

        {/* Editable Profile Details Card */}
        <View style={styles.card}>
          {isAccount && (
            <Text style={[styles.helperText, { marginBottom: 12 }]}>
              Signed in as {account?.profile.email}. Your name and phone number are managed by your
              organisation.
            </Text>
          )}
          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>
              Full Name <Text style={{ color: "#DC2626" }}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              editable={!isAccount}
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
              Mobile Phone Number <Text style={{ color: "#DC2626" }}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              editable={!isAccount}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              placeholder="e.g. +234 803 555 0192"
              placeholderTextColor="#94A3B8"
            />
          </View>

          {isAccount ? (
            <PrimaryButton
              onPress={() => navigation.navigate("ChangePassword")}
              text="Change password"
              accessibilityLabel="Change your account password"
            />
          ) : (
            <PrimaryButton
              onPress={handleSaveProfile}
              text="Save Profile Changes"
              isWorking={isSaving}
              disabled={isSaving || !canSave}
              accessibilityLabel="Save Profile Changes"
            />
          )}
        </View>

        {/* Demo Controls Section (rendered only when DEMO_MODE is true) */}
        {(process.env.EXPO_PUBLIC_DEMO_MODE === "true") && (
          <View style={[styles.card, styles.demoCard]}>
            <View style={styles.demoHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.demoSectionTitle}>Demo Controls</Text>
                <Text style={styles.helperText}>
                  Walk through onboarding/verification or restore clean seeded data.
                </Text>
              </View>
              <Pill variant="info" text="DEMO_MODE" />
            </View>

            <View style={styles.demoButtonsStack}>
              <TouchableOpacity
                style={styles.demoActionBtn}
                onPress={handleRedoOnboarding}
                disabled={isResettingDemo}
                activeOpacity={0.75}
              >
                <View style={styles.demoBtnIconWrap}>
                  <Feather name="rotate-ccw" size={16} color={defaultColors.primary} />
                </View>
                <View style={styles.demoBtnTexts}>
                  <Text style={styles.demoBtnTitle}>Redo Onboarding</Text>
                  <Text style={styles.demoBtnSubtitle}>
                    Replay the welcome screen, profile setup, and project join flow.
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.demoActionBtn}
                onPress={handleDemoVerificationFlow}
                disabled={isResettingDemo}
                activeOpacity={0.75}
              >
                <View style={styles.demoBtnIconWrap}>
                  <Feather name="shield" size={16} color={defaultColors.primary} />
                </View>
                <View style={styles.demoBtnTexts}>
                  <Text style={styles.demoBtnTitle}>Demo Verification Flow</Text>
                  <Text style={styles.demoBtnSubtitle}>
                    Preview ID scan, 3-pose liveness, and credentials without saving.
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.demoActionBtn,
                  styles.demoDangerBtn,
                  isResettingDemo && { opacity: 0.7 },
                ]}
                onPress={handleConfirmResetDemo}
                disabled={isResettingDemo}
                activeOpacity={0.75}
              >
                <View style={[styles.demoBtnIconWrap, styles.demoDangerIconWrap]}>
                  {isResettingDemo ? (
                    <ActivityIndicator size="small" color="#DC2626" />
                  ) : (
                    <Feather name="trash-2" size={16} color="#DC2626" />
                  )}
                </View>
                <View style={styles.demoBtnTexts}>
                  <Text style={[styles.demoBtnTitle, { color: "#B91C1C" }]}>
                    {isResettingDemo ? "Resetting Demo..." : "Reset Demo"}
                  </Text>
                  <Text style={styles.demoBtnSubtitle}>
                    Clear SQLite profile/cache and restore Postgres back to original seed.
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingBottom: 24,
  },
  sectionStack: {
    gap: 16,
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
  demoCard: {
    gap: 14,
  },
  demoHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  demoSectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  demoButtonsStack: {
    gap: 10,
  },
  demoActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: defaultColors.border,
    backgroundColor: "#F8FAFC",
  },
  demoDangerBtn: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  demoBtnIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  demoDangerIconWrap: {
    backgroundColor: "#FEE2E2",
  },
  demoBtnTexts: {
    flex: 1,
    gap: 2,
  },
  demoBtnTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  demoBtnSubtitle: {
    fontSize: 11,
    color: defaultColors.secondaryText,
    lineHeight: 15,
  },
});
