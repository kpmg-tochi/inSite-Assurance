import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { updateLocalProfile } from '../storage/secureProfileStore';

interface Props {
  fullName: string;
  roleTitle?: string;
  phoneNumber: string;
  hardwareDeviceId: string;
  activeProjectCode: string;
  assuranceStatus: string;
  onClose: () => void;
  onSwitchProject: (code: string) => void;
  onJoinNewProject: () => void;
  onApplyPersona: (persona: {
    roleTitle: string;
    tier: string;
    assuranceStatus: 'PENDING_APPROVAL' | 'APPROVED';
  }) => void;
}

export const ProfileAndProjectsScreen: React.FC<Props> = ({
  fullName,
  roleTitle = 'Senior Site Civil Engineer',
  phoneNumber,
  hardwareDeviceId,
  activeProjectCode,
  assuranceStatus,
  onClose,
  onSwitchProject,
  onJoinNewProject,
  onApplyPersona,
}) => {
  const isVerified = assuranceStatus === 'APPROVED';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>
              {isVerified ? 'Assurance Verified' : 'Verification Pending'}
            </Text>
          </View>
        </View>

        {/* User Card */}
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>CO</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{fullName}</Text>
            <Text style={styles.userRole}>{roleTitle}</Text>
            <Text style={styles.userPhone}>{phoneNumber}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Device Binding Box */}
        <View style={styles.deviceBox}>
          <Text style={styles.deviceTitle}>Hardware Identity Binding</Text>
          <Text style={styles.deviceIdText}>{hardwareDeviceId}</Text>
          <Text style={styles.deviceSub}>
            Private key stored locally in expo-secure-store. Bound to all offline captures.
          </Text>
        </View>

        {/* Section 1: Active Project Switcher */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Facility Workspaces</Text>
          <Text style={styles.sectionSubtitle}>
            Switch active project or enter a join code for an additional facility.
          </Text>

          {/* Project 1 (Active) */}
          <TouchableOpacity
            style={[styles.projectCard, styles.projectCardActive]}
            activeOpacity={0.8}
          >
            <View style={styles.projectTop}>
              <Text style={styles.projectCode}>LKK-402</Text>
              <View style={styles.activePill}>
                <Text style={styles.activePillText}>Active Facility</Text>
              </View>
            </View>
            <Text style={styles.projectName}>Lekki-Epe Expressway Dualization Corridor</Text>
            <Text style={styles.projectMeta}>Lagos State · Linear Corridor (14.2 km)</Text>
          </TouchableOpacity>

          {/* Project 2 */}
          <TouchableOpacity
            style={styles.projectCard}
            onPress={() => {
              onSwitchProject('ABJ-105-CON');
              Alert.alert('Workspace Switched', 'Active project set to ABJ-105.');
            }}
            activeOpacity={0.7}
          >
            <View style={styles.projectTop}>
              <Text style={styles.projectCode}>ABJ-105</Text>
              <View style={styles.inactivePill}>
                <Text style={styles.inactivePillText}>Switch</Text>
              </View>
            </View>
            <Text style={styles.projectName}>Abuja Light Rail Phase 2 Infrastructure</Text>
            <Text style={styles.projectMeta}>FCT Abuja · Radial Geofence (450m)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.joinNewButton}
            onPress={onJoinNewProject}
            activeOpacity={0.8}
          >
            <Text style={styles.joinNewButtonText}>+ Join Another Facility Code</Text>
          </TouchableOpacity>
        </View>

        {/* Section 2: Demo Persona Switcher */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Demo Scenario Switcher</Text>
          <Text style={styles.sectionSubtitle}>
            Toggle between roles to test unverified backlog queuing vs. certified monitor workflows.
          </Text>

          {/* Persona 1: Contractor Unverified */}
          <TouchableOpacity
            style={styles.personaCard}
            onPress={() =>
              onApplyPersona({
                roleTitle: 'Contractor Site Engineer (Unverified)',
                tier: 'CONTRACTOR_ENGINEER',
                assuranceStatus: 'PENDING_APPROVAL',
              })
            }
            activeOpacity={0.7}
          >
            <View style={styles.personaRow}>
              <View>
                <Text style={styles.personaName}>Contractor Engineer (Pending Review)</Text>
                <Text style={styles.personaDesc}>
                  Logs queue in local backlog; zero AI cost incurred until approved.
                </Text>
              </View>
              <Text style={styles.personaArrow}>→</Text>
            </View>
          </TouchableOpacity>

          {/* Persona 2: Contractor Approved */}
          <TouchableOpacity
            style={styles.personaCard}
            onPress={() =>
              onApplyPersona({
                roleTitle: 'Senior Site Civil Engineer (COREN Verified)',
                tier: 'CONTRACTOR_ENGINEER',
                assuranceStatus: 'APPROVED',
              })
            }
            activeOpacity={0.7}
          >
            <View style={styles.personaRow}>
              <View>
                <Text style={styles.personaName}>Contractor Engineer (Verified)</Text>
                <Text style={styles.personaDesc}>
                  COREN verified; live AI summary parsing and full sync enabled.
                </Text>
              </View>
              <Text style={styles.personaArrow}>→</Text>
            </View>
          </TouchableOpacity>

          {/* Persona 3: Independent Clerk of Works */}
          <TouchableOpacity
            style={styles.personaCard}
            onPress={() =>
              onApplyPersona({
                roleTitle: 'Independent Resident Clerk of Works (Tier 2)',
                tier: 'INDEPENDENT_RESIDENT',
                assuranceStatus: 'APPROVED',
              })
            }
            activeOpacity={0.7}
          >
            <View style={styles.personaRow}>
              <View>
                <Text style={styles.personaName}>Clerk of Works (Independent)</Text>
                <Text style={styles.personaDesc}>
                  Tier 2 assurance weight (0.85); daily resident inspections.
                </Text>
              </View>
              <Text style={styles.personaArrow}>→</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeText: {
    fontSize: 13,
    color: '#93C5FD',
    fontWeight: '700',
  },
  statusBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#00338D',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  userRole: {
    fontSize: 12,
    color: '#BFDBFE',
    marginTop: 2,
  },
  userPhone: {
    fontSize: 11,
    color: '#93C5FD',
    marginTop: 2,
  },
  body: {
    padding: 16,
    gap: 16,
  },
  deviceBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    gap: 3,
  },
  deviceTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00338D',
  },
  deviceIdText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0C233C',
  },
  deviceSub: {
    fontSize: 10,
    color: '#1E3A8A',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#64748B',
  },
  projectCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  projectCardActive: {
    borderColor: '#00338D',
    borderWidth: 1.5,
  },
  projectTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectCode: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0C233C',
  },
  activePill: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  inactivePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  inactivePillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  projectName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  projectMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  joinNewButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  joinNewButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00338D',
  },
  personaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  personaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  personaName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  personaDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    maxWidth: 260,
  },
  personaArrow: {
    fontSize: 16,
    color: '#00338D',
    fontWeight: '700',
  },
});

