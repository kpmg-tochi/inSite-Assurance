import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { createNavigationContainerRef } from '@react-navigation/native';
import {
  listSessionEnded,
  sessionEndedFor,
  subscribeSessionEnded,
  type SessionEndedState,
} from '../../config/sessionState';
import { useProfile } from '../../context/ProfileContext';
import { PrimaryButton } from '../inputs/Buttons';
import type { RootStackParamList } from '../../navigation/types';

/** Passed to NavigationContainer so the overlay can reset navigation from outside a screen. */
export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();

const KEPT = 'Anything you captured offline is still saved on this phone.';

const COPY: Record<SessionEndedState['reason'], { title: string; body: string }> = {
  SESSION_REVOKED: {
    title: 'Access to this project was removed',
    body: `The project team revoked this device for this project. ${KEPT}`,
  },
  PROJECT_ACCESS_REMOVED: {
    title: 'You are no longer on this project',
    body: `Your account is no longer assigned to this project. ${KEPT} Ask your administrator if this is a mistake.`,
  },
  TENANT_SUSPENDED: {
    title: 'This workspace is suspended',
    body: `The organisation running this project has been suspended. ${KEPT} Contact the project team.`,
  },
  UNAUTHORIZED: {
    title: 'Your session has ended',
    body: `This device is no longer signed in. ${KEPT}`,
  },
  DEVICE_REVOKED: {
    title: 'This device was revoked',
    body: `Your administrator revoked this device for your account, on every project. ${KEPT}`,
  },
  NO_MOBILE_ACCESS: {
    title: 'Your account has no mobile access',
    body: `Your administrator removed the mobile role from your account. ${KEPT}`,
  },
};

/**
 * Shown when the open project's session is no longer valid. Only that scope is paused: other
 * projects on the device keep syncing. This is deliberately not treated as "offline".
 */
export const SessionEndedOverlay: React.FC = () => {
  const { activeProjectId, activeContext, projects, leaveJoinProject, signOut } = useProfile();
  const [, setVersion] = useState(0);

  useEffect(() => subscribeSessionEnded(() => setVersion((v) => v + 1)), []);

  const ended = activeProjectId
    ? sessionEndedFor(activeProjectId)
    : listSessionEnded().find((s) => s.scope === 'account') ?? null;
  if (!ended) return null;
  const copy = COPY[ended.reason];
  const otherProjects = projects.filter((p) => p.projectId !== activeProjectId && !sessionEndedFor(p.projectId));

  const reset = (name: keyof RootStackParamList) => {
    if (rootNavigationRef.isReady()) rootNavigationRef.reset({ index: 0, routes: [{ name }] });
  };

  const isJoinProject = activeContext?.origin === 'JOIN_CODE' && ended.scope !== 'account';
  const isAccountWide = ended.scope === 'account';

  const primary = isJoinProject
    ? {
        text: 'Join again with a new code',
        onPress: async () => {
          await leaveJoinProject(activeProjectId);
          reset('EnterCode');
        },
      }
    : isAccountWide
      ? {
          text: 'Sign in again',
          onPress: async () => {
            await signOut();
            reset('SignIn');
          },
        }
      : { text: 'Choose another project', onPress: async () => reset('Projects') };

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          {ended.message ? <Text style={styles.detail}>{ended.message}</Text> : null}
          <PrimaryButton text={primary.text} onPress={() => void primary.onPress()} />
          {otherProjects.length > 0 && !(primary.text === 'Choose another project') && (
            <PrimaryButton
              text="Open another project"
              backgroundColor="#FFFFFF"
              textColor="#00715D"
              style={styles.secondary}
              onPress={() => reset('Projects')}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12, 35, 60, 0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#122F2A',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
  secondary: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  detail: {
    fontSize: 12,
    lineHeight: 17,
    color: '#64748B',
  },
});
