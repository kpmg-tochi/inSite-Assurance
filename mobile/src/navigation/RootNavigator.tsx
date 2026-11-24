import React from "react";
import { StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useProfile } from "../context/ProfileContext";
import {
  rootNavigationRef,
  SessionEndedOverlay,
} from "../components/common/SessionEndedOverlay";
import {
  useNetworkSync,
  usePushNotifications,
} from "../hooks";
import { InSiteLoader } from "../components/common";
import Container from "../components/common/Container";
import type { RootStackParamList } from "./types";

// Screens
import { LandingScreen } from "../screens/LandingScreen";
import { SignInScreen } from "../screens/SignInScreen";
import { ChangePasswordScreen } from "../screens/ChangePasswordScreen";
import { WbsInboxScreen } from "../screens/WbsInboxScreen";
import { WbsChatThreadScreen } from "../screens/WbsChatThreadScreen";
import DefectsScreen from "../screens/DefectsScreen";
import InspectionScreen from "../screens/InspectionScreen";
import InspectionFindingsScreen from "../screens/InspectionFindingsScreen";

// Modals
import { ProfileAndProjectsScreen } from "../screens/ProfileAndProjectsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SpecialIncidentModal } from "../screens/SpecialIncidentModal";
import { NotificationCenterModal } from "../screens/NotificationCenterModal";
import { BacklogReviewModal } from "../screens/BacklogReviewModal";
import { ConfirmAiSummarySheet } from "../screens/ConfirmAiSummarySheet";

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const { loading, account, activeContext, pushIdentities } = useProfile();

  // Background lifecycle hooks.
  usePushNotifications(pushIdentities);
  useNetworkSync();

  if (loading) {
    return (
      <Container style={styles.loadingContainer}>
        <InSiteLoader white size="lg" />
      </Container>
    );
  }

  const getInitialRouteName = (): keyof RootStackParamList => {
    if (account?.profile.mustChangePassword) return "ChangePassword";
    // A provisioned account is the only way in (redesign R1d, decision P2).
    if (!account) return "Landing";
    if (!activeContext) return "Projects";
    return "WbsInbox";
  };

  return (
    <NavigationContainer ref={rootNavigationRef}>
      <Stack.Navigator
        initialRouteName={getInitialRouteName()}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="SignIn" component={SignInScreen} />
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
        <Stack.Screen name="Projects" component={ProfileAndProjectsScreen} />
        <Stack.Screen name="WbsInbox" component={WbsInboxScreen} />
        <Stack.Screen name="WbsThread" component={WbsChatThreadScreen} />
        <Stack.Screen name="Defects" component={DefectsScreen} />
        <Stack.Screen name="Inspection" component={InspectionScreen} />
        <Stack.Screen name="InspectionFindings" component={InspectionFindingsScreen} />

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
      <SessionEndedOverlay />
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
});
