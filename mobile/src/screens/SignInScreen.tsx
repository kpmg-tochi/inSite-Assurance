import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Toast from "react-native-toast-message";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useProfile } from "../context/ProfileContext";
import { signInWithAccount } from "../api/auth/authApi";
import { GradientHeaderLayout } from "../components/common/GradientHeaderLayout";
import { PrimaryButton } from "../components/inputs/Buttons";
import { cardShadow, defaultColors } from "../styles/commonStyles";
import type { RootStackParamList } from "../navigation/types";

/**
 * Demo builds only: the field cast for one-tap sign-in. The flag is written inline so Expo inlines it
 * and Metro drops the `require` (and the account list with its password) from non-demo bundles.
 */
const demoCast: typeof import("../utils/demoAccounts") | null =
  process.env.EXPO_PUBLIC_DEMO_MODE === "true"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../utils/demoAccounts")
    : null;

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
  /** Email of the demo account being signed in (demo builds only). */
  const [demoWorking, setDemoWorking] = useState<string | null>(null);
  const busy = working || demoWorking !== null;

  const canSubmit = email.trim().length > 3 && password.length >= 6;

  const handleSignIn = async () => {
    if (!canSubmit || busy) return;
    setWorking(true);
    try {
      await signInAs(email, password);
    } finally {
      setWorking(false);
    }
  };

  /** One tap on a demo account: the same password sign-in as the form. */
  const handleDemoSignIn = async (demoEmail: string, demoPassword: string) => {
    if (busy) return;
    setDemoWorking(demoEmail);
    try {
      await signInAs(demoEmail, demoPassword);
    } finally {
      setDemoWorking(null);
    }
  };

  const signInAs = async (accountEmail: string, accountPassword: string) => {
    try {
      const result = await signInWithAccount(accountEmail, accountPassword);
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
    }
  };

  return (
    <GradientHeaderLayout
      title="Sign in"
      subtitle="Use the account your organisation set up for you."
      contentContainerStyle={demoCast ? styles.bodyDemo : styles.body}
    >
      {demoCast ? (
        <View style={[styles.card, styles.demoCard]}>
          <Text style={styles.demoTitle} accessibilityRole="header">
            Demo accounts
          </Text>
          <Text style={styles.helperText}>Tap a person to sign in as them.</Text>
          <View style={styles.demoList}>
            {demoCast.DEMO_FIELD_ACCOUNTS.map((account) => {
              const isThis = demoWorking === account.email;
              return (
                <TouchableOpacity
                  key={account.email}
                  style={[styles.demoRow, busy && !isThis && styles.demoRowDimmed]}
                  onPress={() => void handleDemoSignIn(account.email, demoCast.DEMO_PASSWORD)}
                  disabled={busy}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={demoCast.demoAccountA11yLabel(account)}
                  accessibilityState={{ disabled: busy, busy: isThis }}
                >
                  <View style={styles.demoInitials}>
                    <Text style={styles.demoInitialsText}>{account.initials}</Text>
                  </View>
                  <View style={styles.demoTexts}>
                    <Text style={styles.demoRole}>{account.roleTitle}</Text>
                    <Text style={styles.demoMeta} numberOfLines={1}>
                      {account.name} · {account.email}
                    </Text>
                  </View>
                  {isThis ? <ActivityIndicator size="small" color={defaultColors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

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
        <PrimaryButton text="Sign in" onPress={handleSignIn} isWorking={working} disabled={!canSubmit || busy} />
      </View>
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  body: { paddingBottom: 24, justifyContent: "space-between" },
  /** Demo builds: the button stays right under the form, below the demo accounts. */
  bodyDemo: { paddingBottom: 24 },
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
  demoCard: { marginBottom: 16 },
  demoTitle: { fontSize: 15, fontWeight: "800", color: defaultColors.primaryText, marginBottom: 4 },
  demoList: { marginTop: 12, gap: 8 },
  demoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: defaultColors.border,
    backgroundColor: "#F8FAFC",
  },
  demoRowDimmed: { opacity: 0.5 },
  demoInitials: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: defaultColors.primary,
  },
  demoInitialsText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  demoTexts: { flex: 1 },
  demoRole: { fontSize: 14, fontWeight: "700", color: defaultColors.primaryText },
  demoMeta: { fontSize: 12, color: defaultColors.secondaryText, marginTop: 2 },
});
