import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  onDismiss: () => void;
}

export const VerificationUnderReviewScreen: React.FC<Props> = ({ onDismiss }) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>InSite Assurance</Text>
        <Text style={styles.headerSubtitle}>Contractor Identity &amp; Competence</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.card}>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>Under Review</Text>
          </View>

          <Text style={styles.title}>Submission Under Review</Text>
          <Text style={styles.subtitle}>
            Your government ID photo, facial liveness signature, and COREN credentials have been
            submitted to the Independent Project Monitor for facility verification.
          </Text>

          <View style={styles.benefitBox}>
            <Text style={styles.benefitTitle}>Non-Blocking Field Access</Text>
            <Text style={styles.benefitText}>
              You do not need to wait for approval to begin your site day! You can proceed directly to
              the WBS chat inbox, snap photos, and record notes.
            </Text>
          </View>

          <View style={styles.costBox}>
            <Text style={styles.costTitle}>Local Backlog Protection</Text>
            <Text style={styles.costText}>
              To prevent unauthorized baseline updates and preserve AI compute, your daily logs will
              queue safely on this device. When approved, a push notification will alert you to review
              and confirm your submission backlog.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={onDismiss}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Dismiss &amp; Proceed to WBS Inbox</Text>
          </TouchableOpacity>
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
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#93C5FD',
    marginTop: 2,
  },
  body: {
    flex: 1,
    padding: 20,
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
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
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
  benefitBox: {
    width: '100%',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  benefitTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00338D',
    marginBottom: 3,
  },
  benefitText: {
    fontSize: 11,
    color: '#1E3A8A',
    lineHeight: 16,
  },
  costBox: {
    width: '100%',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  costTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 3,
  },
  costText: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

