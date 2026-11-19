import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Alert,
} from "react-native";
import Toast from "react-native-toast-message";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DemoProjectWorkspaceDto, FieldProjectContext } from "@insite/shared";
import { EmptyStateCard, GradientHeaderLayout, InSiteLoader } from "../components/common";
import { BackButton, IconButton } from "../components/inputs/Buttons";
import Avatar from "../components/common/Avatar";
import Pill from "../components/common/Pill";
import { useProfile } from "../context/ProfileContext";
import type { RootStackParamList } from "../navigation/types";
import { borderRadius, defaultColors } from "../styles/commonStyles";
import { sessionEndedFor } from "../config/sessionState";
import { outboxCountsByProject } from "../storage/outbox/outboxStore";
import { subscribeToSyncStatus } from "../storage/outbox/outboxProcessor";
import { useDemoProjectsQuery } from "../queries/projects/useProjectsQueries";
import { useDemoSkipVerificationMutation } from "../queries/auth/useAuthMutations";
import { formatMobileErrorMessage } from "../utils/errorFormatter";

type Counts = Map<string, { pending: number; dead: number }>;

/** "Lekki Electrical Ltd · ELEC" (the trade code identifies the package on multi-contractor projects). */
function contractorLabel(c: NonNullable<FieldProjectContext["contractor"]>): string {
  return `${c.organizationName} · ${c.tradeCode}${c.isMainContractor ? " (main contractor)" : ""}`;
}

/**
 * Every project on this device (Phase 5): projects assigned to the signed-in account and projects
 * joined with a code. Tap to switch; switching never discards queued work, and each project's
 * unsent items are shown.
 */
export const ProfileAndProjectsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const {
    account,
    projects,
    activeContext,
    activeProjectId,
    displayName,
    phoneNumber,
    switchProject,
    refreshProjects,
    signOut,
    addJoinSession,
    state,
  } = useProfile();

  const [counts, setCounts] = useState<Counts>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const loadCounts = useCallback(() => {
    outboxCountsByProject().then(setCounts).catch(() => undefined);
  }, []);

  useFocusEffect(loadCounts);
  // Counts follow the outbox as it sends.
  useEffect(() => subscribeToSyncStatus(() => loadCounts()), [loadCounts]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshProjects();
    } catch (err) {
      Toast.show({
        type: "error",
        props: { title: "Could not refresh", message: formatMobileErrorMessage(err) },
      });
    } finally {
      loadCounts();
      setRefreshing(false);
    }
  };

  const openProject = async (project: FieldProjectContext) => {
    if (switchingId) return;
    setSwitchingId(project.projectId);
    try {
      if (project.projectId !== activeProjectId) await switchProject(project.projectId);
      const needsAssurance =
        project.requiresIdentityAssurance &&
        (project.assuranceStatus === "NOT_SUBMITTED" || project.assuranceStatus === "REJECTED");
      navigation.reset({ index: 0, routes: [{ name: needsAssurance ? "AssuranceWizard" : "WbsInbox" }] });
    } finally {
      setSwitchingId(null);
    }
  };

  const totalPending = [...counts.values()].reduce((n, c) => n + c.pending + c.dead, 0);

  const onSignOut = () => {
    const provisionedPending = projects
      .filter((p) => p.origin === "PROVISIONED_ACCOUNT")
      .reduce((n, p) => n + (counts.get(p.projectId)?.pending ?? 0) + (counts.get(p.projectId)?.dead ?? 0), 0);
    const doSignOut = async () => {
      await signOut();
      const remaining = state.joinSessions.length;
      navigation.reset({ index: 0, routes: [{ name: remaining > 0 ? "Projects" : "Landing" }] });
    };
    Alert.alert(
      "Sign out?",
      provisionedPending > 0
        ? `${provisionedPending} item(s) for your account's projects have not been sent. They stay on this phone and are sent after you sign in again, but nothing is sent while you are signed out.`
        : "You can sign in again at any time.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => void doSignOut() },
      ]
    );
  };

  // ---- Demo workspaces (demo builds only): adds a join session for a seeded project. ----
  // Inline so non-demo builds compile the demo section out (see config/demoMode.ts).
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
  const {
    data: demoProjects = [],
    isLoading: loadingDemo,
    error: demoErrorObj,
    refetch: loadDemo,
  } = useDemoProjectsQuery(demo);
  const demoMutation = useDemoSkipVerificationMutation();
  const onDemoJoin = async (project: DemoProjectWorkspaceDto) => {
    const code =
      project.joinCodes.find((jc) => jc.fieldPersonaType === "CONTRACTOR_EXECUTOR") ?? project.joinCodes[0];
    if (!code) {
      Toast.show({
        type: "error",
        props: { title: "No join code", message: `${project.codePrefix} has no active join code.` },
      });
      return;
    }
    try {
      const result = await demoMutation.mutateAsync({
        payload: {
          joinCode: code.code,
          agentFullName: displayName || undefined,
          agentPhoneNumber: phoneNumber || undefined,
        },
      });
      await addJoinSession(result);
      navigation.reset({ index: 0, routes: [{ name: "WbsInbox" }] });
    } catch (err) {
      Toast.show({ type: "error", props: { title: "Demo join failed", message: formatMobileErrorMessage(err) } });
    }
  };

  const canGoBack = navigation.canGoBack();
  const roleLine = activeContext
    ? `${activeContext.roleName} · weight ${activeContext.assuranceWeight.toFixed(2)}`
    : account
      ? `${account.profile.mobileRole.name} · weight ${account.profile.mobileRole.assuranceWeight.toFixed(2)}`
      : "";
  // Phase 6: the contractor package the active session works for, from the server.
  const contractorLine = activeContext?.contractor ? contractorLabel(activeContext.contractor) : "";

  const renderProject = (project: FieldProjectContext) => {
    const isActive = project.projectId === activeProjectId;
    const c = counts.get(project.projectId);
    const unsent = (c?.pending ?? 0) + (c?.dead ?? 0);
    const ended = sessionEndedFor(project.projectId);
    return (
      <TouchableOpacity
        key={project.projectId}
        style={[styles.projectCard, isActive && styles.projectCardActive, switchingId === project.projectId && { opacity: 0.7 }]}
        onPress={() => void openProject(project)}
        disabled={Boolean(switchingId)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Open ${project.projectName}`}
      >
        <View style={styles.projectTop}>
          <Text style={styles.projectCode}>{project.projectCodePrefix}</Text>
          <Pill
            variant={ended ? "negative" : isActive ? "positive" : "gray"}
            text={ended ? "Access ended" : isActive ? "Open" : switchingId === project.projectId ? "Opening..." : "Open"}
          />
        </View>
        <Text style={styles.projectName}>{project.projectName}</Text>
        <Text style={styles.projectMeta}>
          {project.roleName} · {project.origin === "PROVISIONED_ACCOUNT" ? "Your account" : "Joined with code"}
          {project.origin === "JOIN_CODE" && project.requiresIdentityAssurance && project.assuranceStatus !== "APPROVED"
            ? ` · ID ${project.assuranceStatus === "PENDING_APPROVAL" ? "under review" : "needed"}`
            : ""}
        </Text>
        {project.contractor ? <Text style={styles.projectMeta}>{contractorLabel(project.contractor)}</Text> : null}
        {unsent > 0 && (
          <Text style={[styles.projectMeta, c?.dead ? styles.deadText : styles.pendingText]}>
            {unsent} item(s) not sent yet{c?.dead ? ` · ${c.dead} could not be sent` : ""}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const accountProjects = projects.filter((p) => p.origin === "PROVISIONED_ACCOUNT");
  const codeProjects = projects.filter((p) => p.origin === "JOIN_CODE");

  return (
    <>
      <View style={[styles.floatingAvatar, { top: insets.top + 54 }]}>
        <Avatar editable={true} size="lg" />
      </View>

      <GradientHeaderLayout
        leftAction={canGoBack ? <BackButton onPress={() => navigation.goBack()} /> : undefined}
        rightAction={<IconButton icon="cog-outline" onPress={() => navigation.navigate("SettingsModal")} />}
        contentContainerStyle={styles.body}
        scrollable={false}
      >
        <StatusBar style="light" />

        <View style={styles.user}>
          <Text style={styles.userName}>{displayName}</Text>
          {/* The role and weight come from the server, never from the device. */}
          {roleLine ? <Text style={styles.userRole}>{roleLine}</Text> : null}
          {contractorLine ? <Text style={styles.userRole}>{contractorLine}</Text> : null}
          {account ? <Text style={styles.userPhone}>{account.profile.email}</Text> : null}
          {phoneNumber ? <Text style={styles.userPhone}>{phoneNumber}</Text> : null}
        </View>

        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={{ ...styles.body, paddingBottom: insets.bottom + 16 }}
            showsVerticalScrollIndicator={false}
            refreshControl={account ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
          >
            {totalPending > 0 && (
              <Text style={styles.pendingBanner}>
                {totalPending} item(s) waiting to be sent across your projects. Switching project does not affect them.
              </Text>
            )}

            {account && (
              <View style={styles.section}>
                <View>
                  <Text style={styles.sectionTitle}>Your projects</Text>
                  <Text style={styles.sectionSubtitle}>Assigned to {account.profile.email}. Pull down to refresh.</Text>
                </View>
                {accountProjects.length === 0 ? (
                  <EmptyStateCard
                    title="No projects assigned"
                    description="Ask your administrator to assign you to a project, then pull down to refresh."
                    actionLabel="Refresh"
                    onAction={onRefresh}
                  />
                ) : (
                  accountProjects.map(renderProject)
                )}
              </View>
            )}

            <View style={styles.section}>
              <View>
                <Text style={styles.sectionTitle}>Joined with a code</Text>
                <Text style={styles.sectionSubtitle}>Projects you joined with a code from the project team.</Text>
              </View>
              {codeProjects.map(renderProject)}
              <TouchableOpacity
                style={styles.joinNewButton}
                onPress={() => navigation.navigate(state.persona || account ? "EnterCode" : "Onboarding")}
                activeOpacity={0.8}
              >
                <Text style={styles.joinNewButtonText}>+ Join another project with a code</Text>
              </TouchableOpacity>
            </View>

            {demo && (
              <View style={styles.section}>
                <Pill variant="warning" text="Demo mode: verification is skipped" />
                <Text style={styles.sectionTitle}>Demo workspaces</Text>
                {loadingDemo ? (
                  <InSiteLoader size="sm" label="Loading demo workspaces..." />
                ) : demoErrorObj && demoProjects.length === 0 ? (
                  <EmptyStateCard
                    title="Unable to load demo workspaces"
                    description={formatMobileErrorMessage(demoErrorObj)}
                    actionLabel="Retry"
                    onAction={loadDemo}
                  />
                ) : (
                  demoProjects.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.projectCard}
                      onPress={() => void onDemoJoin(p)}
                      disabled={demoMutation.isPending}
                    >
                      <Text style={styles.projectCode}>{p.codePrefix}</Text>
                      <Text style={styles.projectName}>{p.name}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            {account ? (
              <TouchableOpacity style={styles.signOutButton} onPress={onSignOut} activeOpacity={0.8}>
                <Text style={styles.signOutText}>Sign out of {account.profile.email}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.joinNewButton}
                onPress={() => navigation.navigate("SignIn")}
                activeOpacity={0.8}
              >
                <Text style={styles.joinNewButtonText}>Sign in with an account</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </GradientHeaderLayout>
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, height: "100%" },
  user: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 44,
    gap: 2,
  },
  floatingAvatar: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: "-50%" }],
    zIndex: 200,
  },
  userName: { fontSize: 16, fontWeight: "800", color: defaultColors.primary },
  userRole: { fontSize: 12, color: defaultColors.primaryText, marginTop: 2 },
  userPhone: { fontSize: 11, color: defaultColors.secondaryText, marginTop: 2 },
  body: { paddingTop: 16, gap: 16, backgroundColor: "#fff" },
  section: {
    padding: 12,
    borderRadius: borderRadius.medium,
    backgroundColor: defaultColors.background,
    borderWidth: 1,
    borderColor: defaultColors.border,
    gap: 10,
  },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  sectionSubtitle: { fontSize: 11, color: "#64748B" },
  pendingBanner: {
    fontSize: 12,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    padding: 10,
  },
  projectCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 4,
  },
  projectCardActive: { borderColor: "#00338D", borderWidth: 1.5 },
  projectTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  projectCode: { fontSize: 13, fontWeight: "800", color: "#0C233C" },
  projectName: { fontSize: 12, fontWeight: "700", color: "#334155" },
  projectMeta: { fontSize: 11, color: "#64748B" },
  pendingText: { color: "#B45309", fontWeight: "700" },
  deadText: { color: "#DC2626", fontWeight: "700" },
  joinNewButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  joinNewButtonText: { fontSize: 12, fontWeight: "700", color: "#00338D" },
  signOutButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  signOutText: { fontSize: 12, fontWeight: "700", color: "#DC2626" },
});
