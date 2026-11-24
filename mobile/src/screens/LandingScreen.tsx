import React from "react";
import { APPLICATION_NAME } from "../config/appName";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import InSiteLogo from "../../assets/InSite_Logo_White.svg";
import Container from "../components/common/Container";
import { PrimaryButton } from "../components/inputs/Buttons";
import { defaultColors } from "../styles/commonStyles";
import type { RootStackParamList } from "../navigation/types";

export const LandingScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onSignIn = () => navigation.navigate("SignIn");
  return (
    <Container style={{ justifyContent: "space-between" }}>
      <StatusBar style="light" />

      {/* Before sign-in the tenant is unknown: neutral InSite branding only (Phase 6). */}
      <View style={styles.topSection} />

      {/* Center Hero Section: App Logo + App Title + Mission Description */}
      <View style={styles.centerSection}>
        {/* Large Main App Logo Placeholder */}
        <InSiteLogo height={128} width={128} />

        {/* App Title */}
        <View style={styles.titleWrap}>
          <Text style={styles.appTitle}>{APPLICATION_NAME}</Text>
          <Text style={styles.appSubtitle}>Project Field Verification</Text>
        </View>
      </View>

      {/* One way in (redesign R1d): the account your organisation set up. */}
      <View style={styles.bottomSection}>
        <PrimaryButton
          onPress={onSignIn}
          text="Sign in"
          backgroundColor="#fff"
          textColor={defaultColors.primary}
          accessibilityLabel="Sign in with the account your organisation set up"
          style={{ width: "100%" }}
        />
        <Text style={styles.hint}>
          Sign in with the account your organisation set up for you.
        </Text>
      </View>
    </Container>
  );
};

const styles = StyleSheet.create({
  topSection: {
    height: 64,
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
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: "rgba(255, 255, 255, 0.75)",
    textAlign: "center",
    maxWidth: 300,
  },
});
