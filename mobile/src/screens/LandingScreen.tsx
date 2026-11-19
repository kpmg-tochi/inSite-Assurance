import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import KpmgLogo from "../../assets/KPMG-logo.svg";
import InSiteLogo from "../../assets/InSite_Logo_White.svg";
import Container from "../components/common/Container";
import { PrimaryButton } from "../components/inputs/Buttons";
import { defaultColors } from "../styles/commonStyles";
import type { RootStackParamList } from "../navigation/types";

export const LandingScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onSignIn = () => navigation.navigate("SignIn");
  const onJoinWithCode = () => navigation.navigate("Onboarding");
  return (
    <Container style={{ justifyContent: "space-between" }}>
      <StatusBar style="light" />

      {/* Top Section: Small White KPMG Brand Logo */}
      <View style={styles.topSection}>
        <KpmgLogo height={64} width={64} color="#fff" />
      </View>

      {/* Center Hero Section: App Logo + App Title + Mission Description */}
      <View style={styles.centerSection}>
        {/* Large Main App Logo Placeholder */}
        <InSiteLogo height={128} width={128} />

        {/* App Title */}
        <View style={styles.titleWrap}>
          <Text style={styles.appTitle}>InSite Assurance</Text>
          <Text style={styles.appSubtitle}>Project Field Verification</Text>
        </View>
      </View>

      {/* Two ways in (Phase 5): an account set up by your organisation, or a project code. */}
      <View style={styles.bottomSection}>
        <PrimaryButton
          onPress={onSignIn}
          text="Sign in"
          backgroundColor="#fff"
          textColor={defaultColors.primary}
          accessibilityLabel="Sign in with the account your organisation set up"
          style={{ width: "100%" }}
        />
        <PrimaryButton
          onPress={onJoinWithCode}
          text="Join with a project code"
          backgroundColor="transparent"
          textColor="#fff"
          accessibilityLabel="Join a project with a code from the project team"
          style={styles.outlineButton}
        />
        <Text style={styles.hint}>
          Sign in if your organisation gave you an account. Use a project code if the project team gave you one.
        </Text>
      </View>
    </Container>
  );
};

const styles = StyleSheet.create({
  topSection: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerSection: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  logoSpacing: {
    marginBottom: 28,
  },
  titleWrap: {
    marginTop: 10,
    alignItems: "center",
    gap: 8,
  },
  appTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  appSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.78)",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 290,
    marginTop: 4,
  },
  bottomSection: {
    alignItems: "center",
    gap: 14,
  },
  outlineButton: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.7)",
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: "rgba(255, 255, 255, 0.75)",
    textAlign: "center",
    maxWidth: 300,
  },
});
