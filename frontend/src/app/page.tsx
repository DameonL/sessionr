"use client";
import { Dashboard } from '../views/Dashboard';
import { Landing } from '../views/Landing';
import { currentUserId, useSignal } from '../state/appState';

export default function Page() {
  const userId = useSignal(currentUserId);
  return userId ? <Dashboard /> : <Landing />;
}
