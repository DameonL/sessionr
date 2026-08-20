"use client";

import Link from '@/utils/routerCompat';
import { usePathname } from '@/utils/routerCompat';
import { useEffect } from 'react';
import { RequireAuth } from '../../components/RequireAuth';

export default function PracticeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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

      <RequireAuth message="Sign in to use the Practice Room — your daily queue, medley sets, and ear training are tied to your personal repertoire. (Want to just play a tune? Try the Tune Library.)">
        <div className="detail-controls" style={{ marginBottom: '1.5rem', justifyContent: 'center' }}>
          <Link href="/practice/queue" className={pathname === '/practice/queue' ? 'toggled' : ''} prefetch={false}>
            📋 Daily Queue
          </Link>
          <Link href="/practice/sets" className={pathname === '/practice/sets' ? 'toggled' : ''} prefetch={false}>
            🎛 Medley Sets
          </Link>
          <Link href="/practice/ear" className={pathname === '/practice/ear' ? 'toggled' : ''} prefetch={false}>
            👂 Ear Training
          </Link>
          <Link href="/practice/session" className={pathname === '/practice/session' ? 'toggled' : ''} prefetch={false}>
            🎻 Virtual Session
          </Link>
        </div>

        {children}
      </RequireAuth>
    </section>
  );
}
