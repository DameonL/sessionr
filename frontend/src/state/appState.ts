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

export let getBearerToken: (forceRefresh?: boolean) => Promise<string | null> = async () => null;

export function setTokenAcquisitionHelper(helper: (forceRefresh?: boolean) => Promise<string | null>) {
  getBearerToken = helper;
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


