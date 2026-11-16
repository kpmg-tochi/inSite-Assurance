import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  GradientHeaderLayout,
  InfoCallout,
  Pill,
} from '../components/common';
import { PrimaryButton } from '../components/inputs/Buttons';
import type { RootStackParamList } from '../navigation/types';

export const VerificationUnderReviewScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onDismiss = () =>
    navigation.reset({
      index: 0,
      routes: [{ name: 'WbsInbox' }],
    });
  return (
    <GradientHeaderLayout
      title="InSite Assurance"
      subtitle="Contractor Identity & Competence"
      contentContainerStyle={styles.body}
    >
      <View style={styles.card}>
        <Pill variant="warning" text="Under Review" style={{ alignSelf: 'center' }} />

        <Text style={styles.title}>Submission Under Review</Text>
        <Text style={styles.subtitle}>
          Your government ID photo, facial liveness signature, and COREN credentials have been
          submitted to the Independent Project Monitor for facility verification.
        </Text>

        <InfoCallout
          variant="info"
          title="Non-Blocking Field Access"
          description="You do not need to wait for approval to begin your site day! You can proceed directly to the WBS chat inbox, snap photos, and record notes."
        />

        <InfoCallout
          variant="neutral"
          title="Local Backlog Protection"
          description="To prevent unauthorized baseline updates and preserve AI compute, your daily logs will queue safely on this device. When approved, a push notification will alert you to review and confirm your submission backlog."
        />

        <PrimaryButton
          onPress={onDismiss}
          text="Dismiss & Proceed to WBS Inbox"
          style={styles.dismissButton}
        />
      </View>
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  body: {
    padding: 16,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  dismissButton: {
    width: '100%',
    marginTop: 6,
  },
});
