"use client";
import { Profile } from '../../views/Profile';
import { RequireAuth } from '../../components/RequireAuth';

export default function Page() {
  return (
    <RequireAuth message="Sign in to edit your profile.">
      <Profile />
    </RequireAuth>
  );
}
