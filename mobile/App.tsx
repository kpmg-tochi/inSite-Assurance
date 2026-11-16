import React from 'react';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileProvider } from './src/context/ProfileContext';
import { RootNavigator } from './src/navigation';
import { toastConfig } from './src/config/toastConfig';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ProfileProvider>
          <StatusBar style="light" />
          <RootNavigator />
          <Toast config={toastConfig} />
        </ProfileProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

registerRootComponent(App);
