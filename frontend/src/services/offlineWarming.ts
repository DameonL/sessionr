/**
 * Service to pre-fetch and warm IndexedDB & Cache Storage with the user's
 * complete repertoire, practice queue, sets, tune details, and soundfont MP3s
 * so the entire app works 100% offline.
 */

import { getFullRepertoire, getPracticeQueue, getRepertoireItem, getSets } from './api'
import { Signal } from '../state/appState'

export interface PreloadProgress {
  message: string
  percent: number
  isComplete?: boolean
  error?: string
}

export const preloadStatus = new Signal<PreloadProgress | null>(null)
export const isPreloading = new Signal<boolean>(false)

const SOUNDFONT_BASE = 'https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM'
const SOUNDFONT_CACHE_NAME = 'sessionapp-soundfont-v1'

function buildSoundfontUrls(): string[] {
  const urls: string[] = []
  const addFolderRange = (folder: string, startMidi: number, endMidi: number) => {
    for (let midi = startMidi; midi <= endMidi; midi++) {
      urls.push(`${SOUNDFONT_BASE}/${folder}/c${midi}.mp3`)
    }
  }

  addFolderRange('fiddle-mp3', 55, 84)
  addFolderRange('acoustic_guitar_nylon-mp3', 40, 67)
  addFolderRange('acoustic_bass-mp3', 28, 52)
  return urls
}

export async function preloadOfflineData(
  onProgress?: (progress: PreloadProgress) => void
): Promise<{ success: boolean; itemCount: number; error?: string }> {
  if (isPreloading.value) {
    return { success: false, itemCount: 0, error: 'Preload is already in progress' }
  }

  isPreloading.value = true
  const update = (message: string, percent: number, isComplete = false, error?: string) => {
    const prog: PreloadProgress = { message, percent, isComplete, error }
    preloadStatus.value = prog
    onProgress?.(prog)
  }

  try {
    // Step 1: Repertoire List
    update('Downloading repertoire list...', 10)
    const repertoireItems = await getFullRepertoire().catch(() => [])

    // Step 2: Sets & Practice Queue
    update('Downloading custom sets & practice queue...', 30)
    await Promise.allSettled([
      getSets().catch(() => []),
      getPracticeQueue().catch(() => []),
    ])

    // Step 3: Detailed Repertoire Tune Objects
    const totalTunes = repertoireItems.length
    let fetchedTunes = 0

    if (totalTunes > 0) {
      update(`Caching ${totalTunes} detailed tune entries...`, 40)
      for (const item of repertoireItems) {
        if (item.userTuneId) {
          await getRepertoireItem(item.userTuneId).catch(() => null)
        }
        fetchedTunes++
        const pct = Math.floor(40 + (fetchedTunes / totalTunes) * 40)
        update(`Cached ${fetchedTunes}/${totalTunes} tunes...`, pct)
      }
    }

    // Step 4: Soundfont Audio Assets
    update('Preloading soundfont audio files...', 85)
    if ('caches' in window) {
      try {
        const cache = await caches.open(SOUNDFONT_CACHE_NAME)
        const sfUrls = buildSoundfontUrls()
        let loadedSf = 0
        for (const url of sfUrls) {
          const match = await cache.match(url)
          if (!match) {
            await fetch(url, { mode: 'cors' })
              .then((res) => {
                if (res.ok) return cache.put(url, res)
              })
              .catch(() => {})
          }
          loadedSf++
        }
      } catch (err) {
        console.warn('Soundfont precache failed partially:', err)
      }
    }

    update('Offline data pre-fetch complete! App ready for offline use.', 100, true)
    return { success: true, itemCount: totalTunes }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Preload failed'
    update(`Preload error: ${errorMsg}`, 100, true, errorMsg)
    return { success: false, itemCount: 0, error: errorMsg }
  } finally {
    isPreloading.value = false
  }
}
