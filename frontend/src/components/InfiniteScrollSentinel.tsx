"use client";

import { useEffect, useRef } from 'react'

interface InfiniteScrollSentinelProps {
  hasMore?: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
}

export function InfiniteScrollSentinel({ hasMore, isLoadingMore, onLoadMore }: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasMore || isLoadingMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore()
        }
      },
      { rootMargin: '250px' }
    )

    const el = sentinelRef.current
    if (el) observer.observe(el)

    return () => {
      if (el) observer.unobserve(el)
    }
  }, [hasMore, isLoadingMore, onLoadMore])

  if (!hasMore) return null

  return (
    <div ref={sentinelRef} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
      {isLoadingMore ? 'Loading more items… 🎵' : ''}
    </div>
  )
}
