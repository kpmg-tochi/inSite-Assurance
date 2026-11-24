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
import { HomeScreen } from "../screens/HomeScreen";
import { ProjectScreen } from "../screens/ProjectScreen";
import { VisitScreen } from "../screens/VisitScreen";
import VisitFormScreen from "../screens/visit/VisitFormScreen";
import VisitReviewScreen from "../screens/visit/VisitReviewScreen";
import { SiteLogScreen } from "../screens/SiteLogScreen";
import DefectsScreen from "../screens/DefectsScreen";

// Modals
import { ProfileAndProjectsScreen } from "../screens/ProfileAndProjectsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SpecialIncidentModal } from "../screens/SpecialIncidentModal";
import { NotificationCenterModal } from "../screens/NotificationCenterModal";
import { OutboxModal } from "../screens/OutboxModal";
import { VisitRespondModal } from "../screens/VisitRespondModal";
import { UnscheduledVisitModal } from "../screens/UnscheduledVisitModal";
import { SiteLogEntryModal } from "../screens/SiteLogEntryModal";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Redesign R5b (D-R5.1, D-R5.2): one native stack plus modals, no tabs. Home is the start once
 * signed in; the project picker step is gone (Home lists every project).
 */
export const RootNavigator: React.FC = () => {
  const { loading, account, pushIdentities } = useProfile();

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
    return "Home";
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
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Project" component={ProjectScreen} />
        <Stack.Screen name="Visit" component={VisitScreen} />
        <Stack.Screen name="VisitForm" component={VisitFormScreen} />
        <Stack.Screen name="VisitReview" component={VisitReviewScreen} />
        <Stack.Screen name="SiteLog" component={SiteLogScreen} />
        <Stack.Screen name="Defects" component={DefectsScreen} />

        {/* MODAL SCREENS */}
        <Stack.Group
          screenOptions={{
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        >
          <Stack.Screen name="ProfileModal" component={ProfileAndProjectsScreen} />
          <Stack.Screen name="SettingsModal" component={SettingsScreen} />
          <Stack.Screen name="NotificationsModal" component={NotificationCenterModal} />
          <Stack.Screen name="Outbox" component={OutboxModal} />
          <Stack.Screen name="VisitRespond" component={VisitRespondModal} />
          <Stack.Screen name="UnscheduledVisit" component={UnscheduledVisitModal} />
          <Stack.Screen name="SiteLogEntry" component={SiteLogEntryModal} />
          <Stack.Screen name="IncidentModal" component={SpecialIncidentModal} />
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
