import React, { useMemo } from "react";
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
import { BrandLogo } from "../components/common/BrandLogo";
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
  // The account's name and phone come from the organisation and are read-only here.
  const { account, displayName, phoneNumber, resetAll } = useProfile();

  const resetDemoMutation = useResetDemoMutation();
  const isResettingDemo = resetDemoMutation.isPending;

  const avatarInitials = useMemo(
    () => getInitials(displayName, "ID"),
    [displayName],
  );

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
      "This will clear all local SQLite data and device profile settings, and reset everything submitted in the database (visit responses, monitoring reports, site log entries) back to the original seed.",
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
      subtitle="Your profile and this phone."
      leftAction={<BackButton onPress={() => navigation.goBack()} />}
      rightAction={<BrandLogo size={56} />}
      contentContainerStyle={{
        ...styles.body,
        paddingBottom: Math.max(insets.bottom + 24, 32),
      }}
    >
      <View style={styles.sectionStack}>
        {/* Avatar Identity Card */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <Avatar forceInitials={avatarInitials} editable />
            <View style={styles.avatarTextContainer}>
              <Text style={styles.cardLabel}>Your profile</Text>
              <Text style={styles.helperText}>
                Your name is recorded on the visits, photos and notes you send.
              </Text>
            </View>
          </View>
        </View>

        {/* Profile Details Card (read-only: managed by the organisation) */}
        <View style={styles.card}>
          <Text style={[styles.helperText, { marginBottom: 12 }]}>
            Signed in as {account?.profile.email}. Your name and phone number are managed by your
            organisation.
          </Text>
          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Full name</Text>
            <TextInput style={styles.input} editable={false} value={displayName} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Mobile phone number</Text>
            <TextInput style={styles.input} editable={false} value={phoneNumber} />
          </View>

          <PrimaryButton
            onPress={() => navigation.navigate("ChangePassword")}
            text="Change password"
            accessibilityLabel="Change your account password"
          />
        </View>

        {/* Demo Controls Section (rendered only when DEMO_MODE is true) */}
        {(process.env.EXPO_PUBLIC_DEMO_MODE === "true") && (
          <View style={[styles.card, styles.demoCard]}>
            <View style={styles.demoHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.demoSectionTitle}>Demo controls</Text>
                <Text style={styles.helperText}>
                  Restore clean seeded data.
                </Text>
              </View>
              <Pill variant="info" text="Demo build" />
            </View>

            <View style={styles.demoButtonsStack}>
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
                    Clears this phone and restores the demo data on the server.
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
    backgroundColor: "#E8F4F1",
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
