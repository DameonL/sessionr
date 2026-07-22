/**
 * Module-level QueryClient singleton (rather than created in Providers via
 * useState) so non-React code — syncManager's post-replay cache invalidation —
 * can reach the same client that <QueryClientProvider> renders with.
 */
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
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
