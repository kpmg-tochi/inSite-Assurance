import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useProfile } from "../context/ProfileContext";
import { signInWithAccount } from "../api/auth/authApi";
import { GradientHeaderLayout } from "../components/common/GradientHeaderLayout";
import { PrimaryButton } from "../components/inputs/Buttons";
import { cardShadow, defaultColors } from "../styles/commonStyles";
import type { RootStackParamList } from "../navigation/types";

const ERROR_COPY: Record<string, { title: string; message: string }> = {
  INVALID_CREDENTIALS: { title: "Sign-in failed", message: "The email or password is not right." },
  ACCOUNT_LOCKED: {
    title: "Account locked",
    message: "Too many failed attempts. Wait 15 minutes, then try again.",
  },
  NO_MOBILE_ACCESS: {
    title: "No mobile access",
    message:
      "Your account is not set up for the field app. Ask your administrator for a mobile role.",
  },
  DEVICE_REVOKED: {
    title: "Device revoked",
    message: "Your administrator revoked this phone for your account. Contact them to restore it.",
  },
  TENANT_SUSPENDED: { title: "Workspace suspended", message: "Contact the project team." },
};

/** Sign-in for pre-provisioned accounts (Phase 5): same email and password as the web portal. */
export const SignInScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signIn } = useProfile();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);

  const canSubmit = email.trim().length > 3 && password.length >= 6;

  const handleSignIn = async () => {
    if (!canSubmit) return;
    setWorking(true);
    try {
      const result = await signInWithAccount(email, password);
      await signIn(result);
      setPassword("");
      navigation.reset({
        index: 0,
        routes: [{ name: result.account.mustChangePassword ? "ChangePassword" : "Home" }],
      });
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      const copy = ERROR_COPY[code] ?? {
        title: "Could not sign in",
        message: (err as Error)?.message || "Check your connection and try again.",
      };
      Toast.show({ type: "error", props: copy });
    } finally {
      setWorking(false);
    }
  };

  return (
    <GradientHeaderLayout
      title="Sign in"
      subtitle="Use the account your organisation set up for you."
      contentContainerStyle={styles.body}
    >
      <View style={styles.card}>
        <View style={styles.inputGroup}>
          <Text style={styles.fieldLabel}>Work email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="name@organisation.com"
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            textContentType="password"
            autoComplete="password"
            onSubmitEditing={handleSignIn}
          />
        </View>
        <Text style={styles.helperText}>
          You will see every project you are assigned to.
        </Text>
      </View>

      <View style={styles.actions}>
        <PrimaryButton text="Sign in" onPress={handleSignIn} isWorking={working} disabled={!canSubmit || working} />
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
});
