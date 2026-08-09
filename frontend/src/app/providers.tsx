"use client";

import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import AuthProvider from '../components/AuthProvider';
import { ToastContainer } from '../components/Toast';
import { ErrorReportModal } from '../components/ErrorReportModal';
import { NavigationProgress } from '../components/NavigationProgress';
import { queryClient } from '../services/queryClient';
import { initSyncManager } from '../services/syncManager';

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const enableSw = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_SW === 'true';
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && enableSw) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => console.log('PWA Service Worker registered:', reg.scope))
          .catch((err) => console.error('PWA Service Worker registration failed:', err))
      })
    }
    initSyncManager();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NavigationProgress />
        {children}
        <ToastContainer />
        <ErrorReportModal />
      </AuthProvider>
    </QueryClientProvider>
  );
}
