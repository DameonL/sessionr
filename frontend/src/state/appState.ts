import { useEffect, useState } from 'react';

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
export const currentUserProfile = new Signal<{ displayName: string; email: string } | null>(null);
export const repertoireSearch = new Signal('');

export let getBearerToken: () => Promise<string | null> = async () => null;

export function setTokenAcquisitionHelper(helper: () => Promise<string | null>) {
  getBearerToken = helper;
}

export function useSignal<T>(sig: Signal<T>): T {
  const [val, setVal] = useState(sig.value);
  useEffect(() => {
    return sig.subscribe(setVal);
  }, [sig]);
  return val;
}

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


