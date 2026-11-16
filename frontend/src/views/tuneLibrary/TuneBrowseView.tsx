"use client";

import { useInfiniteQuery } from '@tanstack/react-query'
import Link, { useSearchParams } from '@/utils/routerCompat'
import { searchTunes } from '../../services/api'
import { usePageMeta, SITE_ORIGIN } from '../../hooks/usePageMeta'
import { TuneResultsList } from './TuneResultsList'

/** Browse the whole tune library, ordered by popularity or recency. */
export function TuneBrowseView({ sort }: { sort: 'popular' | 'newest' }) {
  const searchParams = useSearchParams()
  const rawPage = Number(searchParams.get('page') ?? '1')
  const startPage = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1

  const basePath = sort === 'popular' ? '/tunes/popular' : '/tunes/newest'
  const canonicalPath = startPage > 1 ? `${basePath}?page=${startPage}` : basePath

  usePageMeta({
    title:
      sort === 'popular'
        ? `Most Popular Session Tunes${startPage > 1 ? ` (Page ${startPage})` : ''}`
        : `Newest Traditional Tunes${startPage > 1 ? ` (Page ${startPage})` : ''}`,
    description:
      sort === 'popular'
        ? 'Explore the most popular traditional Irish, Scottish, and folk tunes played in sessions, complete with ABC sheet music and audio playback.'
        : 'Browse the newest traditional tunes added to the sessionr ABC notation library.',
    canonicalPath,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: sort === 'popular' ? 'Most Popular Session Tunes' : 'Newest Traditional Tunes',
      url: `${SITE_ORIGIN}${canonicalPath}`,
    },
  })

  const libraryQuery = useInfiniteQuery({
    queryKey: ['tune-library', sort, startPage],
    queryFn: ({ pageParam }) => searchTunes('', '', sort, pageParam, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: startPage,
  })

  const pages = libraryQuery.data?.pages ?? []
  const allTunes = pages.flatMap((p) => p.items)
  const lastLoadedPage = pages[pages.length - 1]?.page ?? startPage

  return (
    <>
      <TuneResultsList
        tunes={allTunes}
        isLoading={libraryQuery.isLoading}
        isError={libraryQuery.isError}
        error={libraryQuery.error}
        hasMore={libraryQuery.hasNextPage}
        isFetchingMore={libraryQuery.isFetchingNextPage}
        onLoadMore={() => libraryQuery.fetchNextPage()}
        showRepertoireCount={sort === 'popular'}
      />
      {(startPage > 1 || libraryQuery.hasNextPage) && (
        <nav className="pagination-nav" aria-label="Tune library pagination">
          {startPage > 1 ? (
            <Link href={startPage === 2 ? basePath : `${basePath}?page=${startPage - 1}`} prefetch={false}>
              ← Previous page
            </Link>
          ) : (
            <span />
          )}
          {libraryQuery.hasNextPage && (
            <Link href={`${basePath}?page=${lastLoadedPage + 1}`} prefetch={false}>
              Page {lastLoadedPage + 1} →
            </Link>
          )}
        </nav>
      )}
    </>
  )
}
