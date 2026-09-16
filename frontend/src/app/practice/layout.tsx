"use client";

import Link from '@/utils/routerCompat';
import { usePathname } from '@/utils/routerCompat';
import { useEffect } from 'react';
import { rememberReturnUrl } from '../../services/returnUrl';
import { currentUserId, useAuthStatus, useSignal } from '../../state/appState';

/**
 * Ear training and interval drills are open to everyone; the tabs built on a
 * personal repertoire are hidden when signed out and gate themselves (see the
 * RequireAuth wrappers on their routes in App.tsx) if reached by URL.
 */
export default function PracticeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const userId = useSignal(currentUserId);
  const status = useAuthStatus();
  const signedIn = !!userId;

  const tab = (href: string, label: string) => (
    <Link href={href} className={pathname === href ? 'toggled' : ''} prefetch={false}>
      {label}
    </Link>
  );

  // Screen wake lock active for the practice pages
  useEffect(() => {
    interface WakeLockSentinel {
      release(): Promise<void>;
    }
    let wakeLock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: {
        request(type: 'screen'): Promise<WakeLockSentinel>;
      };
    };
    if (typeof window !== 'undefined' && nav.wakeLock) {
      nav.wakeLock
        .request('screen')
        .then((lock) => { wakeLock = lock; })
        .catch(() => {});
    }
    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  return (
    <section>
      <h1>Practice Room</h1>

      {status === 'pending' ? (
        // Same blank card RequireAuth shows, so the tabs don't flash between sets.
        <div className="card" style={{ padding: '1.5rem', minHeight: '120px' }} />
      ) : (
        <>
          <div className="detail-controls" style={{ marginBottom: signedIn ? '1.5rem' : '0.5rem', justifyContent: 'center' }}>
            {signedIn && tab('/practice/queue', 'Daily Queue')}
            {signedIn && tab('/practice/sets', 'Medley Sets')}
            {tab('/practice/ear', 'Ear Training')}
            {tab('/practice/intervals', 'Intervals')}
            {signedIn && tab('/practice/session', 'Virtual Session')}
          </div>

          {!signedIn && (
            <p className="tune-meta" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <Link href="/login" prefetch={false} onClick={() => rememberReturnUrl()}>
                Sign in
              </Link>{' '}
              for your daily queue, medley sets and virtual session.
            </p>
          )}

          {children}
        </>
      )}
    </section>
  );
}
