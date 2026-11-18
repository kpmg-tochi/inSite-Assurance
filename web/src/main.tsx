import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import 'leaflet/dist/leaflet.css';
import './index.css';
import { AuthProvider } from './lib/auth-context';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

function formatQueryErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) {
    return 'Your session has expired or you do not have permission to view this data.';
  }
  if (status === 404) {
    return 'The requested record could not be found.';
  }
  if (status && status >= 500) {
    return 'Something went wrong on the server while loading data. Please try again.';
  }

  const rawMessage = error instanceof Error ? error.message.trim() : '';
  if (!rawMessage) {
    return 'Unable to load data right now. Please try again.';
  }

  const lower = rawMessage.toLowerCase();
  if (
    lower.includes('network error') ||
    lower.includes('err_network') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout')
  ) {
    return 'Unable to reach the server. Check your connection and try again.';
  }

  const looksTechnical =
    rawMessage.length > 140 ||
    lower.includes('prisma') ||
    lower.includes('invocation') ||
    lower.includes('column `') ||
    lower.includes('does not exist') ||
    lower.includes('sql') ||
    lower.includes('c:\\') ||
    lower.includes('/src/');

  if (looksTechnical) {
    return 'Something went wrong while loading data. Please try again.';
  }

  return rawMessage;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      const message = formatQueryErrorMessage(error);
      toast.error(message, { id: message });
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
