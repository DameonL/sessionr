"use client";

import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import AuthProvider from '../components/AuthProvider';
import { ToastContainer } from '../components/Toast';
import { ErrorReportModal } from '../components/ErrorReportModal';
import { NavigationProgress } from '../components/NavigationProgress';
import { queryClient } from '../services/queryClient';
import { initSyncManager } from '../services/syncManager';

function triggerSafeReload() {
  if (typeof window === 'undefined') return;
  const lastReload = sessionStorage.getItem('sw_stale_reload_time');
  const now = Date.now();
  if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
    sessionStorage.setItem('sw_stale_reload_time', String(now));
    window.location.reload();
  }
}

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const enableSw = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_SW === 'true';
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && enableSw) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            console.log('PWA Service Worker registered:', reg.scope);
            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('New Service Worker installed, reloading for updated assets...');
                    triggerSafeReload();
                  }
                });
              }
            });
          })
          .catch((err) => console.error('PWA Service Worker registration failed:', err));
      });

      const handleSwMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'STALE_ASSET_404') {
          console.warn('Stale asset 404 message received from Service Worker, refreshing application...');
          triggerSafeReload();
        }
      };

      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    const handleChunkError = (event: PromiseRejectionEvent | ErrorEvent) => {
      const reason = 'reason' in event ? event.reason : event.error;
      const message = reason?.message || (event as ErrorEvent).message || '';
      if (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Loading chunk') ||
        message.includes('Importing a module script failed')
      ) {
        console.warn('Dynamic chunk import failure detected (post-rebuild 404):', message);
        triggerSafeReload();
      }
    };

    window.addEventListener('unhandledrejection', handleChunkError);
    window.addEventListener('error', handleChunkError);

    initSyncManager();

    return () => {
      window.removeEventListener('unhandledrejection', handleChunkError);
      window.removeEventListener('error', handleChunkError);
    };
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
