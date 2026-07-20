"use client";
import { SetBuilder } from '../../views/SetBuilder';
import { RequireAuth } from '../../components/RequireAuth';
export default function Page() {
  return (
    <RequireAuth message="Sign in to build medley sets from your repertoire.">
      <SetBuilder />
    </RequireAuth>
  );
}
