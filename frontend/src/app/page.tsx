"use client";
import { Dashboard } from '../views/Dashboard';
import { Landing } from '../views/Landing';
import { currentUserId, useAuthStatus, useSignal } from '../state/appState';

export default function Page() {
  const userId = useSignal(currentUserId);
  const status = useAuthStatus();
  if (status === 'pending') return <div style={{ minHeight: '100dvh' }} />;
  return userId ? <Dashboard /> : <Landing />;
}
