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
import { PublicProfile } from './views/PublicProfile'
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
import { GroupOverviewPanel } from './views/group/GroupOverviewPanel'
import { GroupTunesPanel } from './views/group/GroupTunesPanel'
import { GroupSetsPanel } from './views/group/GroupSetsPanel'
import { GroupRepertoirePanel } from './views/group/GroupRepertoirePanel'
import { GroupMembersPanel } from './views/group/GroupMembersPanel'
import { GroupSettingsPanel } from './views/group/GroupSettingsPanel'
import { GroupActivityPanel } from './views/group/GroupActivityPanel'

// Practice Room & Pages
import PracticeLayout from './app/practice/layout'
import DailyQueuePage from './app/practice/queue/page'
import SessionPage from './app/practice/session/page'
import SetsPage from './app/practice/sets/page'
import EarPage from './app/practice/ear/page'

// Components
import { MsalLoginPanel } from './components/MsalLoginPanel'

function HomePage() {
  const userId = useSignal(currentUserId)
  const status = useAuthStatus()
  if (status === 'pending') {
    return <div className="spinner-row" style={{ minHeight: '80vh' }}><Spinner /></div>
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
  return (
    <RequireAuth message="Sign in to view your custom sets.">
      <SetDetail setId={setId} />
    </RequireAuth>
  )
}

function GroupSetDetailRoute() {
  const { groupSetId } = useParams<{ groupSetId: string }>()
  return (
    <RequireAuth message="Sign in to view group sets.">
      <GroupSetDetail groupSetId={groupSetId} />
    </RequireAuth>
  )
}

function PublicProfileRoute() {
  const { username } = useParams<{ username: string }>()
  return <PublicProfile username={username} />
}

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <NavBar />
        <main>
          <Suspense fallback={<div className="spinner-row" style={{ minHeight: '80vh' }}><Spinner /></div>}>
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
            <Route path="/practice" element={<Navigate to="/practice/queue" replace />} />
            <Route path="/practice/*" element={
              <PracticeLayout>
                <Routes>
                  <Route path="queue" element={<DailyQueuePage />} />
                  <Route path="session" element={<SessionPage />} />
                  <Route path="sets" element={<SetsPage />} />
                  <Route path="ear" element={<EarPage />} />
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
            <Route path="/profile/:username" element={<PublicProfileRoute />} />
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
