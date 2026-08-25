import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SetPlayer } from '../src/components/SetPlayer'
import '../src/index.css'

const ABC = `X:1
T:Harness Reel
M:4/4
L:1/8
K:D
|:DEFG ABcd|efge dBAF|DEFG ABcd|1 efdB A2FA:|2 efdB A2D2|]`

const ABC2 = `X:1
T:Second Tune
M:6/8
L:1/8
K:G
|:GAB d2B|ABA AGE|GAB d2B|1 dBA G2E:|2 dBA G3|]`

const isSet = new URLSearchParams(location.search).has('set')
const items = isSet
  ? [
      { userTuneId: 'h1', title: 'Harness Reel', abc: ABC, repetitions: 2 },
      { userTuneId: 'h2', title: 'Second Tune', abc: ABC2, repetitions: 2 },
    ]
  : [{ userTuneId: 'harness-1', title: 'Harness Reel', abc: ABC, repetitions: 2 }]

createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <SetPlayer items={items} isSingleTune={!isSet} />
  </MemoryRouter>,
)
