/**
 * Module-level QueryClient singleton (rather than created in Providers via
 * useState) so non-React code — syncManager's post-replay cache invalidation —
 * can reach the same client that <QueryClientProvider> renders with.
 */
import { MutationCache, QueryClient } from '@tanstack/react-query'
import { reportError } from '../state/appState'

export const queryClient = new QueryClient({
  // Surface every mutation failure through the global error report modal, so a
  // real server error (e.g. a 500 from a mutation with no local onError) is
  // never silently lost. Offline-queued / auth-required errors are filtered out
  // inside reportError.
  mutationCache: new MutationCache({
    onError: (error) => reportError(error),
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Without this, TanStack Query pauses queries/mutations while
      // navigator.onLine is false and never calls the queryFn/mutationFn —
      // which means doFetch's offline fallback/queueing logic never runs.
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
})
