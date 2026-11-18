import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { createNavigationContainerRef } from '@react-navigation/native';
import {
  clearSessionEnded,
  getSessionEnded,
  subscribeSessionEnded,
  type SessionEndedState,
} from '../../config/sessionState';
import { useProfile } from '../../context/ProfileContext';
import { PrimaryButton } from '../inputs/Buttons';
import type { RootStackParamList } from '../../navigation/types';

/** Passed to NavigationContainer so the overlay can reset navigation from outside a screen. */
export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();

const COPY: Record<SessionEndedState['reason'], { title: string; body: string }> = {
  SESSION_REVOKED: {
    title: 'Access to this project was removed',
    body: 'The project team revoked this device. Anything you captured offline is still saved on this phone. Ask the project team for a new join code to continue.',
  },
  TENANT_SUSPENDED: {
    title: 'This workspace is suspended',
    body: 'The organisation running this project has been suspended. Your offline captures are still saved on this phone. Contact the project team.',
  },
  UNAUTHORIZED: {
    title: 'Your session has ended',
    body: 'This device is no longer signed in to the project. Your offline captures are still saved on this phone. Join again with your project code.',
  },
};

/**
 * Shown when the API reports the field session is no longer valid. Sync is paused until the
 * user re-joins; this is deliberately not treated as "offline".
 */
export const SessionEndedOverlay: React.FC = () => {
  const [ended, setEnded] = useState<SessionEndedState | null>(getSessionEnded());
  const { clearSession } = useProfile();

  useEffect(() => subscribeSessionEnded(setEnded), []);

  if (!ended) return null;
  const copy = COPY[ended.reason];

  const handleRejoin = async () => {
    await clearSession();
    clearSessionEnded();
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.reset({ index: 0, routes: [{ name: 'EnterCode' }] });
    }
  };

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <PrimaryButton text="Enter a new project code" onPress={handleRejoin} />
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
    color: '#0C233C',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
});
