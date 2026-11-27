import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VisitResponseAction } from '@insite/shared';

/**
 * Redesign R5 (D-R5.2): the visit app's routes. Every project-scoped screen takes `projectId`;
 * `activeProjectId` only remembers the last opened project (push and notification defaults).
 */
export type RootStackParamList = {
  Landing: undefined;
  /** Pre-provisioned account sign-in (Phase 5). */
  SignIn: undefined;
  /** Forced on first sign-in with a temporary password; also reachable from Settings. */
  ChangePassword: { forced?: boolean } | undefined;
  /** Calendar, the day's visits, my projects (initial route once signed in). */
  Home: undefined;
  Project: { projectId: string };
  /** `visitId`: the local key (server id, or the clientVisitId of an unsent unscheduled visit). */
  Visit: { visitId: string };
  /** One section per screen inside this route (R5c). */
  VisitForm: { visitId: string };
  VisitReview: { visitId: string };
  /**
   * Needs pipeline wave 5: a field verification of a proposed project (no project: access by
   * assignment). The screen (sites, locations, state), its form (one section per screen) and review.
   */
  NeedsVerification: { verificationId: string };
  NeedsVerificationForm: { verificationId: string };
  NeedsVerificationReview: { verificationId: string };
  SiteLog: { projectId: string };
  /** Phase 10: defect tickets after handover. Falls back to the last opened project. */
  Defects: { projectId?: string } | undefined;
  // Modals
  ProfileModal: undefined;
  SettingsModal: undefined;
  NotificationsModal: undefined;
  /** Waiting, failed and held items on this phone (R5e; was the backlog modal). */
  Outbox: undefined;
  VisitRespond: { visitId: string; action: VisitResponseAction };
  UnscheduledVisit: { projectId?: string } | undefined;
  SiteLogEntry: { projectId: string; kind: 'PHOTO' | 'VOICE' | 'NOTE' };
  /** Falls back to the last opened project. */
  IncidentModal: { projectId?: string } | undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
