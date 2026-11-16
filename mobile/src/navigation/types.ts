import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { WbsItemRecord } from '../storage/wbsRepository';

export type RootStackParamList = {
  Landing: undefined;
  Onboarding: undefined;
  EnterCode: undefined;
  AssuranceWizard: undefined;
  UnderReview: undefined;
  WbsInbox: undefined;
  WbsThread: { wbsItem: WbsItemRecord };
  ProfileModal: undefined;
  IncidentModal: undefined;
  NotificationsModal: undefined;
  BacklogModal: undefined;
  EodConfirmModal: { wbsItem: WbsItemRecord };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

