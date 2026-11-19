import React, { useEffect } from 'react';
import { useProfile } from '../context/ProfileContext';
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
  const { profile, refreshAssuranceStatus } = useProfile();
  const onDismiss = () =>
    navigation.reset({
      index: 0,
      routes: [{ name: 'WbsInbox' }],
    });

  useEffect(() => {
    void refreshAssuranceStatus();
  }, [refreshAssuranceStatus]);

  useEffect(() => {
    if (profile?.assuranceStatus === 'APPROVED') {
      navigation.reset({ index: 0, routes: [{ name: 'WbsInbox' }] });
    }
  }, [profile?.assuranceStatus, navigation]);
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
          Your ID photo, three selfies and COREN credentials have been sent to the Independent
          Monitor, who will compare them and approve or return them.
        </Text>

        <InfoCallout
          variant="info"
          title="You can start work now"
          description="Take photos, record voice notes and submit your daily reports while you wait."
        />

        <InfoCallout
          variant="neutral"
          title="Reports are held until approval"
          description="Your reports are sent to the server and held there. When your identity is approved they are submitted automatically; you do not need to send them again. If the review is returned, you will see the reason and can resubmit."
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
