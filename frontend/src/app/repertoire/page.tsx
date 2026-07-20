"use client";
import { Repertoire } from '../../views/Repertoire';
import { RequireAuth } from '../../components/RequireAuth';
export default function Page() {
  return (
    <RequireAuth message="Sign in to manage your repertoire.">
      <Repertoire />
    </RequireAuth>
  );
}
