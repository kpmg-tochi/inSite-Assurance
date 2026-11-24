import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GradientHeaderLayout } from "../components/common";
import { BackButton, IconButton } from "../components/inputs/Buttons";
import Avatar from "../components/common/Avatar";
import { useProfile } from "../context/ProfileContext";
import type { RootStackParamList } from "../navigation/types";
import { defaultColors } from "../styles/commonStyles";
import { outboxCountsByProject } from "../storage/outbox/outboxStore";
import { subscribeToSyncStatus } from "../storage/outbox/outboxProcessor";

type Counts = Map<string, { pending: number; dead: number }>;

/**
 * The Profile modal (redesign R5b, D-R5.2): the account, what is still waiting to send, settings and
 * sign out. Projects are chosen on Home only (owner, 2026-11-24): every project screen has a Home
 * button, so the list here was a second, redundant project picker.
 */
export const ProfileAndProjectsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { account, activeContext, displayName, phoneNumber, signOut } = useProfile();

  const [counts, setCounts] = useState<Counts>(new Map());

  const loadCounts = useCallback(() => {
    outboxCountsByProject().then(setCounts).catch(() => undefined);
  }, []);

  useFocusEffect(loadCounts);
  // Counts follow the outbox as it sends.
  useEffect(() => subscribeToSyncStatus(() => loadCounts()), [loadCounts]);

  const totalPending = [...counts.values()].reduce((n, c) => n + c.pending + c.dead, 0);

  const onSignOut = () => {
    const doSignOut = async () => {
      await signOut();
      navigation.reset({ index: 0, routes: [{ name: "Landing" }] });
    };
    Alert.alert(
      "Sign out?",
      totalPending > 0
        ? `${totalPending} item(s) for your projects have not been sent. They stay on this phone and are sent after you sign in again, but nothing is sent while you are signed out.`
        : "You can sign in again at any time.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => void doSignOut() },
      ]
    );
  };

  const canGoBack = navigation.canGoBack();
  const roleLine = activeContext?.roleName ?? account?.profile.mobileRole.name ?? "";

  return (
    <>
      <View style={[styles.floatingAvatar, { top: insets.top + 54 }]}>
        <Avatar editable={true} size="lg" />
      </View>

      <GradientHeaderLayout
        leftAction={canGoBack ? <BackButton onPress={() => navigation.goBack()} /> : undefined}
        rightAction={<IconButton icon="cog-outline" text="Settings" onPress={() => navigation.navigate("SettingsModal")} />}
        contentContainerStyle={styles.body}
        scrollable={false}
      >
        <StatusBar style="light" />

        <View style={styles.user}>
          <Text style={styles.userName}>{displayName}</Text>
          {/* The role comes from the server, never from the device. */}
          {roleLine ? <Text style={styles.userRole}>{roleLine}</Text> : null}
          {account ? <Text style={styles.userPhone}>{account.profile.email}</Text> : null}
          {phoneNumber ? <Text style={styles.userPhone}>{phoneNumber}</Text> : null}
        </View>

        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={{ ...styles.body, paddingBottom: insets.bottom + 16 }}
            showsVerticalScrollIndicator={false}
          >
            {totalPending > 0 && (
              <Text style={styles.pendingBanner}>
                {totalPending} item(s) waiting to be sent across your projects.
              </Text>
            )}

            {account ? (
              <Text style={styles.note}>Your projects and visits are on Home. Pull down there to refresh them.</Text>
            ) : null}

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
  pendingBanner: {
    fontSize: 12,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    padding: 10,
  },
  note: { fontSize: 12, color: defaultColors.secondaryText, textAlign: "center" },
  joinNewButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  joinNewButtonText: { fontSize: 12, fontWeight: "700", color: "#00715D" },
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
