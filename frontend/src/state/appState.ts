import { signal } from '@preact/signals'

/** Placeholder until auth is wired up (SWA provides identity in production). */
export const currentUserId = signal(1)

/** Global repertoire search — kept as a signal so the nav/search survive route changes. */
export const repertoireSearch = signal('')
