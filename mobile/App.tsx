import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  loadLocalProfile,
  updateLocalProfile,
  LocalUserProfile,
  clearActiveProjectSession,
} from './src/storage/secureProfileStore';
import { registerForPushNotifications } from './src/services/pushNotificationService';
import { WbsItemRecord } from './src/storage/wbsRepository';

// Screens
import { OnboardingProfileScreen } from './src/screens/OnboardingProfileScreen';
import { EnterProjectCodeScreen } from './src/screens/EnterProjectCodeScreen';
import { AssuranceVerificationWizard } from './src/screens/AssuranceVerificationWizard';
import { VerificationUnderReviewScreen } from './src/screens/VerificationUnderReviewScreen';
import { WbsInboxScreen } from './src/screens/WbsInboxScreen';
import { WbsChatThreadScreen } from './src/screens/WbsChatThreadScreen';

// Modals
import { ConfirmAiSummarySheet } from './src/screens/ConfirmAiSummarySheet';
import { ProfileAndProjectsScreen } from './src/screens/ProfileAndProjectsScreen';
import { BacklogReviewModal } from './src/screens/BacklogReviewModal';
import { SpecialIncidentModal } from './src/screens/SpecialIncidentModal';
import { NotificationCenterModal } from './src/screens/NotificationCenterModal';

type ActiveView =
  | 'ONBOARDING'
  | 'ENTER_CODE'
  | 'ASSURANCE_WIZARD'
  | 'UNDER_REVIEW'
  | 'WBS_INBOX'
  | 'WBS_THREAD';

export default function App() {
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<ActiveView>('ENTER_CODE');
  const [selectedWbsItem, setSelectedWbsItem] = useState<WbsItemRecord | null>(null);

  // Modal states
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showBacklogModal, setShowBacklogModal] = useState(false);
  const [showEodConfirmModal, setShowEodConfirmModal] = useState(false);

  // Initialize profile & push notifications
  useEffect(() => {
    async function init() {
      const savedProfile = await loadLocalProfile();
      if (savedProfile) {
        setProfile(savedProfile);
        if (!savedProfile.onboardingCompleted) {
          setCurrentView('ONBOARDING');
        } else if (!savedProfile.activeProjectCode) {
          setCurrentView('ENTER_CODE');
        } else if (
          savedProfile.activeIndependenceTier === 'CONTRACTOR_ENGINEER' &&
          savedProfile.assuranceStatus === 'NOT_SUBMITTED'
        ) {
          setCurrentView('ASSURANCE_WIZARD');
        } else {
          setCurrentView('WBS_INBOX');
        }
      } else {
        setCurrentView('ONBOARDING');
      }

      // Initialize push notifications
      await registerForPushNotifications(savedProfile?.activeSessionToken || undefined);
      setLoading(false);
    }
    init();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00338D" />
      </View>
    );
  }

  const isVerified = profile?.assuranceStatus === 'APPROVED';
  const projectCode = profile?.activeProjectCode || 'LKK-402-CON';
  const userInitials = profile?.fullName
    ? profile.fullName
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'CO';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0C233C" />

      {/* 1. Onboarding Screen */}
      {currentView === 'ONBOARDING' && (
        <OnboardingProfileScreen
          onCompleted={async () => {
            const updated = await loadLocalProfile();
            setProfile(updated);
            setCurrentView('ENTER_CODE');
          }}
        />
      )}

      {/* 2. Enter Project Code Screen */}
      {currentView === 'ENTER_CODE' && (
        <EnterProjectCodeScreen
          userInitials={userInitials}
          onOpenProfile={() => setShowProfileModal(true)}
          onCodeSubmitted={(code, isContractor) => {
            if (isContractor) {
              setCurrentView('ASSURANCE_WIZARD');
            } else {
              setCurrentView('WBS_INBOX');
            }
          }}
        />
      )}

      {/* 3. Assurance Verification Wizard (3 Steps) */}
      {currentView === 'ASSURANCE_WIZARD' && (
        <AssuranceVerificationWizard
          onCancel={() => setCurrentView('ENTER_CODE')}
          onVerificationSubmitted={async () => {
            const updated = await updateLocalProfile({
              assuranceStatus: 'PENDING_APPROVAL',
            });
            setProfile(updated);
            setCurrentView('UNDER_REVIEW');
          }}
        />
      )}

      {/* 4. Verification Under Review (Non-blocking) */}
      {currentView === 'UNDER_REVIEW' && (
        <VerificationUnderReviewScreen
          onDismiss={() => setCurrentView('WBS_INBOX')}
        />
      )}

      {/* 5. Main WBS Chat Inbox */}
      {currentView === 'WBS_INBOX' && (
        <WbsInboxScreen
          projectCode={projectCode}
          userInitials={userInitials}
          isVerified={isVerified}
          onSelectWbsThread={(wbs) => {
            setSelectedWbsItem(wbs);
            setCurrentView('WBS_THREAD');
          }}
          onOpenProfile={() => setShowProfileModal(true)}
          onOpenNotifications={() => setShowNotificationsModal(true)}
          onOpenIncidentModal={() => setShowIncidentModal(true)}
          onOpenBacklogModal={() => setShowBacklogModal(true)}
        />
      )}

      {/* 6. Dedicated WBS Chat Thread */}
      {currentView === 'WBS_THREAD' && selectedWbsItem && (
        <WbsChatThreadScreen
          wbsItem={selectedWbsItem}
          userName={profile?.fullName || 'Engr. Chukwuma Okeke'}
          onBack={() => setCurrentView('WBS_INBOX')}
          onOpenEodConfirmation={() => setShowEodConfirmModal(true)}
        />
      )}

      {/* MODAL: Profile, Active Projects & Demo Persona Switcher */}
      <Modal visible={showProfileModal} animationType="slide">
        <ProfileAndProjectsScreen
          fullName={profile?.fullName || 'Engr. Chukwuma Okeke'}
          roleTitle={profile?.roleTitle || 'Senior Site Civil Engineer'}
          phoneNumber={profile?.phoneNumber || '+234 803 555 0192'}
          hardwareDeviceId={profile?.hardwareDeviceId || 'DEV-HW-IN-SITU-001'}
          activeProjectCode={projectCode}
          assuranceStatus={profile?.assuranceStatus || 'PENDING_APPROVAL'}
          onClose={() => setShowProfileModal(false)}
          onSwitchProject={async (code) => {
            const updated = await updateLocalProfile({ activeProjectCode: code });
            setProfile(updated);
            setShowProfileModal(false);
          }}
          onJoinNewProject={async () => {
            await clearActiveProjectSession();
            setShowProfileModal(false);
            setCurrentView('ENTER_CODE');
          }}
          onApplyPersona={async (persona) => {
            const updated = await updateLocalProfile({
              roleTitle: persona.roleTitle,
              activeIndependenceTier: persona.tier,
              assuranceStatus: persona.assuranceStatus,
            });
            setProfile(updated);
            setShowProfileModal(false);
          }}
        />
      </Modal>

      {/* MODAL: Special Incident & Emergency / Whistleblowing ("!" Button) */}
      <Modal visible={showIncidentModal} animationType="slide">
        <SpecialIncidentModal
          projectId={profile?.activeProjectId || 'proj-lkk-402'}
          sessionToken={profile?.activeSessionToken || 'mock-token'}
          onClose={() => setShowIncidentModal(false)}
          onSubmitted={() => setShowIncidentModal(false)}
        />
      </Modal>

      {/* MODAL: Notification Center */}
      <Modal visible={showNotificationsModal} animationType="slide">
        <NotificationCenterModal
          onClose={() => setShowNotificationsModal(false)}
          onOpenBacklogModal={() => {
            setShowNotificationsModal(false);
            setShowBacklogModal(true);
          }}
          onSelectWbsItem={(id) => {
            setShowNotificationsModal(false);
            setCurrentView('WBS_THREAD');
          }}
        />
      </Modal>

      {/* MODAL: Backlog Review & Confirmation */}
      <Modal visible={showBacklogModal} animationType="slide">
        <BacklogReviewModal
          onClose={() => setShowBacklogModal(false)}
          onBatchConfirmed={() => setShowBacklogModal(false)}
        />
      </Modal>

      {/* MODAL: End of Day AI Summary & Human Sign-off */}
      {selectedWbsItem && (
        <Modal visible={showEodConfirmModal} animationType="slide">
          <ConfirmAiSummarySheet
            wbsItem={selectedWbsItem}
            onCancel={() => setShowEodConfirmModal(false)}
            onConfirmed={async () => {
              setShowEodConfirmModal(false);
            }}
          />
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0C233C',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0C233C',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
