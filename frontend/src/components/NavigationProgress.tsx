"use client";

import { useEffect, useState, useRef, Suspense } from 'react';
import { usePathname, useSearchParams } from '@/utils/routerCompat';

let globalStartProgress: () => void = () => {};

export function startNavigationProgress() {
  if (typeof globalStartProgress === 'function') {
    globalStartProgress();
  }
}

function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startProgress = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setVisible(true);
    setProgress(25);

    // Incrementally advance progress to simulate loading feedback
    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 85;
        }
        return prev + Math.random() * 12 + 5;
      });
    }, 120);
  };

  const finishProgress = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 250);
  };

  useEffect(() => {
    globalStartProgress = startProgress;
  }, []);

  // When route or search params change, finish progress
  useEffect(() => {
    finishProgress();
  }, [pathname, searchParams]);

  // Intercept all internal link clicks for immediate feedback (<5ms)
  useEffect(() => {
    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;

      if (!anchor) return;

      const href = anchor.getAttribute('href');
      const targetAttr = anchor.getAttribute('target');

      // Only handle internal navigation links
      if (
        href &&
        href.startsWith('/') &&
        !href.startsWith('//') &&
        targetAttr !== '_blank' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        const currentUrl = window.location.pathname + window.location.search;
        if (href !== currentUrl) {
          startProgress();
        }
      }
    };

    window.addEventListener('click', handleAnchorClick, { capture: true });
    return () => {
      window.removeEventListener('click', handleAnchorClick, { capture: true });
    };
  }, []);

  if (!visible && progress === 0) return null;

  return (
    <div
      className="nav-progress-container"
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        zIndex: 99999,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 200ms ease-in-out',
      }}
    >
      <div
        className="nav-progress-bar"
        style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--accent)',
          boxShadow: '0 0 10px var(--accent), 0 0 5px var(--accent)',
          transition: progress === 100 ? 'width 150ms ease-out' : 'width 200ms ease-in-out',
        }}
      />
    </div>
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
