import React from "react";
import { Image, ImageBackground, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { APPLICATION_NAME } from "../config/appName";
import { PrimaryButton } from "../components/inputs/Buttons";
import { DEFAULT_FULL_LOGO } from "../components/common/BrandLogo";
import { defaultColors } from "../styles/commonStyles";
import type { RootStackParamList } from "../navigation/types";
import ubecPhoto from "../../assets/client/ubec-login.jpeg";

/**
 * Before sign-in (UBEC rebrand, as the web sign-in page): the client's photograph under a dark green
 * overlay, the full UBEC mark, and one way in: the account the organisation set up (redesign R1d).
 */
export const LandingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  return (
    <ImageBackground source={ubecPhoto} style={styles.fill} imageStyle={styles.photo} resizeMode="cover">
      <StatusBar style="light" />
      <LinearGradient
        colors={["rgba(18,47,42,0.92)", "rgba(18,47,42,0.25)", "rgba(18,47,42,0.96)"]}
        locations={[0, 0.4, 0.78]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Image
          source={DEFAULT_FULL_LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Universal Basic Education Commission (UBEC)"
        />

        <View style={styles.bottom}>
          <Text style={styles.appName}>{APPLICATION_NAME}</Text>
          <Text style={styles.headline}>Every school project, from contract award to handover.</Text>
          <Text style={styles.body}>
            Site visits with geotagged photos for Direct Intervention and Matching Grants projects. Works offline; your
            visits send when you are back online.
          </Text>
          <PrimaryButton
            onPress={() => navigation.navigate("SignIn")}
            text="Sign in"
            backgroundColor={defaultColors.primary}
            textColor="#FFFFFF"
            accessibilityLabel="Sign in with the account your organisation set up"
            style={styles.button}
          />
          <Text style={styles.hint}>Use the account your organisation set up for you.</Text>
          <Text style={styles.footer}>Universal Basic Education Commission · Education for development</Text>
        </View>
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: defaultColors.primaryDark },
  photo: { opacity: 1 },
  content: { flex: 1, justifyContent: "space-between", paddingHorizontal: 24 },
  logo: { width: 190, height: 56, alignSelf: "flex-start" },
  bottom: { gap: 10 },
  appName: {
    fontSize: 12,
    fontWeight: "700",
    color: defaultColors.accent,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  headline: { fontSize: 28, lineHeight: 34, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.4 },
  body: { fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.85)" },
  button: { width: "100%", marginTop: 14 },
  hint: { fontSize: 12, lineHeight: 17, color: "rgba(255,255,255,0.75)", textAlign: "center" },
  footer: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.25)",
    fontSize: 11,
    color: "rgba(255,255,255,0.7)",
  },
});
