import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import Toast from "react-native-toast-message";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  Avatar,
  Container,
  GradientHeaderLayout,
  InfoCallout,
  Pill,
} from "../components/common";
import { PrimaryButton } from "../components/inputs/Buttons";
import { useDemoProjectsQuery } from "../queries/projects/useProjectsQueries";
import { useJoinProjectMutation } from "../queries/auth/useAuthMutations";
import { useProfile } from "../context/ProfileContext";
import {
  isValidJoinCode,
  JOIN_CODE_EXAMPLE,
  JOIN_CODE_MAX_LENGTH,
} from "@insite/shared";
import type { RootStackParamList } from "../navigation/types";

/**
 * Formats join codes as `AAA-999-SUF-XXXXXX` (e.g. LKK-402-CON-7K2QXM).
 * The first two hyphens are inserted automatically. The role suffix is 2-4 characters, so a
 * hyphen the user types after it is respected; without one, the last 6 characters are treated
 * as the random segment. Recomputed from scratch on every keystroke, so backspacing just works.
 */
export function formatJoinCodeInput(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const alnum = upper.replace(/-/g, "");
  const head = alnum.slice(0, 3);
  const mid = alnum.slice(3, 6);

  // Everything after the first 6 alphanumerics, keeping any hyphen the user typed.
  let seen = 0;
  let cut = upper.length;
  for (let i = 0; i < upper.length; i++) {
    if (upper[i] !== "-") seen++;
    if (seen === 6) {
      cut = i + 1;
      break;
    }
  }
  const tail = seen >= 6 ? upper.slice(cut).replace(/^-+/, "").replace(/-+/g, "-") : "";

  let suffix = "";
  let random = "";
  if (tail.includes("-")) {
    const [s, ...rest] = tail.split("-");
    suffix = s.slice(0, 4);
    random = rest.join("").slice(0, 6);
  } else if (tail.length > 4) {
    const t = tail.slice(0, 10);
    const suffixLen = Math.min(4, Math.max(2, t.length - 6));
    suffix = t.slice(0, suffixLen);
    random = t.slice(suffixLen, suffixLen + 6);
  } else {
    suffix = tail;
  }

  return [head, mid, suffix, random].filter((part) => part.length > 0).join("-");
}

export const EnterProjectCodeScreen: React.FC = () => {
  // Navigation
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Profile context
  const { profile, userInitials, updateProfile } = useProfile();

  // State
  const [projectCode, setProjectCode] = useState("");
  const [autofillIndex, setAutofillIndex] = useState(0);

  // Data fetching (demo-only autofill catalog)
  const {
    data: demoProjects = [],
    isFetching: loadingDemoCodes,
    refetch: refetchDemoProjects,
  } = useDemoProjectsQuery((process.env.EXPO_PUBLIC_DEMO_MODE === "true"));

  // Mutations
  const joinProjectMutation = useJoinProjectMutation();

  // Get seeded project codes
  const seededAutofillOptions = useMemo(() => {
    const options: Array<{
      code: string;
      projectName: string;
      codePrefix: string;
    }> = [];
    for (const p of demoProjects) {
      const contractorCode =
        p.joinCodes.find(
          (jc) => jc.fieldPersonaType === "CONTRACTOR_EXECUTOR",
        ) || p.joinCodes[0];
      if (contractorCode) {
        options.push({
          code: contractorCode.code,
          projectName: p.name,
          codePrefix: p.codePrefix,
        });
      }
    }
    return options;
  }, [demoProjects]);

  // Autofill demo code
  const handleAutofillDemoCode = async () => {
    let options = seededAutofillOptions;

    if (options.length === 0) {
      const res = await refetchDemoProjects();
      if (res.error) {
        Toast.show({
          type: "error",
          props: {
            title: "Autofill Unavailable",
            message:
              (res.error as Error)?.message ||
              "Could not fetch seeded projects from the database server.",
          },
        });
        return;
      }

      const list = res.data ?? [];
      options = list
        .map((p) => {
          const code =
            p.joinCodes.find(
              (jc) => jc.fieldPersonaType === "CONTRACTOR_EXECUTOR",
            ) || p.joinCodes[0];
          return code
            ? { code: code.code, projectName: p.name, codePrefix: p.codePrefix }
            : null;
        })
        .filter(
          (x): x is { code: string; projectName: string; codePrefix: string } =>
            x !== null,
        );
    }

    if (options.length === 0) {
      Toast.show({
        type: "warning",
        props: {
          title: "No Seeded Projects",
          message: "No active project join codes were found in the database.",
        },
      });
      return;
    }

    const idx = autofillIndex % options.length;
    const selected = options[idx];
    setProjectCode(formatJoinCodeInput(selected.code));
    setAutofillIndex((prev) => prev + 1);

    Toast.show({
      type: "info",
      props: {
        title: `Filled ${selected.code}`,
        message: `${selected.projectName}${
          options.length > 1 ? " (tap Autofill again to switch project)" : ""
        }`,
      },
    });
  };

  // Validation
  const canSubmit = useMemo(() => {
    return isValidJoinCode(projectCode);
  }, [projectCode]);

  // Submit project code
  const handleSubmit = async () => {
    const normalized = projectCode.trim().toUpperCase();
    if (!canSubmit) {
      Toast.show({
        type: "error",
        props: {
          title: "Valid Code Required",
          message:
            `Please enter a valid project join code (e.g. ${JOIN_CODE_EXAMPLE}).`,
        },
      });
      return;
    }

    try {
      const result = await joinProjectMutation.mutateAsync({
        joinCode: normalized,
        agentFullName: profile?.fullName?.trim() || "Field Engineer",
        agentPhoneNumber: profile?.phoneNumber?.trim() || "+2348000000000",
        deviceId: profile?.hardwareDeviceId || "DEV-MOBILE-FIELD",
        deviceModel: `${Platform.OS === "ios" ? "iOS" : "Android"} Field Device`,
        deviceOs: `${Platform.OS} ${Platform.Version}`,
      });

      const requiresAssurance =
        result.sessionProfile.requiresIdentityAssurance ||
        result.sessionProfile.fieldPersonaType === "CONTRACTOR_EXECUTOR";

      await updateProfile({
        activeProjectCode: result.sessionProfile.joinCodeUsed,
        activeProjectId: result.sessionProfile.projectId,
        activeSessionId: result.sessionProfile.sessionId,
        activeSessionToken: result.accessToken,
        activeRoleId: result.sessionProfile.roleId,
        activeRoleCode: result.sessionProfile.roleCode,
        activeRoleName: result.sessionProfile.roleName,
        activeFieldPersonaType: result.sessionProfile.fieldPersonaType,
        activeAssuranceWeight: result.sessionProfile.assuranceWeight,
        activeRequiresIdentityAssurance:
          result.sessionProfile.requiresIdentityAssurance,
        activePermissions: result.sessionProfile.permissions || [],
        assuranceStatus: requiresAssurance ? "NOT_SUBMITTED" : "APPROVED",
      });

      if (requiresAssurance) {
        navigation.navigate("AssuranceWizard");
      } else {
        navigation.reset({
          index: 0,
          routes: [{ name: "WbsInbox" }],
        });
      }
    } catch (err: any) {
      Toast.show({
        type: "error",
        props: {
          title: "Join Failed",
          message:
            err?.message ||
            "Unable to verify project join code. Ensure the server is running and code is valid.",
        },
      });
    }
  };

  const isSubmitting = joinProjectMutation.isPending;

  return (
    <Container style={styles.body}>
      <View style={{ alignSelf: "flex-end" }}>
        <Avatar
          size="xs"
          forceInitials={userInitials}
          showOnlineDot
          onPress={() => navigation.navigate("ProfileModal")}
          accessibilityLabel="Open Profile and Projects"
        />
      </View>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Join Project</Text>
        <Text style={styles.headerSubtitle}>
          Connect this field device to an authorized site
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Enter Project Join Code</Text>
        <Text style={styles.cardDescription}>
          Enter the project authorization code provided by your Independent
          Project Monitor or Managing Contractor.
        </Text>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.codeInput}
            value={projectCode}
            onChangeText={(text) =>
              setProjectCode(formatJoinCodeInput(text))
            }
            placeholder={JOIN_CODE_EXAMPLE}
            placeholderTextColor="#94A3B8"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={JOIN_CODE_MAX_LENGTH}
          />
        </View>

        <PrimaryButton
          onPress={handleSubmit}
          text="Join project"
          isWorking={isSubmitting}
          disabled={isSubmitting || !canSubmit}
        />
      </View>

      {/* Auto fill (Demo Mode only) */}
      {(process.env.EXPO_PUBLIC_DEMO_MODE === "true") && (
        <TouchableOpacity
          style={styles.autofillButton}
          onPress={handleAutofillDemoCode}
          disabled={loadingDemoCodes || isSubmitting}
          activeOpacity={0.75}
        >
          {loadingDemoCodes ? (
            <ActivityIndicator size="small" color="#00338D" />
          ) : (
            <Feather name="zap" size={14} color="#00338D" />
          )}
          <Text style={styles.autofillButtonText}>
            {loadingDemoCodes ? "Loading Join Codes..." : "Autofill Demo Code"}
          </Text>
        </TouchableOpacity>
      )}
    </Container>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 20,
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 14,
  },
  header: {
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "auto",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.75)",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  cardDescription: {
    fontSize: 13,
    color: "#64748B",
    lineHeight: 18,
  },
  inputContainer: {
    marginTop: 4,
  },
  codeInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "monospace",
    color: "#0F172A",
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
  },
  autofillButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    marginBottom: "60%",
  },
  autofillButtonText: {
    color: "#00338D",
    fontSize: 12,
    fontWeight: "700",
  },
});
