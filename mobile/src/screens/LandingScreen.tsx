import React from "react";
import { Image, ImageBackground, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Container from "../components/common/Container";
import { PrimaryButton } from "../components/inputs/Buttons";
import { defaultColors } from "../styles/commonStyles";
import type { RootStackParamList } from "../navigation/types";

// Demo branch: UBEC client branding on the welcome screen (bundled assets, no network).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UBEC_FULL_LOGO = require("../../assets/client/ubec-logo-full.png");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UBEC_WELCOME_PHOTO = require("../../assets/client/ubec-welcome.jpeg");

export const LandingScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onSignIn = () => navigation.navigate("SignIn");
  const onJoinWithCode = () => navigation.navigate("Onboarding");
  return (
    <Container backgroundColor={defaultColors.primaryDark} style={{ justifyContent: "space-between" }}>
      <StatusBar style="light" />

      {/* Photo under a dark-green overlay (decorative). */}
      <ImageBackground
        source={UBEC_WELCOME_PHOTO}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.overlay} />
      </ImageBackground>

      <View style={styles.topSection}>
        <Text style={styles.poweredBy}>Powered by InSite Assurance</Text>
      </View>

      {/* Center Hero Section: client logo + programme copy */}
      <View style={styles.centerSection}>
        <Image
          source={UBEC_FULL_LOGO}
          style={styles.fullLogo}
          resizeMode="contain"
          accessibilityLabel="Universal Basic Education Commission (UBEC)"
        />

        <View style={styles.titleWrap}>
          <Text style={styles.kicker}>Basic Education Infrastructure Programme</Text>
          <Text style={styles.appTitle}>Verified progress, from site to payment.</Text>
          <Text style={styles.appSubtitle}>
            {"Capture supervision and M&E visits on site, and track findings to resolution."}
          </Text>
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
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(18, 47, 42, 0.86)",
  },
  topSection: {
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  poweredBy: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.8)",
    letterSpacing: 0.3,
  },
  centerSection: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  fullLogo: {
    width: 300,
    height: 74,
  },
  titleWrap: {
    marginTop: 28,
    alignItems: "center",
    gap: 8,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#FFBF00",
    textAlign: "center",
  },
  appTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    textAlign: "center",
    lineHeight: 34,
    maxWidth: 320,
  },
  appSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.82)",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
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
