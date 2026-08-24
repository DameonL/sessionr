"use client";

import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import AuthProvider from '../components/AuthProvider';
import { ToastContainer } from '../components/Toast';
import { ErrorReportModal } from '../components/ErrorReportModal';
import { NavigationProgress } from '../components/NavigationProgress';
import { PwaUpdatePrompt } from '../components/PwaUpdatePrompt';
import { queryClient } from '../services/queryClient';
import { initSyncManager } from '../services/syncManager';

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Service worker registration lives in <PwaUpdatePrompt />, which owns the
    // vite-plugin-pwa lifecycle (registration plus the update-available prompt).
    initSyncManager();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NavigationProgress />
        {children}
        <ToastContainer />
        <ErrorReportModal />
        <PwaUpdatePrompt />
      </AuthProvider>
    </QueryClientProvider>
  );
}
