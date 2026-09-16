import React, { Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import Providers from './app/providers'
import { NavBar } from './components/NavBar'
import { RequireAuth } from './components/RequireAuth'
import { currentUserId, useAuthStatus, useSignal } from './state/appState'
import { Spinner } from './components/Spinner'

// Views
import { Dashboard } from './views/Dashboard'
import { GroupSetDetail } from './views/GroupSetDetail'
import { Groups } from './views/Groups'
import { Landing } from './views/Landing'
import { ModeratorView } from './views/ModeratorView'
import { NotFound } from './views/NotFound'
import { Profile } from './views/Profile'
import { Repertoire } from './views/Repertoire'
import { SetBuilder } from './views/SetBuilder'
import { SetDetail } from './views/SetDetail'
import { TuneDetail } from './views/TuneDetail'
import { TuneLibraryDetail } from './views/TuneLibraryDetail'

// Tune Library Pages
import TunesSearchPage from './app/tunes/page'
import TunesPopularPage from './app/tunes/popular/page'
import TunesNewestPage from './app/tunes/newest/page'

// Tune Identifier
import IdentifyPage from './app/identify/page'

// Group Panels & Layout
import GroupDetailLayout from './app/group/[groupId]/layout'

// Public Profile Panels & Layout
import PublicProfileLayout from './app/profile/[username]/layout'
import { ProfileOverviewPanel } from './views/profile/ProfileOverviewPanel'
import { ProfileSetsPanel } from './views/profile/ProfileSetsPanel'
import { ProfileTunesPanel } from './views/profile/ProfileTunesPanel'
import { GroupOverviewPanel } from './views/group/GroupOverviewPanel'
import { GroupTunesPanel } from './views/group/GroupTunesPanel'
import { GroupSetsPanel } from './views/group/GroupSetsPanel'
import { GroupRepertoirePanel } from './views/group/GroupRepertoirePanel'
import { GroupMembersPanel } from './views/group/GroupMembersPanel'
import { GroupSettingsPanel } from './views/group/GroupSettingsPanel'
import { GroupActivityPanel } from './views/group/GroupActivityPanel'

// Practice Room & Pages
import PracticeLayout from './app/practice/layout'
import PracticeIndexRedirect from './app/practice/page'
import DailyQueuePage from './app/practice/queue/page'
import SessionPage from './app/practice/session/page'
import SetsPage from './app/practice/sets/page'
import EarPage from './app/practice/ear/page'
import IntervalsPage from './app/practice/intervals/page'

// Components
import { MsalLoginPanel } from './components/MsalLoginPanel'

function HomePage() {
  const userId = useSignal(currentUserId)
  const status = useAuthStatus()
  if (status === 'pending') {
    return <div className="spinner-row" style={{ minHeight: '80dvh' }}><Spinner /></div>
  }
  return userId ? <Dashboard /> : <Landing />
}

function TuneDetailRoute() {
  const { userTuneId } = useParams<{ userTuneId: string }>()
  return (
    <RequireAuth message="Sign in to view your personal repertoire.">
      <TuneDetail userTuneId={userTuneId} />
    </RequireAuth>
  )
}

function TuneLibraryDetailRoute() {
  const { tuneId } = useParams<{ tuneId: string }>()
  return <TuneLibraryDetail tuneId={tuneId} />
}

function SetDetailRoute() {
  const { setId } = useParams<{ setId: string }>()
  return <SetDetail setId={setId} />
}

function GroupSetDetailRoute() {
  const { groupSetId } = useParams<{ groupSetId: string }>()
  return (
    <RequireAuth message="Sign in to view group sets.">
      <GroupSetDetail groupSetId={groupSetId} />
    </RequireAuth>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <NavBar />
        <main>
          <Suspense fallback={<div className="spinner-row" style={{ minHeight: '80dvh' }}><Spinner /></div>}>
            <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<MsalLoginPanel />} />
            <Route
              path="/repertoire"
              element={
                <RequireAuth message="Sign in to manage your repertoire.">
                  <Repertoire />
                </RequireAuth>
              }
            />
            <Route path="/tune/:userTuneId" element={<TuneDetailRoute />} />

            {/* Tune Library */}
            <Route path="/tunes" element={<TunesSearchPage />} />
            <Route path="/tunes/newest" element={<TunesNewestPage />} />
            <Route path="/tunes/popular" element={<TunesPopularPage />} />
            <Route path="/tunes/:tuneId" element={<TuneLibraryDetailRoute />} />

            {/* Tune Identifier */}
            <Route path="/identify" element={<IdentifyPage />} />

            {/* Sets */}
            <Route
              path="/sets"
              element={
                <RequireAuth message="Sign in to build and view tune sets.">
                  <SetBuilder />
                </RequireAuth>
              }
            />
            <Route path="/set/:setId" element={<SetDetailRoute />} />

            {/* Practice Room */}
            <Route path="/practice" element={<PracticeIndexRedirect />} />
            <Route path="/practice/*" element={
              <PracticeLayout>
                <Routes>
                  {/* Ear training and intervals are open to everyone; these three
                      are built on the player's own repertoire. */}
                  <Route path="queue" element={
                    <RequireAuth message="Sign in to get a daily practice queue built from your repertoire.">
                      <DailyQueuePage />
                    </RequireAuth>
                  } />
                  <Route path="session" element={
                    <RequireAuth message="Sign in to play a virtual session from your repertoire.">
                      <SessionPage />
                    </RequireAuth>
                  } />
                  <Route path="sets" element={
                    <RequireAuth message="Sign in to practice medley sets from your repertoire.">
                      <SetsPage />
                    </RequireAuth>
                  } />
                  <Route path="ear" element={<EarPage />} />
                  <Route path="intervals" element={<IntervalsPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </PracticeLayout>
            } />

            {/* Groups */}
            <Route
              path="/groups"
              element={
                <RequireAuth message="Sign in to join or manage traditional music groups.">
                  <Groups />
                </RequireAuth>
              }
            />
            <Route path="/group/:groupId/*" element={
              <GroupDetailLayout>
                <Routes>
                  <Route path="" element={<GroupOverviewPanel />} />
                  <Route path="tunes" element={<GroupTunesPanel />} />
                  <Route path="sets" element={<GroupSetsPanel />} />
                  <Route path="repertoire" element={<GroupRepertoirePanel />} />
                  <Route path="activity" element={<GroupActivityPanel />} />
                  <Route path="members" element={<GroupMembersPanel />} />
                  <Route path="settings" element={<GroupSettingsPanel />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </GroupDetailLayout>
            } />
            <Route path="/groupset/:groupSetId" element={<GroupSetDetailRoute />} />

            {/* Profile & Moderator */}
            <Route
              path="/profile"
              element={
                <RequireAuth message="Sign in to view your profile and settings.">
                  <Profile />
                </RequireAuth>
              }
            />
            <Route path="/profile/:username/*" element={
              <PublicProfileLayout>
                <Routes>
                  <Route path="" element={<ProfileOverviewPanel />} />
                  <Route path="tunes" element={<ProfileTunesPanel />} />
                  <Route path="sets" element={<ProfileSetsPanel />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </PublicProfileLayout>
            } />
            <Route
              path="/moderator"
              element={
                <RequireAuth message="Sign in to access moderator tools.">
                  <ModeratorView />
                </RequireAuth>
              }
            />

            {/* Catch-all: show a branded 404 rather than silently bouncing to home */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </main>
      </Providers>
    </BrowserRouter>
  )
}

export default App
