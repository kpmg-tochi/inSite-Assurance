import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Toast from "react-native-toast-message";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChangePasswordRequestSchema } from "@insite/shared";
import { useProfile } from "../context/ProfileContext";
import { changeAccountPassword } from "../api/auth/authApi";
import { GradientHeaderLayout } from "../components/common/GradientHeaderLayout";
import { PrimaryButton } from "../components/inputs/Buttons";
import { cardShadow, defaultColors } from "../styles/commonStyles";
import type { RootStackParamList } from "../navigation/types";

/**
 * Password change for a signed-in account. Forced after the first sign-in with a temporary
 * password (the server refuses project requests until it is done). Changing it signs out the
 * account's other devices and browser sessions.
 */
export const ChangePasswordScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ChangePassword">>();
  const { account, completePasswordChange, signOut } = useProfile();
  const forced = Boolean(account?.profile.mustChangePassword || route.params?.forced);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);

  const handleSave = async () => {
    if (!account) return;
    if (newPassword !== confirm) {
      Toast.show({ type: "error", props: { title: "Passwords differ", message: "Type the new password twice." } });
      return;
    }
    const parsed = ChangePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      Toast.show({
        type: "error",
        props: { title: "Choose another password", message: parsed.error.issues[0]?.message ?? "Invalid password" },
      });
      return;
    }
    setWorking(true);
    try {
      const result = await changeAccountPassword(account.token, parsed.data);
      await completePasswordChange(result);
      Toast.show({ type: "success", props: { title: "Password changed", message: "Your other sessions were signed out." } });
      navigation.reset({ index: 0, routes: [{ name: "Projects" }] });
    } catch (err) {
      Toast.show({
        type: "error",
        props: { title: "Could not change password", message: (err as Error)?.message || "Try again." },
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <GradientHeaderLayout
      title={forced ? "Set your password" : "Change password"}
      subtitle={forced ? "Your administrator gave you a temporary password. Choose your own to continue." : undefined}
      contentContainerStyle={styles.body}
    >
      <View style={styles.card}>
        {(
          [
            ["Current password", currentPassword, setCurrentPassword, "password"],
            ["New password", newPassword, setNewPassword, "newPassword"],
            ["Repeat new password", confirm, setConfirm, "newPassword"],
          ] as const
        ).map(([label, value, setter, contentType]) => (
          <View key={label} style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setter}
              secureTextEntry
              textContentType={contentType}
              placeholderTextColor="#94A3B8"
            />
          </View>
        ))}
        <Text style={styles.helperText}>At least 10 characters, with a letter and a number.</Text>
      </View>

      <View style={styles.actions}>
        <PrimaryButton text="Save password" onPress={handleSave} isWorking={working} disabled={working} />
        {forced ? (
          <PrimaryButton
            text="Sign out"
            backgroundColor="#FFFFFF"
            textColor={defaultColors.primary}
            style={styles.secondary}
            onPress={async () => {
              await signOut();
              navigation.reset({ index: 0, routes: [{ name: "Landing" }] });
            }}
          />
        ) : null}
      </View>
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  body: { paddingBottom: 24, justifyContent: "space-between" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: defaultColors.border,
    ...cardShadow,
  },
  inputGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#334155", marginBottom: 6 },
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
  helperText: { fontSize: 12, color: defaultColors.secondaryText, lineHeight: 17 },
  actions: { marginTop: 16, gap: 10 },
  secondary: { borderWidth: 1, borderColor: defaultColors.border },
});
