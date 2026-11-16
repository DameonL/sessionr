"use client";

import { lazy, Suspense } from 'react'
import { usePageMeta, SITE_ORIGIN } from '../../../hooks/usePageMeta'
import { Spinner } from '../../../components/Spinner'

// Dynamically imported for the same reason as the ear trainer: abcjs's synth
// must not be pulled in during SSR.
const IntervalTrainer = lazy(() =>
  import('../../../components/IntervalTrainer').then((m) => ({ default: m.IntervalTrainer })),
)

export default function IntervalTrainingPage() {
  usePageMeta({
    title: 'Musical Interval Ear Trainer',
    description:
      'Train your ear to recognize musical intervals by sight and sound with customizable drills for traditional musicians.',
    canonicalPath: '/practice/intervals',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'sessionr Interval Trainer',
      url: `${SITE_ORIGIN}/practice/intervals`,
      applicationCategory: 'MusicApplication',
      operatingSystem: 'Any',
    },
  })

  return (
    <Suspense fallback={<div className="spinner-row"><Spinner /></div>}>
      <IntervalTrainer />
    </Suspense>
  )
}
