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

const params = new URLSearchParams(location.search)
const isSet = params.has('set')

// A bare 4/4 tune of even eighths: every note identical, so any loudness differences in the
// rendered audio can only have come from the meter emphasis.
const PULSE_REEL = `X:1
T:Pulse Reel
M:4/4
L:1/8
K:C
CCCC CCCC|CCCC CCCC|CCCC CCCC|CCCC CCCC|]`

const PULSE_JIG = `X:1
T:Pulse Jig
M:6/8
L:1/8
K:C
CCC CCC|CCC CCC|CCC CCC|CCC CCC|]`

// The same reel, but starting on an upbeat. Bar lines fall one eighth later than the notes do,
// which is what getPickupLength exists to tell us.
const PULSE_PICKUP = `X:1
T:Pulse Pickup
M:4/4
L:1/8
K:C
C|CCCC CCCC|CCCC CCCC|CCCC CCCC|CCCC CCC|]`

const PROBE = { reel: PULSE_REEL, jig: PULSE_JIG, pickup: PULSE_PICKUP }[params.get('probe') ?? '']
const items = PROBE
  ? [{ userTuneId: 'probe', title: 'Probe', abc: PROBE, repetitions: 1 }]
  : isSet
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
