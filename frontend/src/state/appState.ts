import { useEffect, useState } from 'react';
import type { UserProfile } from '../services/api';

export class Signal<T> {
  private listeners = new Set<(val: T) => void>();
  constructor(private _value: T) {}

  get value() {
    return this._value;
  }

  set value(newVal: T) {
    if (this._value !== newVal) {
      this._value = newVal;
      this.listeners.forEach((l) => l(newVal));
    }
  }

  subscribe(listener: (val: T) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const currentUserId = new Signal('');
export const currentUserProfile = new Signal<UserProfile | null>(null);

export type AuthStatus = 'pending' | 'authenticated' | 'anonymous';
export const authStatus = new Signal<AuthStatus>('pending');

/**
 * How the current 'authenticated' status was arrived at.
 *   'none'      – not signed in (or torn down)
 *   'snapshot'  – optimistically hydrated from localStorage; NOT yet verified
 *   'verified'  – GET /users/me answered on this page load
 *
 * AuthProvider's reconciliation reads this to decide what it is allowed to tear
 * down: an unverified guess may be corrected freely, but a connectivity failure
 * must never be mistaken for a sign-out. See services/authSnapshot.ts.
 */
export type AuthSource = 'none' | 'snapshot' | 'verified';
export const authSource = new Signal<AuthSource>('none');

/**
 * Set when the identity provider has told us the session is over and we cannot
 * fix it silently — the refresh token is gone and either the automatic redirect
 * budget is spent (services/reauthGuard.ts) or a redirect isn't possible here.
 *
 * This exists because "no token" alone is ambiguous: a cold MSAL bootstrap, a
 * stalled refresh and a dead session all produce null, and the first two are
 * transient. Without this flag AuthProvider's background sync treats them all
 * as transient, so an expired session never reaches the definitive-failure
 * branch and the app sits forever on an optimistically-hydrated signed-in UI
 * whose every request fails. Cleared as soon as any token is acquired.
 */
export const sessionExpired = new Signal(false);

type TokenHelper = (forceRefresh?: boolean) => Promise<string | null>;

let tokenHelper: TokenHelper | null = null;
let settleHelperGate: (() => void) | null = null;
const tokenHelperGate = new Promise<void>((resolve) => {
  settleHelperGate = resolve;
});

/**
 * Ceiling on how long a caller waits for AuthProvider's MSAL bootstrap. Kept
 * below AuthProvider's 15s pending-safety timer so a wedged bootstrap surfaces
 * as "signed out" rather than as requests hanging until doFetch's own 20s
 * REQUEST_TIMEOUT_MS piles on top of it.
 */
const TOKEN_HELPER_WAIT_MS = 10_000;

/**
 * Acquires a bearer token, waiting for AuthProvider to install the real helper
 * if it hasn't yet.
 *
 * The wait is the point. Before optimistic hydration, every private-API call
 * was gated behind `authStatus !== 'pending'`, which only flipped after the
 * helper had been registered — so answering `null` before then was safe because
 * it could never happen. Hydration paints the signed-in UI on the first frame,
 * which unblocks those userId-keyed queries hundreds of milliseconds before the
 * PublicClientApplication exists. Answering `null` there would push them into
 * doFetch's `isPrivateApi && !token` branch — UnauthenticatedError for most, a
 * null profile for /users/me, and a silent offline-cache read for GETs — and
 * react-query caches those failures rather than retrying once a token appears.
 */
export async function getBearerToken(forceRefresh = false): Promise<string | null> {
  if (!tokenHelper) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      tokenHelperGate,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TOKEN_HELPER_WAIT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    // Re-read: the helper may have been registered while we were waiting.
    if (!tokenHelper) return null;
  }
  return tokenHelper(forceRefresh);
}

export function setTokenAcquisitionHelper(helper: TokenHelper) {
  tokenHelper = helper;
  settleHelperGate?.();
}

/**
 * Releases anyone waiting on the gate above from a terminal bootstrap path that
 * will never produce a helper (MSAL init failure, the 15s safety timer), so
 * they fail fast instead of sitting out the full ceiling.
 *
 * Idempotent, and it does not *prevent* a helper arriving later —
 * getBearerToken re-reads `tokenHelper` after the race, so only the calls in
 * flight at this instant get null.
 */
export function abandonTokenAcquisition() {
  settleHelperGate?.();
}

export function useSignal<T>(sig: Signal<T>): T {
  const [val, setVal] = useState(sig.value);
  useEffect(() => {
    return sig.subscribe(setVal);
  }, [sig]);
  return val;
}

export const useAuthStatus = () => useSignal(authStatus);

export interface ToastMessage {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

export const activeToasts = new Signal<ToastMessage[]>([]);

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'success', duration = 3000) {
  const id = Math.random().toString(36).substring(2, 9);
  const newToast: ToastMessage = { id, message, type };
  activeToasts.value = [...activeToasts.value, newToast];

  setTimeout(() => {
    activeToasts.value = activeToasts.value.filter((t) => t.id !== id);
  }, duration);
}

/**
 * A persistent, dismissible error surface (unlike toasts, which auto-expire) so
 * the full server response — status, message, and any diagnostic detail/stack —
 * can be read and copied, including on mobile where the network response isn't
 * otherwise reachable.
 */
export interface ErrorReport {
  id: string
  title: string
  status?: number
  message: string
  detail?: string
}

export const activeErrorReport = new Signal<ErrorReport | null>(null);

export function showErrorReport(report: Omit<ErrorReport, 'id'>) {
  const id = Math.random().toString(36).substring(2, 9);
  activeErrorReport.value = { id, ...report };
}

export function dismissErrorReport() {
  activeErrorReport.value = null;
}

/**
 * Classifies an unknown thrown value and, when it represents a real failure,
 * surfaces it in the global error-report modal. Offline-queued and
 * auth-required flows have their own UX and are intentionally ignored so they
 * don't raise an alarming modal.
 */
export function reportError(error: unknown, context?: string) {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (e.offlineQueued || e.unauthenticated) return;
    const status = typeof e.status === 'number' ? (e.status as number) : undefined;
    const message = typeof e.message === 'string' && e.message ? (e.message as string) : 'Unexpected error';
    const detail =
      typeof e.serverDetail === 'string' && e.serverDetail
        ? (e.serverDetail as string)
        : typeof e.body === 'string' && e.body
          ? (e.body as string)
          : undefined;
    showErrorReport({
      title: context ?? (status ? `Request failed (HTTP ${status})` : 'Request failed'),
      status,
      message,
      detail,
    });
    return;
  }
  showErrorReport({ title: context ?? 'Something went wrong', message: String(error) });
}


