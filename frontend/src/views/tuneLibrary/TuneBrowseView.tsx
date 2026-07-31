"use client";

import { useInfiniteQuery } from '@tanstack/react-query'
import { searchTunes } from '../../services/api'
import { TuneResultsList } from './TuneResultsList'

/** Browse the whole tune library, ordered by popularity or recency. */
export function TuneBrowseView({ sort }: { sort: 'popular' | 'newest' }) {
  const libraryQuery = useInfiniteQuery({
    queryKey: ['tune-library', sort],
    queryFn: ({ pageParam = 1 }) => searchTunes('', '', sort, pageParam, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })

  const allTunes = libraryQuery.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <TuneResultsList
      tunes={allTunes}
      isLoading={libraryQuery.isLoading}
      isError={libraryQuery.isError}
      hasMore={libraryQuery.hasNextPage}
      isFetchingMore={libraryQuery.isFetchingNextPage}
      onLoadMore={() => libraryQuery.fetchNextPage()}
      showRepertoireCount={sort === 'popular'}
    />
  )
}
