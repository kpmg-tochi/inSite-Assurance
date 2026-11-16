import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import Toast from "react-native-toast-message";
import { StatusBar } from "expo-status-bar";
import type { DemoProjectWorkspaceDto } from "@insite/shared";
import {
  EmptyStateCard,
  GradientHeaderLayout,
  InSiteLoader,
} from "../components/common";
import { BackButton, IconButton } from "../components/inputs/Buttons";
import Avatar from "../components/common/Avatar";
import { useProfile } from "../context/ProfileContext";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { borderRadius, defaultColors } from "../styles/commonStyles";
import Pill from "../components/common/Pill";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDemoProjectsQuery } from "../queries/projects/useProjectsQueries";
import { useDemoSkipVerificationMutation } from "../queries/auth/useAuthMutations";

export type Persona = {
  roleTitle: string;
  tier: string;
  assuranceStatus:
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "REJECTED"
    | "NOT_SUBMITTED"
    | undefined;
};

export const ProfileAndProjectsScreen = () => {
  // Navigation
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Profile context
  const { profile, isVerified, updateProfile, clearSession } = useProfile();

  // Hooks
  const insets = useSafeAreaInsets();
  const {
    data: projects = [],
    isLoading: loadingProjects,
    error: projectsErrorObj,
    refetch: loadProjects,
  } = useDemoProjectsQuery();
  const switchWorkspaceMutation = useDemoSkipVerificationMutation();

  const projectsError = projectsErrorObj
    ? (projectsErrorObj as Error).message ||
      "Unable to fetch active demo workspaces from server."
    : null;

  // Settings
  const handleOpenSettings = () => {};

  // Functions
  const onClose = () => navigation.goBack();

  const onSwitchProject = async (project: DemoProjectWorkspaceDto) => {
    const preferredTier =
      profile?.activeIndependenceTier || "CONTRACTOR_ENGINEER";
    const targetCode =
      project.joinCodes.find((jc) => jc.independenceTier === preferredTier) ||
      project.joinCodes.find(
        (jc) => jc.independenceTier === "CONTRACTOR_ENGINEER",
      ) ||
      project.joinCodes[0];

    if (!targetCode) {
      Toast.show({
        type: "error",
        props: {
          title: "No Active Join Code",
          message: `Project ${project.codePrefix} does not have an active join code configured.`,
        },
      });
      return;
    }

    try {
      const result = await switchWorkspaceMutation.mutateAsync({
        joinCode: targetCode.code,
        agentFullName: profile?.fullName || undefined,
        agentPhoneNumber: profile?.phoneNumber || undefined,
        deviceId: profile?.hardwareDeviceId || undefined,
      });

      await updateProfile({
        activeProjectId: result.sessionProfile.projectId,
        activeProjectCode: result.sessionProfile.joinCodeUsed,
        activeSessionId: result.sessionProfile.sessionId,
        activeSessionToken: result.accessToken,
        activeIndependenceTier: result.sessionProfile.independenceTier,
        assuranceStatus: result.sessionProfile.assuranceStatus || "APPROVED",
      });

      Toast.show({
        type: "success",
        props: {
          title: "Workspace Switched",
          message: `Active project set to ${project.codePrefix} (${project.name}).`,
        },
      });
    } catch (err: any) {
      Toast.show({
        type: "error",
        props: {
          title: "Switch Failed",
          message:
            err?.message || "Could not connect to server to switch workspace.",
        },
      });
    }
  };

  const onJoinNewProject = async () => {
    await clearSession();
    navigation.reset({
      index: 0,
      routes: [{ name: "EnterCode" }],
    });
  };

  const onApplyPersona = async (persona: Persona) => {
    await updateProfile({
      roleTitle: persona.roleTitle,
      activeIndependenceTier: persona.tier,
      assuranceStatus: persona.assuranceStatus,
    });
  };

  return (
    <>
      <View style={[styles.floatingAvatar, { top: insets.top + 54 }]}>
        <Avatar editable={true} size="lg" />
      </View>

      <GradientHeaderLayout
        leftAction={<BackButton onPress={onClose} />}
        rightAction={
          <IconButton icon="cog-outline" onPress={handleOpenSettings} />
        }
        contentContainerStyle={styles.body}
      >
        <StatusBar style="light" />

        {/* User */}
        <View style={styles.user}>
          <View style={{ marginBottom: 8 }}>
            <Pill
              variant={isVerified ? "positive" : "warning"}
              text={isVerified ? "Assurance Verified" : "Verification Pending"}
            />
          </View>
          <Text style={styles.userName}>{profile?.fullName}</Text>
          <Text style={styles.userRole}>{profile?.roleTitle}</Text>
          <Text style={styles.userPhone}>{profile?.phoneNumber}</Text>
        </View>

        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {/* Active Project Switcher */}
            <View style={styles.section}>
              <View>
                <Text style={styles.sectionTitle}>Workspaces</Text>
                <Text style={styles.sectionSubtitle}>
                  Switch active project or enter a join code for an additional
                  workspace.
                </Text>
              </View>

              {loadingProjects ? (
                <InSiteLoader
                  size="sm"
                  label="Loading workspaces from server..."
                />
              ) : projectsError && projects.length === 0 ? (
                <EmptyStateCard
                  title="Unable to Load Workspaces"
                  description={projectsError}
                  actionLabel="Retry"
                  onAction={loadProjects}
                />
              ) : projects.length === 0 ? (
                <EmptyStateCard
                  title="No Projects Seeded"
                  description="No active infrastructure projects were found in the database."
                  actionLabel="Refresh"
                  onAction={loadProjects}
                />
              ) : (
                projects.map((project) => {
                  const isActive =
                    profile?.activeProjectId === project.id ||
                    (Boolean(profile?.activeProjectCode) &&
                      profile?.activeProjectCode?.startsWith(
                        project.codePrefix,
                      ));
                  const isSwitching =
                    switchWorkspaceMutation.isPending &&
                    switchWorkspaceMutation.variables?.joinCode?.startsWith(
                      project.codePrefix,
                    );

                  return (
                    <TouchableOpacity
                      key={project.id}
                      style={[
                        styles.projectCard,
                        isActive && styles.projectCardActive,
                        isSwitching && { opacity: 0.7 },
                      ]}
                      onPress={() => {
                        if (!isActive && !switchWorkspaceMutation.isPending) {
                          onSwitchProject(project);
                        }
                      }}
                      disabled={switchWorkspaceMutation.isPending}
                      activeOpacity={0.75}
                    >
                      <View style={styles.projectTop}>
                        <Text style={styles.projectCode}>
                          {project.codePrefix}
                        </Text>
                        <Pill
                          variant={isActive ? "positive" : "gray"}
                          text={
                            isActive
                              ? "Active"
                              : isSwitching
                                ? "Switching..."
                                : "Switch"
                          }
                        />
                      </View>
                      <Text style={styles.projectName}>{project.name}</Text>
                      <Text style={styles.projectMeta}>
                        {project.stateLocation}
                        {project.lgaLocation
                          ? ` · ${project.lgaLocation}`
                          : ""}{" "}
                        ·{" "}
                        {project.geofenceMode === "LINEAR_CORRIDOR"
                          ? "Linear Corridor"
                          : "Radial Geofence"}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}

              <TouchableOpacity
                style={styles.joinNewButton}
                onPress={onJoinNewProject}
                activeOpacity={0.8}
              >
                <Text style={styles.joinNewButtonText}>+ Add new project</Text>
              </TouchableOpacity>
            </View>

            {/* Demo Persona Switcher */}
            <View style={styles.section}>
              <View>
                <Text style={styles.sectionTitle}>Demo Scenario Switcher</Text>
                <Text style={styles.sectionSubtitle}>
                  Toggle between roles to test unverified backlog queuing vs.
                  certified monitor workflows.
                </Text>
              </View>

              {/* Persona 1: Contractor Unverified */}
              <TouchableOpacity
                style={styles.personaCard}
                onPress={() =>
                  onApplyPersona({
                    roleTitle: "Contractor Site Engineer (Unverified)",
                    tier: "CONTRACTOR_ENGINEER",
                    assuranceStatus: "PENDING_APPROVAL",
                  })
                }
                activeOpacity={0.7}
              >
                <View style={styles.personaRow}>
                  <View>
                    <Text style={styles.personaName}>
                      Contractor Engineer (Pending Review)
                    </Text>
                    <Text style={styles.personaDesc}>
                      Logs queue in local backlog; zero AI cost incurred until
                      approved.
                    </Text>
                  </View>
                  <Text style={styles.personaArrow}>→</Text>
                </View>
              </TouchableOpacity>

              {/* Persona 2: Contractor Approved */}
              <TouchableOpacity
                style={styles.personaCard}
                onPress={() =>
                  onApplyPersona({
                    roleTitle: "Senior Site Civil Engineer (COREN Verified)",
                    tier: "CONTRACTOR_ENGINEER",
                    assuranceStatus: "APPROVED",
                  })
                }
                activeOpacity={0.7}
              >
                <View style={styles.personaRow}>
                  <View>
                    <Text style={styles.personaName}>
                      Contractor Engineer (Verified)
                    </Text>
                    <Text style={styles.personaDesc}>
                      COREN verified; live AI summary parsing and full sync
                      enabled.
                    </Text>
                  </View>
                  <Text style={styles.personaArrow}>→</Text>
                </View>
              </TouchableOpacity>

              {/* Persona 3: Independent Clerk of Works */}
              <TouchableOpacity
                style={styles.personaCard}
                onPress={() =>
                  onApplyPersona({
                    roleTitle: "Independent Resident Clerk of Works (Tier 2)",
                    tier: "INDEPENDENT_RESIDENT",
                    assuranceStatus: "APPROVED",
                  })
                }
                activeOpacity={0.7}
              >
                <View style={styles.personaRow}>
                  <View>
                    <Text style={styles.personaName}>
                      Clerk of Works (Independent)
                    </Text>
                    <Text style={styles.personaDesc}>
                      Tier 2 assurance weight (0.85); daily resident
                      inspections.
                    </Text>
                  </View>
                  <Text style={styles.personaArrow}>→</Text>
                </View>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </GradientHeaderLayout>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  user: {
    alignItems: "center",
    textAlign: "center",
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
  userName: {
    fontSize: 16,
    fontWeight: "800",
    color: defaultColors.primary,
  },
  userRole: {
    fontSize: 12,
    color: defaultColors.primaryText,
    marginTop: 2,
  },
  userPhone: {
    fontSize: 11,
    color: defaultColors.secondaryText,
    marginTop: 2,
  },
  body: {
    paddingTop: 16,
    gap: 16,
    backgroundColor: "#fff",
  },
  section: {
    padding: 12,
    borderRadius: borderRadius.medium,
    backgroundColor: defaultColors.background,
    borderWidth: 1,
    borderColor: defaultColors.border,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  sectionSubtitle: {
    fontSize: 11,
    color: "#64748B",
  },
  projectCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 4,
  },
  projectCardActive: {
    borderColor: "#00338D",
    borderWidth: 1.5,
  },
  projectTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  projectCode: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0C233C",
  },
  projectName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  projectMeta: {
    fontSize: 11,
    color: "#64748B",
  },
  joinNewButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  joinNewButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#00338D",
  },
  personaCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  personaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  personaName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  personaDesc: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    maxWidth: 260,
  },
  personaArrow: {
    fontSize: 16,
    color: "#00338D",
    fontWeight: "700",
  },
});
