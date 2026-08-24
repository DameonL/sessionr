import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// api.ts reads the bearer token through appState; stub only that so the rest of
// the module (and its offline layer) behaves normally.
const getBearerToken = vi.fn<() => Promise<string | null>>()
vi.mock('../state/appState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/appState')>()
  return { ...actual, getBearerToken: () => getBearerToken() }
})

import {
  ApiError,
  UnauthenticatedError,
  checkUsersMeHealth,
  isApiOffline,
  isBackendUnavailableStatus,
  isUnauthenticatedError,
  matchTune,
  moderatorRefreshMatchIndex,
} from './api'

describe('isUnauthenticatedError', () => {
  it('recognises UnauthenticatedError', () => {
    expect(isUnauthenticatedError(new UnauthenticatedError())).toBe(true)
  })

  it('recognises a 401 from the server', () => {
    expect(isUnauthenticatedError(new ApiError(401, 'Unauthorized', ''))).toBe(true)
  })

  it('matches the flag structurally, across module boundaries', () => {
    expect(isUnauthenticatedError({ unauthenticated: true })).toBe(true)
  })

  it('rejects connectivity and other application errors', () => {
    expect(isUnauthenticatedError(new Error('Failed to fetch'))).toBe(false)
    expect(isUnauthenticatedError(new ApiError(500, 'Server Error', ''))).toBe(false)
    expect(isUnauthenticatedError(new ApiError(403, 'Forbidden', ''))).toBe(false)
    expect(isUnauthenticatedError(null)).toBe(false)
    expect(isUnauthenticatedError(undefined)).toBe(false)
    expect(isUnauthenticatedError('nope')).toBe(false)
  })
})

describe('isBackendUnavailableStatus', () => {
  it('covers only the gateway/cold-start statuses', () => {
    expect(isBackendUnavailableStatus(502)).toBe(true)
    expect(isBackendUnavailableStatus(503)).toBe(true)
    expect(isBackendUnavailableStatus(504)).toBe(true)
    expect([200, 400, 401, 403, 404, 429, 500].map(isBackendUnavailableStatus))
      .toEqual([false, false, false, false, false, false, false])
  })
})

describe('checkUsersMeHealth', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    isApiOffline.value = false
    getBearerToken.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    isApiOffline.value = false
  })

  const response = (status: number) =>
    ({ ok: status >= 200 && status < 300, status }) as Response

  it('does not probe, or latch offline, when there is no token', async () => {
    getBearerToken.mockResolvedValue(null)

    await expect(checkUsersMeHealth()).resolves.toBe(false)

    // The regression this guards: an unauthenticated probe earns a guaranteed
    // 401 and reports a healthy backend as offline.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isApiOffline.value).toBe(false)
  })

  it('does not latch offline when the backend rejects the token', async () => {
    getBearerToken.mockResolvedValue('token')
    fetchMock.mockResolvedValue(response(401))

    await expect(checkUsersMeHealth()).resolves.toBe(false)
    expect(isApiOffline.value).toBe(false)
  })

  it('does not latch offline on a deliberate 4xx', async () => {
    getBearerToken.mockResolvedValue('token')
    fetchMock.mockResolvedValue(response(403))

    await expect(checkUsersMeHealth()).resolves.toBe(false)
    expect(isApiOffline.value).toBe(false)
  })

  it('latches offline on a gateway failure', async () => {
    getBearerToken.mockResolvedValue('token')
    fetchMock.mockResolvedValue(response(503))

    await expect(checkUsersMeHealth()).resolves.toBe(false)
    expect(isApiOffline.value).toBe(true)
  })

  it('latches offline when the request never reaches a server', async () => {
    getBearerToken.mockResolvedValue('token')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(checkUsersMeHealth()).resolves.toBe(false)
    expect(isApiOffline.value).toBe(true)
  })

  it('sends the token and clears a previous latch on success', async () => {
    getBearerToken.mockResolvedValue('token')
    fetchMock.mockResolvedValue(response(200))
    isApiOffline.value = true

    await expect(checkUsersMeHealth()).resolves.toBe(true)
    expect(isApiOffline.value).toBe(false)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer token' },
    })
  })
})

describe('authenticated Public API calls', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    isApiOffline.value = false
    getBearerToken.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    isApiOffline.value = false
  })

  const okEmpty = () => ({ ok: true, status: 200, text: async () => '' }) as Response

  it('sends the bearer token to the Public API for the moderator refresh', async () => {
    // The moderator match-index endpoint lives in the Public app but authorizes off Entra
    // group claims in the token. Before this, token attachment keyed off "is this the private
    // base", so the call went out anonymous and the backend answered 403.
    getBearerToken.mockResolvedValue('token')
    fetchMock.mockResolvedValue(okEmpty())

    await moderatorRefreshMatchIndex()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('api-public')
    expect(url).toContain('/moderator/tunes/refresh-match-index')
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer token' } })
  })

  it('still sends ordinary Public reads without credentials', async () => {
    // Public calls are deliberately kept CORS-simple; an Authorization header would force a
    // preflight on every anonymous read.
    getBearerToken.mockResolvedValue('token')
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' } as Response)

    await matchTune([60, 62, 64])

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
  })

  it('refuses to fire the moderator refresh unauthenticated', async () => {
    getBearerToken.mockResolvedValue(null)

    await expect(moderatorRefreshMatchIndex()).rejects.toBeInstanceOf(UnauthenticatedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
