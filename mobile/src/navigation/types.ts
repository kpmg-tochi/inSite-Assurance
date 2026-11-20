import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { WbsItemRecord } from '../storage/wbsRepository';

export type RootStackParamList = {
  Landing: undefined;
  /** Pre-provisioned account sign-in (Phase 5). */
  SignIn: undefined;
  /** Forced on first sign-in with a temporary password; also reachable from Settings. */
  ChangePassword: { forced?: boolean } | undefined;
  /** Every project on the device, with pending-sync counts; tap to switch. */
  Projects: undefined;
  Onboarding: undefined;
  EnterCode: undefined;
  AssuranceWizard: { resolveNotificationId?: string; isPreviewDemo?: boolean } | undefined;
  UnderReview: undefined;
  WbsInbox: undefined;
  /** Phase 10: defect tickets after handover (contractor fixes, verifier checks). */
  Defects: undefined;
  /** Phase 14: the checklist site inspection flow (resumes an open draft). */
  Inspection: undefined;
  /** Phase 14: inspection findings (contractor fixes its own; verifiers record fixes). */
  InspectionFindings: undefined;
  WbsThread: {
    wbsItem: WbsItemRecord;
    activeQueryNotificationId?: string;
    queryPrompt?: string;
    workdayReportId?: string;
    reportQueryId?: string;
  };
  ProfileModal: undefined;
  SettingsModal: undefined;
  IncidentModal: undefined;
  NotificationsModal: undefined;
  BacklogModal: { resolveNotificationId?: string } | undefined;
  EodConfirmModal: {
    wbsItem: WbsItemRecord;
    resolveNotificationId?: string;
    workdayReportId?: string;
    reportQueryId?: string;
    initialSummary?: string;
    initialQuantity?: number;
    initialUnit?: string;
  };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

