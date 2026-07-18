import { Router, Route } from 'preact-iso'
import { Dashboard } from './pages/Dashboard.tsx'
import { Repertoire } from './pages/Repertoire.tsx'
import { TuneDetail } from './pages/TuneDetail.tsx'
import { SetDetail } from './pages/SetDetail.tsx'
import { SetBuilder } from './pages/SetBuilder.tsx'
import { PracticeRoom } from './pages/PracticeRoom.tsx'

export function App() {
  return (
    <>
      <nav class="app-nav">
        <a href="/">Dashboard</a>
        <a href="/repertoire">Repertoire</a>
        <a href="/sets">Set Builder</a>
        <a href="/practice">Practice Room</a>
      </nav>
      <main>
        <Router>
          <Route path="/" component={Dashboard} />
          <Route path="/repertoire" component={Repertoire} />
          <Route path="/tune/:userTuneId" component={TuneDetail} />
          <Route path="/sets" component={SetBuilder} />
          <Route path="/set/:setId" component={SetDetail} />
          <Route path="/practice" component={PracticeRoom} />
          <Route default component={NotFound} />
        </Router>
      </main>
    </>
  )
}

function NotFound() {
  return <p>Page not found.</p>
}
