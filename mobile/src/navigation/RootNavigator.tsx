import React from "react";
import { StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useProfile } from "../context/ProfileContext";
import {
  useHourlyTelemetry,
  useNetworkSync,
  usePushNotifications,
} from "../hooks";
import { InSiteLoader } from "../components/common";
import Container from "../components/common/Container";
import type { RootStackParamList } from "./types";

// Screens
import { LandingScreen } from "../screens/LandingScreen";
import { OnboardingProfileScreen } from "../screens/OnboardingProfileScreen";
import { EnterProjectCodeScreen } from "../screens/EnterProjectCodeScreen";
import { AssuranceVerificationWizard } from "../screens/AssuranceVerificationWizard";
import { VerificationUnderReviewScreen } from "../screens/VerificationUnderReviewScreen";
import { WbsInboxScreen } from "../screens/WbsInboxScreen";
import { WbsChatThreadScreen } from "../screens/WbsChatThreadScreen";

// Modals
import { ProfileAndProjectsScreen } from "../screens/ProfileAndProjectsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SpecialIncidentModal } from "../screens/SpecialIncidentModal";
import { NotificationCenterModal } from "../screens/NotificationCenterModal";
import { BacklogReviewModal } from "../screens/BacklogReviewModal";
import { ConfirmAiSummarySheet } from "../screens/ConfirmAiSummarySheet";

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const { profile, loading, activeProjectId } = useProfile();

  // Background lifecycle hooks
  usePushNotifications(profile?.activeSessionToken);
  useNetworkSync();
  useHourlyTelemetry({
    activeProjectCode: profile?.activeProjectCode,
    activeProjectId,
    workdayStartHour: 7,
    workdayEndHour: 19,
  });

  if (loading) {
    return (
      <Container style={styles.loadingContainer}>
        <InSiteLoader white size="lg" />
      </Container>
    );
  }

  const getInitialRouteName = (): keyof RootStackParamList => {
    if (!profile || !profile.onboardingCompleted) return "Landing";
    if (!profile.activeProjectCode) return "EnterCode";
    if (
      profile.activeIndependenceTier === "CONTRACTOR_ENGINEER" &&
      profile.assuranceStatus === "NOT_SUBMITTED"
    ) {
      return "AssuranceWizard";
    }
    return "WbsInbox";
  };

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={getInitialRouteName()}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingProfileScreen} />
        <Stack.Screen name="EnterCode" component={EnterProjectCodeScreen} />
        <Stack.Screen
          name="AssuranceWizard"
          component={AssuranceVerificationWizard}
        />
        <Stack.Screen
          name="UnderReview"
          component={VerificationUnderReviewScreen}
        />
        <Stack.Screen name="WbsInbox" component={WbsInboxScreen} />
        <Stack.Screen name="WbsThread" component={WbsChatThreadScreen} />

        {/* MODAL SCREENS */}
        <Stack.Group
          screenOptions={{
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        >
          <Stack.Screen
            name="ProfileModal"
            component={ProfileAndProjectsScreen}
          />
          <Stack.Screen name="SettingsModal" component={SettingsScreen} />
          <Stack.Screen name="IncidentModal" component={SpecialIncidentModal} />
          <Stack.Screen
            name="NotificationsModal"
            component={NotificationCenterModal}
          />
          <Stack.Screen name="BacklogModal" component={BacklogReviewModal} />
          <Stack.Screen
            name="EodConfirmModal"
            component={ConfirmAiSummarySheet}
          />
        </Stack.Group>
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
});
