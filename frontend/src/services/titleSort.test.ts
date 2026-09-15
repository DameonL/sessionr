import { describe, expect, it } from 'vitest'
import { compareTitles, titleSortKey } from './titleSort'

describe('titleSortKey', () => {
  it('drops a leading "The"', () => {
    expect(titleSortKey('The Kesh')).toBe('kesh')
  })

  it('drops a leading "A"', () => {
    expect(titleSortKey('A Fig for a Kiss')).toBe('fig for a kiss')
  })

  it('leaves an article that is only the start of a longer word', () => {
    expect(titleSortKey('Theme from Ballydesmond')).toBe('theme from ballydesmond')
    expect(titleSortKey('Apples in Winter')).toBe('apples in winter')
  })

  it('leaves an article anywhere but the start', () => {
    expect(titleSortKey('Out on the Ocean')).toBe('out on the ocean')
  })

  it('treats a missing title as empty', () => {
    expect(titleSortKey(null)).toBe('')
    expect(titleSortKey(undefined)).toBe('')
  })
})

describe('compareTitles', () => {
  it('files a title under its first real word', () => {
    const sorted = ['The Butterfly', 'Apples in Winter', 'The Kesh', 'Drowsy Maggie']
      .sort(compareTitles)

    expect(sorted).toEqual(['Apples in Winter', 'The Butterfly', 'Drowsy Maggie', 'The Kesh'])
  })

  it('ignores case', () => {
    expect(['the kesh', 'Butterfly'].sort(compareTitles)).toEqual(['Butterfly', 'the kesh'])
  })
})
