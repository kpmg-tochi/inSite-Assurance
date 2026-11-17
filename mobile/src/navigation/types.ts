import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { WbsItemRecord } from '../storage/wbsRepository';

export type RootStackParamList = {
  Landing: undefined;
  Onboarding: undefined;
  EnterCode: undefined;
  AssuranceWizard: { resolveNotificationId?: string; isPreviewDemo?: boolean } | undefined;
  UnderReview: undefined;
  WbsInbox: undefined;
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

