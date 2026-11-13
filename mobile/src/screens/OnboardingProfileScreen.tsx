import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { updateLocalProfile } from '../storage/secureProfileStore';

interface Props {
  onCompleted: () => void;
}

export const OnboardingProfileScreen: React.FC<Props> = ({ onCompleted }) => {
  const [fullName, setFullName] = useState('Engr. Chukwuma Okeke');
  const [phoneNumber, setPhoneNumber] = useState('+234 803 555 0192');
  const [roleTitle, setRoleTitle] = useState('Senior Site Civil Engineer');
  const [avatarInitials] = useState('CO');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!fullName.trim() || !phoneNumber.trim()) {
      Alert.alert('Required Fields', 'Please provide your full name and mobile number.');
      return;
    }
    setIsSaving(true);
    try {
      await updateLocalProfile({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        roleTitle: roleTitle.trim(),
        onboardingCompleted: true,
      });
      onCompleted();
    } catch (e) {
      Alert.alert('Error', 'Failed to save local profile to secure device storage.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.badgeRow}>
          <Text style={styles.metaBadge}>08:00 WAT</Text>
          <Text style={styles.metaBadge}>Offline-First · SecureStore</Text>
        </View>
        <Text style={styles.brandTitle}>Welcome to InSite Assurance</Text>
        <Text style={styles.brandSubtitle}>
          Set up your field profile once. Stored securely on this physical device.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Avatar Card */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{avatarInitials}</Text>
              <View style={styles.avatarPlusBadge}>
                <Text style={styles.avatarPlusText}>+</Text>
              </View>
            </View>
            <View style={styles.avatarTextContainer}>
              <Text style={styles.cardLabel}>Profile Avatar (Optional)</Text>
              <Text style={styles.helperText}>Snap a profile photo or keep your initials badge.</Text>
              <TouchableOpacity
                onPress={() => Alert.alert('Avatar Selected', 'Profile initials badge active.')}
                activeOpacity={0.7}
              >
                <Text style={styles.linkText}>Upload / Snap Photo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Inputs Card */}
        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Full Name *</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="e.g. Engr. Chukwuma Okeke"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Mobile Phone Number *</Text>
            <TextInput
              style={styles.input}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              placeholder="+234 800 000 0000"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Role / Site Title (Optional)</Text>
            <TextInput
              style={styles.input}
              value={roleTitle}
              onChangeText={setRoleTitle}
              placeholder="e.g. Senior Site Civil Engineer"
              placeholderTextColor="#94A3B8"
            />
          </View>
        </View>

        {/* Hardware Security Card */}
        <View style={styles.securityBox}>
          <Text style={styles.securityTitle}>Hardware Identity Binding</Text>
          <Text style={styles.securityBody}>
            Your profile and cryptographic hardware key are stored strictly in device secure storage
            (expo-secure-store). They are automatically attached when you join projects.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Submit Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryButton, isSaving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>
            {isSaving ? 'Saving Profile...' : 'Save Profile & Continue'}
          </Text>
        </TouchableOpacity>
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
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metaBadge: {
    fontSize: 11,
    color: '#93C5FD',
    fontWeight: '600',
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 12,
    color: '#BFDBFE',
    marginTop: 4,
    lineHeight: 18,
  },
  body: {
    padding: 16,
    gap: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#0C233C',
    borderWidth: 2,
    borderColor: '#00338D',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  avatarPlusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#00338D',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    marginTop: -2,
  },
  avatarTextContainer: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  helperText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  linkText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#00338D',
    marginTop: 4,
  },
  inputGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 5,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
  },
  securityBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  securityTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#00338D',
    marginBottom: 4,
  },
  securityBody: {
    fontSize: 11,
    color: '#1E3A8A',
    lineHeight: 16,
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  primaryButton: {
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
});

