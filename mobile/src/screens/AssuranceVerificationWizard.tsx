import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  FaceLivenessCameraOverlay,
  IdCardCameraOverlay,
  type FaceLivenessResult,
  type IdCardCapturePayload,
} from '../components/camera';
import {
  AssuranceCredentialsStep,
  type CredentialsSubmissionPayload,
} from '../components/assurance/AssuranceCredentialsStep';
import { useProfile } from '../context/ProfileContext';
import { IS_DEMO_MODE } from '../config/demoMode';
import { useDemoSkipVerificationMutation } from '../queries/auth/useAuthMutations';
import { useResolveNotificationMutation } from '../queries/notifications/useNotificationQueries';
import { saveQueuedAssuranceSubmission } from '../storage/assuranceRepository';
import { triggerOfflineSync } from '../storage/syncEngine';
import type { RootStackParamList } from '../navigation/types';

export interface AssuranceVerificationPackage {
  idDocument: IdCardCapturePayload;
  selfieLiveness: FaceLivenessResult;
  credentials: CredentialsSubmissionPayload;
}

type WizardStep = 'STEP_1_ID' | 'STEP_2_SELFIE' | 'STEP_3_CREDENTIALS';

export const AssuranceVerificationWizard: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AssuranceWizard'>>();
  const resolveNotificationId = route.params?.resolveNotificationId;
  const isPreviewDemo = Boolean(route.params?.isPreviewDemo);
  const { profile, projectCode, activeProjectId, updateProfile } = useProfile();
  const resolveNotificationMutation = useResolveNotificationMutation(activeProjectId);
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState<WizardStep>('STEP_1_ID');
  const [idPayload, setIdPayload] = useState<IdCardCapturePayload | null>(null);
  const [selfiePayload, setSelfiePayload] = useState<FaceLivenessResult | null>(null);
  const skipDemoMutation = useDemoSkipVerificationMutation();
  const isSkippingDemo = skipDemoMutation.isPending;

  const handleVerificationSubmitted = async (
    pkg?: AssuranceVerificationPackage
  ) => {
    // Preview-only demo mode shows the full capture flow without altering profile or backend state
    if (isPreviewDemo) {
      Toast.show({
        type: 'info',
        props: {
          title: 'Verification Demo Complete',
          message: 'Preview finished cleanly — no verification data was submitted or altered.',
        },
      });
      navigation.goBack();
      return;
    }

    if (pkg) {
      await saveQueuedAssuranceSubmission({
        projectId: activeProjectId,
        idType: pkg.idDocument.idType,
        idPhotoUri: pkg.idDocument.capture.uri,
        selfieFrontUri: pkg.selfieLiveness.frontCapture.uri,
        selfieLeftUri: pkg.selfieLiveness.leftCapture.uri,
        selfieRightUri: pkg.selfieLiveness.rightCapture.uri,
        livenessVerification: pkg.selfieLiveness.livenessVerification,
        regulatoryBody: pkg.credentials.regulatoryBody,
        licenseNumber: pkg.credentials.licenseNumber,
        experienceSummary: pkg.credentials.experienceSummary,
      });
      triggerOfflineSync('assurance_submitted').catch(() => {});
    }
    if (resolveNotificationId) {
      await resolveNotificationMutation
        .mutateAsync(resolveNotificationId)
        .catch(() => {});
    }
    await updateProfile({ assuranceStatus: 'PENDING_APPROVAL' });
    navigation.reset({
      index: 0,
      routes: [{ name: 'UnderReview' }],
    });
  };

  const handleSkipDemoVerification = async () => {
    try {
      const targetCode = profile?.activeProjectCode || projectCode;
      const result = await skipDemoMutation.mutateAsync({
        joinCode: targetCode,
        sessionId: profile?.activeSessionId ?? undefined,
        agentFullName: profile?.fullName || undefined,
        agentPhoneNumber: profile?.phoneNumber || undefined,
        deviceId: profile?.hardwareDeviceId || undefined,
      });

      await updateProfile({
        activeProjectId: result.sessionProfile.projectId,
        activeProjectCode: result.sessionProfile.joinCodeUsed,
        activeSessionId: result.sessionProfile.sessionId,
        activeSessionToken: result.accessToken,
        activeIndependenceTier: result.sessionProfile.independenceTier,
        assuranceStatus: 'APPROVED',
      });

      Toast.show({
        type: 'info',
        props: {
          title: 'Demo Mode Active',
          message: `Linked to ${result.sessionProfile.projectCodePrefix} without verification.`,
        },
      });

      navigation.reset({
        index: 0,
        routes: [{ name: 'WbsInbox' }],
      });
    } catch (err: any) {
      Toast.show({
        type: 'error',
        props: {
          title: 'Demo Link Failed',
          message:
            err?.message ||
            'Unable to reach server to skip verification. Ensure backend API is running.',
        },
      });
    }
  };

  const renderCurrentStep = () => {
    if (currentStep === 'STEP_1_ID') {
      return (
        <IdCardCameraOverlay
          initialIdType={idPayload?.idType}
          onCancel={() => navigation.goBack()}
          onIdCaptured={(payload) => {
            setIdPayload(payload);
            setCurrentStep('STEP_2_SELFIE');
          }}
        />
      );
    }

    if (currentStep === 'STEP_2_SELFIE') {
      return (
        <FaceLivenessCameraOverlay
          onCancel={() => setCurrentStep('STEP_1_ID')}
          onLivenessVerified={(result) => {
            setSelfiePayload(result);
            setCurrentStep('STEP_3_CREDENTIALS');
          }}
        />
      );
    }

    return (
      <AssuranceCredentialsStep
        onBack={() => setCurrentStep('STEP_2_SELFIE')}
        onSubmit={(credentials) => {
          if (idPayload && selfiePayload) {
            handleVerificationSubmitted({
              idDocument: idPayload,
              selfieLiveness: selfiePayload,
              credentials,
            });
          } else {
            handleVerificationSubmitted();
          }
        }}
      />
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.stepContainer}>{renderCurrentStep()}</View>

      {IS_DEMO_MODE && !isPreviewDemo && (
        <View
          style={[
            styles.demoBar,
            { paddingBottom: Math.max(insets.bottom + 8, 14) },
          ]}
        >
          <TouchableOpacity
            style={[styles.demoSkipButton, isSkippingDemo && { opacity: 0.7 }]}
            onPress={handleSkipDemoVerification}
            disabled={isSkippingDemo}
            activeOpacity={0.85}
          >
            {isSkippingDemo ? (
              <ActivityIndicator size="small" color="#FDE68A" />
            ) : (
              <Feather name="fast-forward" size={14} color="#FDE68A" />
            )}
            <Text style={styles.demoSkipText}>
              {isSkippingDemo
                ? 'Linking to Project (Demo Mode)...'
                : 'Skip Verification & Enter Inbox (Demo Only)'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050811',
  },
  stepContainer: {
    flex: 1,
  },
  demoBar: {
    backgroundColor: '#0C233C',
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.2)',
  },
  demoSkipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(253, 230, 138, 0.45)',
  },
  demoSkipText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '700',
  },
});
