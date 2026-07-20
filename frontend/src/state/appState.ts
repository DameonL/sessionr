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

export function useSignal<T>(sig: Signal<T>): T {
  const [val, setVal] = useState(sig.value);
  useEffect(() => {
    return sig.subscribe(setVal);
  }, [sig]);
  return val;
}
