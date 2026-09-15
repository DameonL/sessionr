/**
 * How tune and set names sort: alphabetically, ignoring a leading article. "The Kesh" files under
 * K, the way a musician would look for it in a tune book, and a set named after its first tune
 * files the same way the tune does.
 *
 * Mirrors TitleSort on the API (api/Shared/Services/TitleSort.cs), which orders the lists the
 * server sends. Both exist because some lists are sorted client-side after filtering.
 */

/** The string to order by: the title with any leading article removed, lowercased. */
export function titleSortKey(title: string | null | undefined): string {
  const value = (title ?? '').toLowerCase()
  if (value.startsWith('the ')) return value.slice(4)
  if (value.startsWith('a ')) return value.slice(2)
  return value
}

/** Comparator for Array.sort, ordering by title with articles ignored. */
export function compareTitles(left: string | null | undefined, right: string | null | undefined): number {
  return titleSortKey(left).localeCompare(titleSortKey(right))
}
