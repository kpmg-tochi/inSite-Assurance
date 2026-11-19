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
  GuidedSelfieCapture,
  IdCardCameraOverlay,
  type GuidedSelfieResult,
  type IdCardCapturePayload,
} from '../components/camera';
import {
  AssuranceCredentialsStep,
  type CredentialsSubmissionPayload,
} from '../components/assurance/AssuranceCredentialsStep';
import { useProfile } from '../context/ProfileContext';
import { useDemoSkipVerificationMutation } from '../queries/auth/useAuthMutations';
import { useResolveNotificationMutation } from '../queries/notifications/useNotificationQueries';
import { saveQueuedAssuranceSubmission } from '../storage/assuranceRepository';
import { requestPushPermissionInContext } from '../services/pushNotificationService';
import type { RootStackParamList } from '../navigation/types';

export interface AssuranceVerificationPackage {
  idDocument: IdCardCapturePayload;
  selfies: GuidedSelfieResult;
  credentials: CredentialsSubmissionPayload;
}

type WizardStep = 'STEP_1_ID' | 'STEP_2_SELFIE' | 'STEP_3_CREDENTIALS';

export const AssuranceVerificationWizard: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AssuranceWizard'>>();
  const resolveNotificationId = route.params?.resolveNotificationId;
  const isPreviewDemo = Boolean(route.params?.isPreviewDemo);
  const { activeContext, activeProjectId, updateActiveContext, addJoinSession, displayName, phoneNumber, pushIdentities, state } =
    useProfile();
  const resolveNotificationMutation = useResolveNotificationMutation(activeProjectId);
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState<WizardStep>('STEP_1_ID');
  const [idPayload, setIdPayload] = useState<IdCardCapturePayload | null>(null);
  const [selfiePayload, setSelfiePayload] = useState<GuidedSelfieResult | null>(null);
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
        selfieFrontUri: pkg.selfies.front.uri,
        selfieLeftUri: pkg.selfies.left.uri,
        selfieRightUri: pkg.selfies.right.uri,
        selfieSet: pkg.selfies.selfieSet,
        regulatoryBody: pkg.credentials.regulatoryBody,
        licenseNumber: pkg.credentials.licenseNumber,
        experienceSummary: pkg.credentials.experienceSummary,
      });
    }
    if (resolveNotificationId) {
      await resolveNotificationMutation
        .mutateAsync(resolveNotificationId)
        .catch(() => {});
    }
    await updateActiveContext({ assuranceStatus: 'PENDING_APPROVAL', rejectionReason: null });
    void requestPushPermissionInContext(pushIdentities);
    navigation.reset({
      index: 0,
      routes: [{ name: 'UnderReview' }],
    });
  };

  const handleSkipDemoVerification = async () => {
    try {
      const joinCode = activeContext?.joinCodeUsed;
      if (!joinCode) throw new Error('This project was not joined with a code.');
      const existing = state.joinSessions.find((j) => j.context.projectId === activeProjectId);
      const result = await skipDemoMutation.mutateAsync({
        payload: {
          joinCode,
          sessionId: activeContext?.sessionId ?? undefined,
          agentFullName: displayName || undefined,
          agentPhoneNumber: phoneNumber || undefined,
        },
        existingJoinToken: existing?.token,
      });

      await addJoinSession(result);
      await updateActiveContext({ assuranceStatus: 'APPROVED' });

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
        <GuidedSelfieCapture
          onCancel={() => setCurrentStep('STEP_1_ID')}
          onCaptured={(result) => {
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
              selfies: selfiePayload,
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
      {activeContext?.assuranceStatus === 'REJECTED' && currentStep === 'STEP_1_ID' && (
        <View style={[styles.rejectedBar, { paddingTop: Math.max(insets.top + 8, 16) }]}>
          <Text style={styles.rejectedTitle}>Your identity check was returned</Text>
          <Text style={styles.rejectedText}>
            {activeContext.rejectionReason || 'The reviewer did not give a reason.'} Please capture your ID and
            selfies again. Your reports stay held until a reviewer approves the new submission.
          </Text>
        </View>
      )}
      <View style={styles.stepContainer}>{renderCurrentStep()}</View>

      {(process.env.EXPO_PUBLIC_DEMO_MODE === "true") && !isPreviewDemo && (
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
  rejectedBar: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  rejectedTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  rejectedText: {
    color: '#FECACA',
    fontSize: 12,
    lineHeight: 17,
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
