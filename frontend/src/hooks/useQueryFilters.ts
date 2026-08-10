"use client";
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

/** Read/write filter state to the URL query string (bookmarkable, back-friendly).
 *  Writes use router.replace so filter tweaks don't spam browser history.
 *  Empty values are removed to keep URLs clean. */
export function useQueryFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return { searchParams, setParams }
}
