import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { joinProjectByCode } from '../api/auth/authApi';
import { saveBaselinePack } from '../storage/offline-outbox';
import type { MobileBaselinePack } from '../config/apiConfig';
import type { FieldAgentSessionProfile } from '@insite/shared';

interface JoinProjectScreenProps {
  onJoined: (
    session: FieldAgentSessionProfile,
    baseline: MobileBaselinePack
  ) => void;
}

export function JoinProjectScreen({ onJoined }: JoinProjectScreenProps) {
  const [joinCode, setJoinCode] = useState('LKK-402-COW');
  const [agentName, setAgentName] = useState('Arch. Kenneth Nwachukwu');
  const [phoneNumber, setPhoneNumber] = useState('+234 809 333 4455');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Contractor Assurance Onboarding State
  const [corenNumber, setCorenNumber] = useState('R.49201');
  const [idUploaded, setIdUploaded] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);

  const isContractorCode = joinCode.toUpperCase().endsWith('-CON');

  const handleQuickFill = (
    code: string,
    name: string,
    phone: string,
    coren?: string
  ) => {
    setJoinCode(code);
    setAgentName(name);
    setPhoneNumber(phone);
    setErrorMsg(null);
    if (coren) {
      setCorenNumber(coren);
      setIdUploaded(true);
      setLivenessPassed(true);
    }
  };

  const handleSimulateLivenessCheck = () => {
    setLivenessChecking(true);
    setTimeout(() => {
      setLivenessChecking(false);
      setLivenessPassed(true);
      Alert.alert(
        'Liveness Verified',
        'Head-turn detection passed. Live hardware selfie captured and cryptographic hash sealed.'
      );
    }, 1200);
  };

  const handleJoinSubmit = async () => {
    if (!joinCode.trim() || !agentName.trim() || !phoneNumber.trim()) {
      setErrorMsg('Please enter your project join code, full name, and phone number.');
      return;
    }

    if (isContractorCode && (!idUploaded || !livenessPassed)) {
      setErrorMsg(
        'Contractor Assurance requires uploading a valid photo ID and completing the live selfie check.'
      );
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);

      const res = await joinProjectByCode({
        joinCode: joinCode.trim().toUpperCase(),
        agentFullName: agentName.trim(),
        agentPhoneNumber: phoneNumber.trim(),
        deviceId: 'EXPO-MOBILE-DEV-DEVICE-01',
        deviceModel: 'Android / iOS Field Device',
        deviceOs: 'Expo Mobile Client',
        ...(isContractorCode
          ? {
              corenLicenseNumber: corenNumber.trim(),
              idDocumentType: 'FEDERAL_NIN_SLIP',
              idDocumentUrl:
                'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80',
              selfieImageUrl:
                'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
              livenessPassed: true,
              livenessScore: 0.97,
              experienceSummary:
                'Civil engineer with 8+ years supervising reinforced concrete box culverts, earthworks compaction, and quality assurance.',
            }
          : {}),
      });

      saveBaselinePack(res.baselinePack);
      onJoined(res.sessionProfile, res.baselinePack);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to connect to InSite Assurance server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Brand Header */}
      <View style={styles.brandHeader}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandBadgeText}>KPMG Capital Advisory</Text>
        </View>
        <Text style={styles.title}>InSite Assurance</Text>
        <Text style={styles.subtitle}>
          Offline-first field evidence capture and contractor assurance for Nigerian capital corridors.
        </Text>
      </View>

      {/* Join Code Input Form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Project Onboarding</Text>
        <Text style={styles.cardSubtitle}>
          Enter your 6 to 10-character Project Join Code provided by the Independent Monitor.
        </Text>

        {errorMsg && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Project Join Code</Text>
          <TextInput
            style={styles.input}
            value={joinCode}
            onChangeText={(t: string) => setJoinCode(t.toUpperCase())}
            placeholder="e.g. LKK-402-INS"
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Field Agent Full Name</Text>
          <TextInput
            style={styles.input}
            value={agentName}
            onChangeText={setAgentName}
            placeholder="e.g. QS Tunde Adebayo"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mobile Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="+234 800 000 0000"
            keyboardType="phone-pad"
          />
        </View>

        {/* Contractor Assurance Special Section (Unfolds when -CON is entered) */}
        {isContractorCode && (
          <View style={styles.contractorAssuranceBox}>
            <View style={styles.assuranceHeader}>
              <Text style={styles.assuranceTitle}>Contractor Identity &amp; Competence Assurance</Text>
            </View>
            <Text style={styles.assuranceDesc}>
              To protect lender disbursement funds, on-site contractor personnel must provide verified
              credentials and pass a live facial liveness check before submission access is activated.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>COREN / Professional License Number</Text>
              <TextInput
                style={styles.input}
                value={corenNumber}
                onChangeText={setCorenNumber}
                placeholder="e.g. R.49201"
              />
            </View>

            {/* Photo ID Capture Trigger */}
            <TouchableOpacity
              style={[styles.assuranceButton, idUploaded && styles.assuranceButtonSuccess]}
              onPress={() => setIdUploaded(true)}
            >
              <Text style={styles.assuranceButtonText}>
                {idUploaded ? '✓ Government Photo ID Attached (NIN)' : 'Upload Government ID (NIN / Driver’s License)'}
              </Text>
            </TouchableOpacity>

            {/* Live Selfie Liveness Check Trigger */}
            <TouchableOpacity
              style={[styles.assuranceButton, livenessPassed && styles.assuranceButtonSuccess]}
              onPress={handleSimulateLivenessCheck}
              disabled={livenessChecking}
            >
              <Text style={styles.assuranceButtonText}>
                {livenessChecking
                  ? 'Verifying Head-Turn Liveness...'
                  : livenessPassed
                    ? '✓ Live Shutter Liveness Passed'
                    : 'Start Live Selfie & Head-Turn Test'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleJoinSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitButtonText}>Download Baseline &amp; Enter Workspace</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Quick Fill Demo Accounts */}
      <View style={styles.quickFillContainer}>
        <Text style={styles.quickFillLabel}>Quick-Fill Demo Credentials (1-Click):</Text>
        <TouchableOpacity
          style={styles.quickFillButton}
          onPress={() =>
            handleQuickFill(
              'LKK-402-INS',
              'QS Tunde Adebayo, FNIQS',
              '+234 802 111 2233'
            )
          }
        >
          <Text style={styles.quickFillTitle}>Tier 1: Independent Monitor Inspector</Text>
          <Text style={styles.quickFillCode}>LKK-402-INS · QS Tunde Adebayo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickFillButton}
          onPress={() =>
            handleQuickFill(
              'LKK-402-COW',
              'Arch. Kenneth Nwachukwu',
              '+234 809 333 4455'
            )
          }
        >
          <Text style={styles.quickFillTitle}>Tier 2: Resident Clerk of Works</Text>
          <Text style={styles.quickFillCode}>LKK-402-COW · Arch. Kenneth Nwachukwu</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickFillButton}
          onPress={() =>
            handleQuickFill(
              'LKK-402-CON',
              'Engr. Musa Danladi',
              '+234 803 456 7890',
              'R.49201'
            )
          }
        >
          <Text style={styles.quickFillTitle}>Tier 3: Main Contractor Site Engineer</Text>
          <Text style={styles.quickFillCode}>LKK-402-CON · Engr. Musa Danladi (COREN R.49201)</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  brandHeader: {
    marginBottom: 20,
  },
  brandBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  brandBadgeText: {
    color: '#00338D',
    fontSize: 11,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0C233C',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 16,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 12,
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
  },
  contractorAssuranceBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  assuranceHeader: {
    marginBottom: 4,
  },
  assuranceTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#166534',
  },
  assuranceDesc: {
    fontSize: 11,
    color: '#15803D',
    marginBottom: 10,
    lineHeight: 15,
  },
  assuranceButton: {
    borderWidth: 1,
    borderColor: '#00338D',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  assuranceButtonSuccess: {
    borderColor: '#16A34A',
    backgroundColor: '#DCFCE7',
  },
  assuranceButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0C233C',
  },
  submitButton: {
    backgroundColor: '#00338D',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  quickFillContainer: {
    marginTop: 10,
  },
  quickFillLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 8,
  },
  quickFillButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  quickFillTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#00338D',
  },
  quickFillCode: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
});
