import { useMemo } from 'react'
import { SetPlayer } from './SetPlayer'

export interface TunePlayerProps {
  abc: string
  targetBpm?: number | null
  title?: string
  /** Identifies the tune for per-tune playback preferences (tempo/swing); defaults to 'single' if omitted. */
  tuneId?: string
  /** Used to fall back to a sensible genre-based default tempo when no explicit target BPM is set. */
  tuneType?: string
  /** Optional callback to log practice for the tune directly from the top player toolbar. */
  onLogPractice?: () => void
  isPracticedToday?: boolean
  isLoggingPractice?: boolean
  logPracticeLabel?: string
}

/**
 * Single-tune player wrapper around the consolidated SetPlayer component.
 * Converts a single tune ABC into a 1-item set and renders SetPlayer in single-tune mode.
 */
export function TunePlayer({
  abc,
  targetBpm,
  title,
  tuneId,
  tuneType,
  onLogPractice,
  isPracticedToday,
  isLoggingPractice,
  logPracticeLabel,
}: TunePlayerProps) {
  const items = useMemo(
    () => [
      {
        userTuneId: tuneId ?? 'single',
        title: title ?? '',
        abc,
        repetitions: 1,
        tuneType,
      },
    ],
    [abc, title, tuneId, tuneType],
  )

  return (
    <SetPlayer
      items={items}
      targetBpm={targetBpm}
      isSingleTune
      onLogPractice={onLogPractice}
      isPracticedToday={isPracticedToday}
      isLoggingPractice={isLoggingPractice}
      logPracticeLabel={logPracticeLabel}
    />
  )
}



