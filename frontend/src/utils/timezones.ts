export interface TimeZoneOption {
  id: string
  displayName: string
  offsetMinutes: number
}

// Fallback list of timezones in case Intl.supportedValuesOf('timeZone') is unavailable
const FALLBACK_TIMEZONES = [
  'UTC',
  'Africa/Abidjan',
  'Africa/Accra',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Anchorage',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Caracas',
  'America/Chicago',
  'America/Denver',
  'America/Edmonton',
  'America/Guatemala',
  'America/Halifax',
  'America/Havana',
  'America/Indianapolis',
  'America/Jamaica',
  'America/La_Paz',
  'America/Lima',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/St_Johns',
  'America/Toronto',
  'America/Vancouver',
  'Asia/Almaty',
  'Asia/Amman',
  'Asia/Baghdad',
  'Asia/Baku',
  'Asia/Bangkok',
  'Asia/Beirut',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Irkutsk',
  'Asia/Jakarta',
  'Asia/Jerusalem',
  'Asia/Kabul',
  'Asia/Karachi',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Krasnoyarsk',
  'Asia/Kuala_Lumpur',
  'Asia/Kuwait',
  'Asia/Manila',
  'Asia/Muscat',
  'Asia/Novosibirsk',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Tashkent',
  'Asia/Tehran',
  'Asia/Tokyo',
  'Asia/Vladivostok',
  'Asia/Yakutsk',
  'Asia/Yekaterinburg',
  'Atlantic/Azores',
  'Atlantic/Canary',
  'Atlantic/Reykjavik',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Darwin',
  'Australia/Hobart',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Belgrade',
  'Europe/Berlin',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Budapest',
  'Europe/Copenhagen',
  'Europe/Dublin',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Kiev',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Vienna',
  'Europe/Warsaw',
  'Europe/Zurich',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Fiji',
  'Pacific/Guam',
  'Pacific/Honolulu',
  'Pacific/Kiritimati',
  'Pacific/Noumea',
  'Pacific/Pago_Pago',
  'Pacific/Port_Moresby',
  'Pacific/Tongatapu',
]

function getUtcOffset(timeZone: string, now: Date = new Date()): { offsetMinutes: number; formattedOffset: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
    const parts = formatter.formatToParts(now)
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    let offsetStr = tzPart ? tzPart.value : 'GMT'
    offsetStr = offsetStr.replace('GMT', 'UTC')
    if (offsetStr === 'UTC') {
      offsetStr = 'UTC+00:00'
    }

    const match = offsetStr.match(/UTC([+-])(\d{2}):(\d{2})/)
    if (match) {
      const sign = match[1] === '-' ? -1 : 1
      const hours = parseInt(match[2], 10)
      const minutes = parseInt(match[3], 10)
      const offsetMinutes = sign * (hours * 60 + minutes)
      return { offsetMinutes, formattedOffset: offsetStr }
    }
    return { offsetMinutes: 0, formattedOffset: offsetStr }
  } catch {
    return { offsetMinutes: 0, formattedOffset: 'UTC+00:00' }
  }
}

let cachedTimeZoneList: TimeZoneOption[] | null = null

export function getTimeZoneList(): TimeZoneOption[] {
  if (cachedTimeZoneList) {
    return cachedTimeZoneList
  }

  let ids: string[] = []
  if (typeof Intl !== 'undefined' && typeof (Intl as any).supportedValuesOf === 'function') {
    try {
      ids = (Intl as any).supportedValuesOf('timeZone')
    } catch {
      ids = FALLBACK_TIMEZONES
    }
  } else {
    ids = FALLBACK_TIMEZONES
  }

  if (!ids.includes('UTC')) {
    ids.push('UTC')
  }

  const now = new Date()
  const optionsMap = new Map<string, TimeZoneOption>()

  for (const id of ids) {
    const { offsetMinutes, formattedOffset } = getUtcOffset(id, now)
    const displayName = `(${formattedOffset}) ${id}`
    optionsMap.set(id, { id, displayName, offsetMinutes })
  }

  const options = Array.from(optionsMap.values())
  options.sort((a, b) => {
    if (a.offsetMinutes !== b.offsetMinutes) {
      return a.offsetMinutes - b.offsetMinutes
    }
    return a.id.localeCompare(b.id)
  })

  cachedTimeZoneList = options
  return cachedTimeZoneList
}
