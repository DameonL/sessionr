"use client";

import { lazy, Suspense } from 'react'
import { Spinner } from '../../../components/Spinner'

// Dynamically imported for the same reason as the ear trainer: abcjs's synth
// must not be pulled in during SSR.
const IntervalTrainer = lazy(() =>
  import('../../../components/IntervalTrainer').then((m) => ({ default: m.IntervalTrainer })),
)

export default function IntervalTrainingPage() {
  return (
    <Suspense fallback={<div className="spinner-row"><Spinner /></div>}>
      <IntervalTrainer />
    </Suspense>
  )
}
