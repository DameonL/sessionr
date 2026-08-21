import { describe, it, expect } from 'vitest'
import { getDetectedTimeZone, getTimeZoneList, getTimeZoneGroups } from './timezones'

describe('getDetectedTimeZone', () => {
  it('returns an IANA identifier', () => {
    const detected = getDetectedTimeZone()

    expect(typeof detected).toBe('string')
    expect(detected.length).toBeGreaterThan(0)
    // Either a Region/City id or the bare UTC fallback.
    expect(detected === 'UTC' || detected.includes('/')).toBe(true)
  })

  it('is a zone the picker actually offers', () => {
    const ids = new Set(getTimeZoneList().map((tz) => tz.id))

    expect(ids.has(getDetectedTimeZone())).toBe(true)
  })
})

describe('getTimeZoneList', () => {
  it('offers a substantial list of zones', () => {
    expect(getTimeZoneList().length).toBeGreaterThan(50)
  })

  it('always includes UTC', () => {
    expect(getTimeZoneList().some((tz) => tz.id === 'UTC')).toBe(true)
  })

  it('has no duplicate ids', () => {
    const ids = getTimeZoneList().map((tz) => tz.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sorts west to east by UTC offset', () => {
    const offsets = getTimeZoneList().map((tz) => tz.offsetMinutes)

    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('breaks offset ties alphabetically', () => {
    const list = getTimeZoneList()

    for (let i = 1; i < list.length; i++) {
      if (list[i].offsetMinutes === list[i - 1].offsetMinutes) {
        expect(list[i - 1].id.localeCompare(list[i].id)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('labels each zone with its offset and id', () => {
    const dublin = getTimeZoneList().find((tz) => tz.id === 'Europe/Dublin')

    expect(dublin).toBeDefined()
    expect(dublin!.displayName).toContain('Europe/Dublin')
    expect(dublin!.displayName).toMatch(/^\(UTC[+-]\d{2}:\d{2}\)/)
  })

  it('places UTC itself at a zero offset', () => {
    expect(getTimeZoneList().find((tz) => tz.id === 'UTC')!.offsetMinutes).toBe(0)
  })

  it.each([
    ['America/New_York', 'Americas'],
    ['Europe/Dublin', 'Europe'],
    ['Asia/Tokyo', 'Asia & Pacific'],
    ['Australia/Sydney', 'Asia & Pacific'],
    ['Africa/Cairo', 'Africa & Middle East'],
    ['UTC', 'UTC & Universal'],
  ])('files %s under %s', (id, region) => {
    const zone = getTimeZoneList().find((tz) => tz.id === id)

    expect(zone?.region).toBe(region)
  })

  it('returns the same cached list on repeated calls', () => {
    expect(getTimeZoneList()).toBe(getTimeZoneList())
  })
})

describe('getTimeZoneGroups', () => {
  it('groups every zone under a labelled heading', () => {
    const groups = getTimeZoneGroups()
    const grouped = groups
      .filter((g) => !g.label.includes('Popular'))
      .flatMap((g) => g.options.map((o) => o.id))

    expect(new Set(grouped).size).toBe(getTimeZoneList().length)
  })

  it('leads with the popular and detected zones', () => {
    expect(getTimeZoneGroups()[0].label).toContain('Popular')
  })

  it('puts the caller’s current selection in the popular group', () => {
    const obscure = getTimeZoneList().find((tz) => tz.region === 'Other' || tz.id.startsWith('Indian/'))

    if (obscure) {
      const popular = getTimeZoneGroups('', obscure.id)[0]
      expect(popular.options.some((o) => o.id === obscure.id)).toBe(true)
    }
  })

  it('lists the detected zone among the popular ones', () => {
    const popular = getTimeZoneGroups()[0]

    expect(popular.options.some((o) => o.id === getDetectedTimeZone())).toBe(true)
  })

  it('never repeats a zone inside the popular group', () => {
    // The detected zone is often also in the popular set and may be the current
    // selection too — all three paths must not add it three times.
    const detected = getDetectedTimeZone()
    const ids = getTimeZoneGroups('', detected)[0].options.map((o) => o.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('filters by a partial id', () => {
    const groups = getTimeZoneGroups('dublin')
    const ids = groups.flatMap((g) => g.options.map((o) => o.id))

    expect(ids).toContain('Europe/Dublin')
    expect(ids.every((id) => id.toLowerCase().includes('dublin'))).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(getTimeZoneGroups('DUBLIN')).toEqual(getTimeZoneGroups('dublin'))
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(getTimeZoneGroups('  dublin  ')).toEqual(getTimeZoneGroups('dublin'))
  })

  it('drops the popular group while filtering', () => {
    // With a query on screen the user is searching, not browsing suggestions.
    expect(getTimeZoneGroups('dublin').some((g) => g.label.includes('Popular'))).toBe(false)
  })

  it('omits groups with nothing in them', () => {
    for (const group of getTimeZoneGroups('dublin')) {
      expect(group.options.length).toBeGreaterThan(0)
    }
  })

  it('returns nothing for a query that matches no zone', () => {
    expect(getTimeZoneGroups('atlantis')).toEqual([])
  })

  it('can be searched by offset as well as name', () => {
    const groups = getTimeZoneGroups('UTC+09:00')

    expect(groups.flatMap((g) => g.options).length).toBeGreaterThan(0)
  })
})
