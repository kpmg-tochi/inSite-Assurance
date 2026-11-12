import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import type { FieldAgentSessionProfile } from '@insite/shared';
import type { MobileBaselinePack } from './src/config/apiConfig';
import {
  getCachedBaselinePack,
  getPendingSyncCount,
  LocalCapturedItem,
} from './src/storage/offline-outbox';
import { JoinProjectScreen } from './src/screens/JoinProjectScreen';
import { FieldCaptureScreen } from './src/screens/FieldCaptureScreen';
import { ConfirmExtractionScreen } from './src/screens/ConfirmExtractionScreen';
import { OutboxQueueScreen } from './src/screens/OutboxQueueScreen';

type MobileScreen = 'JOIN' | 'CAPTURE' | 'CONFIRM' | 'OUTBOX';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<MobileScreen>('JOIN');
  const [session, setSession] = useState<FieldAgentSessionProfile | null>(null);
  const [baseline, setBaseline] = useState<MobileBaselinePack | null>(null);
  const [activeCaptureItem, setActiveCaptureItem] =
    useState<LocalCapturedItem | null>(null);

  const handleJoined = (
    newSession: FieldAgentSessionProfile,
    newBaseline: MobileBaselinePack
  ) => {
    setSession(newSession);
    setBaseline(newBaseline);
    setCurrentScreen('CAPTURE');
  };

  const handleLogout = () => {
    setSession(null);
    setBaseline(null);
    setActiveCaptureItem(null);
    setCurrentScreen('JOIN');
  };

  const pendingSync = getPendingSyncCount();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0C233C" />

      {/* Top KPMG Navy App Bar */}
      <View style={styles.appBar}>
        <View style={styles.appBarBrand}>
          <Text style={styles.appBarTitle}>InSite Assurance</Text>
          <Text style={styles.appBarSubtitle}>
            {session ? session.projectCodePrefix : 'Field Client'}
          </Text>
        </View>

        <View style={styles.appBarActions}>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>SQLite Offline-Ready</Text>
          </View>

          {session && (
            <TouchableOpacity style={styles.exitButton} onPress={handleLogout}>
              <Text style={styles.exitButtonText}>Exit</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Active Screen View */}
      <View style={styles.screenContainer}>
        {currentScreen === 'JOIN' && <JoinProjectScreen onJoined={handleJoined} />}

        {currentScreen === 'CAPTURE' && session && baseline && (
          <FieldCaptureScreen
            session={session}
            baseline={baseline}
            pendingSyncCount={pendingSync}
            onOpenOutbox={() => setCurrentScreen('OUTBOX')}
            onProceedToConfirmation={(item) => {
              setActiveCaptureItem(item);
              setCurrentScreen('CONFIRM');
            }}
          />
        )}

        {currentScreen === 'CONFIRM' && activeCaptureItem && (
          <ConfirmExtractionScreen
            captureItem={activeCaptureItem}
            onConfirmed={() => setCurrentScreen('CAPTURE')}
            onCancel={() => setCurrentScreen('CAPTURE')}
          />
        )}

        {currentScreen === 'OUTBOX' && (
          <OutboxQueueScreen onBackToCapture={() => setCurrentScreen('CAPTURE')} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0C233C',
  },
  appBar: {
    backgroundColor: '#0C233C',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  appBarBrand: {
    flex: 1,
  },
  appBarTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  appBarSubtitle: {
    color: '#93C5FD',
    fontSize: 11,
    marginTop: 1,
  },
  appBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5,
  },
  statusText: {
    color: '#A7F3D0',
    fontSize: 10,
    fontWeight: 'bold',
  },
  exitButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  exitButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  screenContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
});

