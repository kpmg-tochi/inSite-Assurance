import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { updateLocalProfile } from '../storage/secureProfileStore';
import { API_BASE_URL } from '../config/apiConfig';

interface Props {
  onCodeSubmitted: (joinCode: string, isContractorTier: boolean) => void;
  onOpenProfile: () => void;
  userInitials?: string;
}

export const EnterProjectCodeScreen: React.FC<Props> = ({
  onCodeSubmitted,
  onOpenProfile,
  userInitials = 'CO',
}) => {
  const [projectCode, setProjectCode] = useState('LKK-402-CON');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const normalized = projectCode.trim().toUpperCase();
    if (!normalized) {
      Alert.alert('Required', 'Please enter your project join code.');
      return;
    }

    setIsSubmitting(true);
    const isContractor = normalized.endsWith('-CON') || normalized.includes('CON');

    try {
      // Attempt real server registration if reachable
      const response = await fetch(`${API_BASE_URL}/auth/join-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: normalized,
          agentFullName: 'Engr. Chukwuma Okeke',
          agentPhoneNumber: '+234 803 555 0192',
          deviceId: 'DEV-HW-IN-SITU-001',
          deviceModel: 'Samsung Galaxy A14 (WAT Field Device)',
          deviceOs: 'Android 14',
          livenessPassed: true,
          corenLicenseNumber: 'COREN R.49201',
          experienceSummary: '8 years supervising highway reinforced concrete structures.',
        }),
      }).catch(() => null);

      let sessionToken = 'offline-mock-session-token';
      let projectId = 'proj-lkk-402';

      if (response && response.ok) {
        const json = await response.json();
        sessionToken = json.data?.accessToken || sessionToken;
        projectId = json.data?.fieldSession?.projectId || projectId;
      }

      await updateLocalProfile({
        activeProjectCode: normalized,
        activeProjectId: projectId,
        activeSessionToken: sessionToken,
        activeIndependenceTier: isContractor ? 'CONTRACTOR_ENGINEER' : 'MONITOR_INSPECTOR',
        assuranceStatus: isContractor ? 'PENDING_APPROVAL' : 'APPROVED',
      });

      onCodeSubmitted(normalized, isContractor);
    } catch (e) {
      console.warn('Error during join-project, proceeding offline:', e);
      onCodeSubmitted(normalized, isContractor);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header with Avatar and Offline Ready Badge */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={onOpenProfile}
            activeOpacity={0.8}
          >
            <Text style={styles.avatarText}>{userInitials}</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>InSite Assurance</Text>
            <Text style={styles.headerSubtitle}>Field Evidence &amp; Verification</Text>
          </View>
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>Offline Ready</Text>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.card}>
          <View style={styles.cardTag}>
            <Text style={styles.cardTagText}>Project Onboarding</Text>
          </View>

          <Text style={styles.cardTitle}>Enter Project Join Code</Text>
          <Text style={styles.cardDescription}>
            Enter the facility authorization code provided by your Independent Project Monitor or
            Managing Contractor.
          </Text>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.codeInput}
              value={projectCode}
              onChangeText={(t) => setProjectCode(t.toUpperCase())}
              placeholder="e.g. LKK-402-CON"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, isSubmitting && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>
              {isSubmitting ? 'Joining Facility...' : 'Submit Project Code'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Informational Guidance */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Verification Notice</Text>
          <Text style={styles.infoBody}>
            Contractor codes (-CON) will initiate a 3-step offline assurance check: ID photo,
            live selfie with head-turn liveness, and COREN/regulatory license number.
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#0C233C',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#00338D',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#93C5FD',
  },
  offlineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  offlineBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  body: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    alignItems: 'center',
  },
  cardTag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 12,
  },
  cardTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#00338D',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  cardDescription: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  inputContainer: {
    width: '100%',
    marginBottom: 20,
  },
  codeInput: {
    backgroundColor: '#EFF6FF',
    borderWidth: 2,
    borderColor: '#00338D',
    borderRadius: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    color: '#0C233C',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00338D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  infoBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 3,
  },
  infoBody: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
  },
});

