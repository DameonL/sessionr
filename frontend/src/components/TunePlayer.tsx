import { useMemo } from 'react'
import { SetPlayer } from './SetPlayer'

export interface TunePlayerProps {
  abc: string
  targetBpm?: number | null
  title?: string
}

/**
 * Single-tune player wrapper around the consolidated SetPlayer component.
 * Converts a single tune ABC into a 1-item set and renders SetPlayer in single-tune mode.
 */
export function TunePlayer({ abc, targetBpm, title }: TunePlayerProps) {
  const items = useMemo(
    () => [
      {
        userTuneId: 'single',
        title: title ?? '',
        abc,
        repetitions: 1,
      },
    ],
    [abc, title],
  )

  return <SetPlayer items={items} targetBpm={targetBpm} isSingleTune />
}



