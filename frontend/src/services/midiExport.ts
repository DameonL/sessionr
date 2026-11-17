import abcjs from 'abcjs'
import { synthInstrumentOptions, type Instruments } from '../components/instruments'
import { fixAbcRepeats, extractTitleFromAbc } from './abcTools'
import { buildPlaybackAbc, shouldKeepLeadIn } from './abcUnroll'
import type { BandVoice } from './band'
import { getBodhranDrumOption } from './bodhran'
import { transformNoteMapTracks } from './midiPlaybackPipeline'
import { toAbcjsSwing } from './swing'
import { getDefaultTargetBpm } from './api'

export interface MidiExportItem {
  title: string
  abc: string
  repetitions: number
  tuneType?: string
}

export interface MidiExportOptions {
  title?: string
  items: MidiExportItem[]
  bpm: number
  swingPercent: number
  emphasisPercent: number
  instruments: Instruments
  bandMode: boolean
  bandVoices: BandVoice[]
  bodhran: boolean
  repeat: boolean
  repeatLimit: number | null
}

export interface MidiExportResult {
  bytes: Uint8Array
  filename: string
  infiniteRepeatClamped: boolean
}

const PPQN = 480
const TICKS_PER_WHOLE_NOTE = PPQN * 4
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]
const PERCUSSION_CHANNEL = 9
const PERCUSSION_PROGRAM = 128
const DEFAULT_NOTE_VOLUME = 90

const INSTRUMENT_NAMES = abcjs.synth.instrumentIndexToName as unknown as string[]
const INSTRUMENT_NAME_TO_PROGRAM = new Map<string, number>(
  INSTRUMENT_NAMES.map((name, idx) => [name, idx]),
)

function programFromName(name: string | number | undefined, fallback = 0): number {
  if (typeof name === 'number') return Number.isFinite(name) ? name : fallback
  if (!name) return fallback
  return INSTRUMENT_NAME_TO_PROGRAM.get(name) ?? fallback
}

function getTuneExportBpm(visualObj: abcjs.TuneObject, requestedBpm: number, tuneType?: string): number {
  if (Number.isFinite(requestedBpm) && requestedBpm > 0) return requestedBpm
  const natural = visualObj.getBpm()
  if (natural > 0) return natural
  if (tuneType) return getDefaultTargetBpm(tuneType)
  return 120
}

/**
 * Converts abcjs `AudioTracks` (from `visualObj.setUpAudio(...)`) into `NoteMapTrack[]`
 * using the same rounding and gap semantics as `abcjs`'s internal `createNoteMap`.
 */
function audioTracksToNoteMap(flattened: abcjs.AudioTracks): abcjs.NoteMapTrack[] {
  const defaultName = INSTRUMENT_NAMES[0] ?? 'acoustic_grand_piano'
  return flattened.tracks.map((track) => {
    const out: abcjs.NoteMapTrack = []
    let currentInstrument = defaultName
    for (const ev of track) {
      if (ev.cmd === 'program') {
        currentInstrument = INSTRUMENT_NAMES[ev.instrument] ?? defaultName
      } else if (ev.cmd === 'note' && ev.duration > 0) {
        const inst =
          ev.instrument !== undefined
            ? (INSTRUMENT_NAMES[ev.instrument] ?? currentInstrument)
            : currentInstrument
        const rawGap = ev.gap ?? 0
        const gap = Math.min(rawGap, (ev.duration * 2) / 3)
        const start = Math.round(ev.start * 1_000_000) / 1_000_000
        const end = Math.round((ev.start + ev.duration - gap) * 1_000_000) / 1_000_000
        out.push({
          pitch: ev.pitch,
          instrument: inst,
          start,
          end: Math.max(start + 0.001, end),
          startChar: ev.startChar,
          endChar: ev.endChar,
          volume: ev.volume ?? DEFAULT_NOTE_VOLUME,
        })
      }
    }
    return out
  })
}

interface ScheduledMidiNote {
  startTick: number
  endTick: number
  pitch: number
  volume: number
  program: number
  cents: number
}

interface LogicalTrack {
  key: string
  name: string
  channel: number
  pan: number
  notes: ScheduledMidiNote[]
}

interface RawMidiEvent {
  tick: number
  /** Ordering within identical tick: 0=setup/meta, 1=noteOff, 2=pitchBend, 3=noteOn */
  order: number
  seq: number
  data: number[]
}

function encodeVarLen(value: number): number[] {
  let v = Math.max(0, Math.round(value))
  const bytes = [v & 0x7f]
  v >>= 7
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return bytes
}

function encodeUtf8Bytes(str: string): number[] {
  const encoded = new TextEncoder().encode(str)
  return Array.from(encoded)
}

function metaEventBytes(metaType: number, payload: number[]): number[] {
  return [0xff, metaType & 0x7f, ...encodeVarLen(payload.length), ...payload]
}

function metaTextEvent(metaType: number, text: string): number[] {
  return metaEventBytes(metaType, encodeUtf8Bytes(text))
}

function buildTimeSigPayload(meter: abcjs.MeterFraction | null | undefined): number[] | null {
  if (!meter || !meter.num || !meter.den) return null
  const denExp = Math.log2(meter.den)
  if (!Number.isInteger(denExp) || denExp < 0 || denExp > 5) return null
  let clocks = 24
  if (meter.den === 8 && meter.num % 3 === 0) clocks = 36
  else if (meter.den === 2) clocks = 48
  return [meter.num & 0xff, denExp & 0xff, clocks & 0xff, 8]
}

function buildKeySigPayload(key: abcjs.KeySignature | null | undefined): number[] | null {
  if (!key || !key.accidentals) return null
  let sharps = 0
  let flats = 0
  for (const acc of key.accidentals) {
    if (acc.acc === 'sharp') sharps++
    else if (acc.acc === 'flat') flats++
  }
  const sf = flats > 0 ? -flats : sharps
  const mi = key.mode === 'm' ? 1 : 0
  return [sf & 0xff, mi]
}

function pitchBendBytes(channel: number, cents: number): number[] {
  // GM default pitch bend range is +/- 2 semitones (+/- 200 cents) around 0x2000.
  const offset = Math.round((cents / 200) * 8192)
  const val = Math.max(0, Math.min(16383, 8192 + offset))
  const lsb = val & 0x7f
  const msb = (val >> 7) & 0x7f
  return [0xe0 | (channel & 0x0f), lsb, msb]
}

function serializeTrack(events: RawMidiEvent[]): Uint8Array {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order || a.seq - b.seq)
  const body: number[] = []
  let lastTick = 0
  for (const ev of sorted) {
    const delta = Math.max(0, ev.tick - lastTick)
    lastTick = ev.tick
    body.push(...encodeVarLen(delta), ...ev.data)
  }
  // End of track
  body.push(0x00, 0xff, 0x2f, 0x00)

  const chunk = new Uint8Array(8 + body.length)
  // "MTrk"
  chunk[0] = 0x4d
  chunk[1] = 0x54
  chunk[2] = 0x72
  chunk[3] = 0x6b
  const len = body.length
  chunk[4] = (len >>> 24) & 0xff
  chunk[5] = (len >>> 16) & 0xff
  chunk[6] = (len >>> 8) & 0xff
  chunk[7] = len & 0xff
  chunk.set(body, 8)
  return chunk
}

function serializeSmf(tracks: Uint8Array[]): Uint8Array {
  const totalLen = 14 + tracks.reduce((sum, t) => sum + t.length, 0)
  const out = new Uint8Array(totalLen)
  const view = new DataView(out.buffer)
  // "MThd"
  out[0] = 0x4d
  out[1] = 0x54
  out[2] = 0x68
  out[3] = 0x64
  view.setUint32(4, 6) // header length
  view.setUint16(8, 1) // Format 1 (multi-track synchronous)
  view.setUint16(10, tracks.length)
  view.setUint16(12, PPQN)
  let offset = 14
  for (const track of tracks) {
    out.set(track, offset)
    offset += track.length
  }
  return out
}

function buildTrackEvents(track: LogicalTrack): RawMidiEvent[] {
  const events: RawMidiEvent[] = []
  let seq = 0

  events.push({ tick: 0, order: 0, seq: seq++, data: metaTextEvent(0x03, track.name) })

  const ch = track.channel & 0x0f
  // Channel setup at tick 0: Reset All Controllers, Pan, Channel Volume
  const panByte = Math.max(0, Math.min(127, Math.round(((track.pan + 1) / 2) * 127)))
  events.push({ tick: 0, order: 0, seq: seq++, data: [0xb0 | ch, 121, 0] })
  events.push({ tick: 0, order: 0, seq: seq++, data: [0xb0 | ch, 10, panByte] })
  events.push({ tick: 0, order: 0, seq: seq++, data: [0xb0 | ch, 7, 100] })

  // Resolve overlapping notes of the same pitch so an earlier noteOff never kills a new noteOn.
  const notesByPitch = new Map<number, ScheduledMidiNote[]>()
  for (const n of track.notes) {
    const clampedPitch = Math.max(0, Math.min(127, Math.round(n.pitch)))
    const list = notesByPitch.get(clampedPitch)
    const normalized: ScheduledMidiNote = {
      ...n,
      pitch: clampedPitch,
      startTick: Math.max(0, n.startTick),
      endTick: Math.max(n.startTick + 1, n.endTick),
    }
    if (list) list.push(normalized)
    else notesByPitch.set(clampedPitch, [normalized])
  }

  const cleanNotes: ScheduledMidiNote[] = []
  for (const pitchNotes of notesByPitch.values()) {
    pitchNotes.sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick)
    for (let i = 0; i < pitchNotes.length; i++) {
      const cur = pitchNotes[i]
      if (i + 1 < pitchNotes.length) {
        const next = pitchNotes[i + 1]
        if (next.startTick === cur.startTick) {
          // Collapse simultaneous identical-pitch strikes on the same channel; keep the louder one.
          if (cur.volume > next.volume) next.volume = cur.volume
          next.endTick = Math.max(next.endTick, cur.endTick)
          continue
        }
        if (cur.endTick > next.startTick) {
          cur.endTick = Math.max(cur.startTick + 1, next.startTick)
        }
      }
      cleanNotes.push(cur)
    }
  }

  cleanNotes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)

  let activeProgram: number | null = null
  let activeCents = 0

  for (const note of cleanNotes) {
    const targetProg = ch === PERCUSSION_CHANNEL ? 0 : Math.max(0, Math.min(127, note.program))
    if (activeProgram !== targetProg) {
      events.push({ tick: note.startTick, order: 0, seq: seq++, data: [0xc0 | ch, targetProg] })
      activeProgram = targetProg
    }

    const roundedCents = Math.round(note.cents * 10) / 10
    if (ch !== PERCUSSION_CHANNEL && roundedCents !== activeCents) {
      events.push({
        tick: note.startTick,
        order: 2,
        seq: seq++,
        data: pitchBendBytes(ch, roundedCents),
      })
      activeCents = roundedCents
    }

    const vel = Math.max(1, Math.min(127, Math.round(note.volume)))
    events.push({ tick: note.startTick, order: 3, seq: seq++, data: [0x90 | ch, note.pitch, vel] })
    events.push({ tick: note.endTick, order: 1, seq: seq++, data: [0x80 | ch, note.pitch, 0] })
  }

  return events
}

/** Formats a safe `.mid` download filename from a tune or set title. */
export function sanitizeMidiFilename(title: string): string {
  const slug = title
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'tune'}.mid`
}

/**
 * Generates a Standard MIDI File (Format 1) for a tune or set with all configured
 * playback options (repeats, lead-in stripping, tempo, swing, meter emphasis,
 * solo/band instruments, plucked subdivision, chord strumming, and bodhrán).
 */
export function buildMidiFile(options: MidiExportOptions): MidiExportResult {
  const {
    title,
    items,
    bpm,
    swingPercent,
    emphasisPercent,
    instruments,
    bandMode,
    bandVoices,
    bodhran,
    repeat,
    repeatLimit,
  } = options

  const validItems = items.filter((i) => i.abc.trim() !== '')
  if (validItems.length === 0) {
    throw new Error('No playable ABC notation available for MIDI export.')
  }

  const isSingle = validItems.length === 1
  const infiniteRepeatClamped = repeat && repeatLimit === null
  const setPasses = !isSingle && repeat && repeatLimit !== null ? Math.max(1, repeatLimit) : 1

  const conductorEvents: RawMidiEvent[] = []
  let conductorSeq = 0

  const firstAbcTitle = extractTitleFromAbc(validItems[0].abc)
  const exportTitle = title?.trim() || validItems[0].title?.trim() || firstAbcTitle || (isSingle ? 'Tune' : 'Set')
  conductorEvents.push({
    tick: 0,
    order: 0,
    seq: conductorSeq++,
    data: metaTextEvent(0x03, exportTitle),
  })

  const logicalTracks = new Map<string, LogicalTrack>()
  let nextMelodicChannelIdx = 0

  function getOrCreateTrack(key: string, name: string, isPercussion: boolean, pan = 0): LogicalTrack {
    const existing = logicalTracks.get(key)
    if (existing) return existing
    const channel = isPercussion
      ? PERCUSSION_CHANNEL
      : MELODIC_CHANNELS[nextMelodicChannelIdx++ % MELODIC_CHANNELS.length]
    const created: LogicalTrack = { key, name, channel, pan, notes: [] }
    logicalTracks.set(key, created)
    return created
  }

  let currentOffsetTicks = 0
  let lastTempoUs: number | null = null
  let lastTimeSigKey: string | null = null
  let lastKeySigKey: string | null = null

  const useBand = bandMode && bandVoices.length > 0

  for (let setPass = 0; setPass < setPasses; setPass++) {
    for (const item of validItems) {
      const engravedAbc = fixAbcRepeats(item.abc)
      const singlePassObj = abcjs.parseOnly(engravedAbc)[0]
      if (!singlePassObj) continue

      const baseReps = Math.max(1, Math.floor(item.repetitions || 1))
      const passes = isSingle && repeat && repeatLimit !== null
        ? baseReps * Math.max(1, repeatLimit)
        : baseReps

      const keepLeadIn = shouldKeepLeadIn(singlePassObj)
      const playAbc =
        passes > 1 ? buildPlaybackAbc(engravedAbc, passes, { keepLeadIn }).abc : engravedAbc
      const playObj = (passes > 1 ? abcjs.parseOnly(playAbc)[0] : singlePassObj) ?? singlePassObj

      const effectiveBpm = getTuneExportBpm(singlePassObj, bpm, item.tuneType)
      const msPerMeasure = singlePassObj.millisecondsPerMeasure(effectiveBpm)
      const meter = singlePassObj.getMeterFraction()
      const meterSize = meter?.den ? meter.num / meter.den : 1
      const tempoMultiplierSec = msPerMeasure / 1000 / meterSize
      const tempoUs = Math.max(1, Math.min(0xffffff, Math.round((tempoMultiplierSec / 4) * 1_000_000)))

      const itemTitle = item.title?.trim() || extractTitleFromAbc(item.abc)
      if (itemTitle) {
        conductorEvents.push({
          tick: currentOffsetTicks,
          order: 0,
          seq: conductorSeq++,
          data: metaTextEvent(0x06, itemTitle),
        })
      }

      if (tempoUs !== lastTempoUs) {
        conductorEvents.push({
          tick: currentOffsetTicks,
          order: 0,
          seq: conductorSeq++,
          data: metaEventBytes(0x51, [(tempoUs >> 16) & 0xff, (tempoUs >> 8) & 0xff, tempoUs & 0xff]),
        })
        lastTempoUs = tempoUs
      }

      const timeSigPayload = buildTimeSigPayload(meter)
      if (timeSigPayload) {
        const timeSigKey = timeSigPayload.join(',')
        if (timeSigKey !== lastTimeSigKey) {
          conductorEvents.push({
            tick: currentOffsetTicks,
            order: 0,
            seq: conductorSeq++,
            data: metaEventBytes(0x58, timeSigPayload),
          })
          lastTimeSigKey = timeSigKey
        }
      }

      const keySigPayload = buildKeySigPayload(singlePassObj.getKeySignature())
      if (keySigPayload) {
        const keySigKey = keySigPayload.join(',')
        if (keySigKey !== lastKeySigKey) {
          conductorEvents.push({
            tick: currentOffsetTicks,
            order: 0,
            seq: conductorSeq++,
            data: metaEventBytes(0x59, keySigPayload),
          })
          lastKeySigKey = keySigKey
        }
      }

      const pickupWholeNotes = playObj.getPickupLength()
      const bodhranPattern = bodhran ? getBodhranDrumOption(meter) : undefined
      const abcjsSwing = toAbcjsSwing(swingPercent)
      let maxTuneWholeNotes = 0

      if (useBand) {
        bandVoices.forEach((voice, voiceIdx) => {
          const isLeader = voice.role === 'leader'
          const drumOption = isLeader ? bodhranPattern : undefined
          const flattened = playObj.setUpAudio({
            program: voice.program,
            chordprog: voice.program,
            bassprog: voice.program,
            drum: drumOption,
            drumBars: drumOption ? 1 : undefined,
          })
          maxTuneWholeNotes = Math.max(maxTuneWholeNotes, flattened.totalDuration || 0)

          const noteMapTracks = audioTracksToNoteMap(flattened)
          transformNoteMapTracks(noteMapTracks, {
            meter,
            pickupWholeNotes,
            tempoMultiplierSec,
            swingPercent,
            emphasisPercent,
            uniformProgram: voice.program,
            bandVoice: voice,
            applyNonCompoundSwing: true,
            abcjsSwing,
          })

          for (const track of noteMapTracks) {
            for (const note of track) {
              const prog = programFromName(note.instrument, voice.program)
              const isPerc = prog === PERCUSSION_PROGRAM
              const target = isPerc
                ? getOrCreateTrack('percussion', 'Bodhrán', true, 0)
                : getOrCreateTrack(
                    `band-${voiceIdx}`,
                    `Band ${voiceIdx + 1} (${voice.role})`,
                    false,
                    voice.pan,
                  )
              maxTuneWholeNotes = Math.max(maxTuneWholeNotes, note.end)
              target.notes.push({
                startTick: currentOffsetTicks + Math.round(note.start * TICKS_PER_WHOLE_NOTE),
                endTick: currentOffsetTicks + Math.round(note.end * TICKS_PER_WHOLE_NOTE),
                pitch: note.pitch,
                volume: note.volume,
                program: isPerc ? 0 : prog,
                cents: isPerc ? 0 : (note.cents ?? 0),
              })
            }
          }
        })
      } else {
        const flattened = playObj.setUpAudio({
          ...synthInstrumentOptions(instruments),
          drum: bodhranPattern,
          drumBars: bodhranPattern ? 1 : undefined,
        })
        maxTuneWholeNotes = Math.max(maxTuneWholeNotes, flattened.totalDuration || 0)

        const noteMapTracks = audioTracksToNoteMap(flattened)
        transformNoteMapTracks(noteMapTracks, {
          meter,
          pickupWholeNotes,
          tempoMultiplierSec,
          swingPercent,
          emphasisPercent,
          fallbackPrograms: [instruments.melody, instruments.chords, instruments.bass],
          applyNonCompoundSwing: true,
          abcjsSwing,
        })

        noteMapTracks.forEach((track, trackIdx) => {
          const fallbackProg =
            trackIdx === 0 ? instruments.melody : trackIdx === 1 ? instruments.chords : instruments.bass
          for (const note of track) {
            const prog = programFromName(note.instrument, fallbackProg)
            const isPerc = prog === PERCUSSION_PROGRAM
            let target: LogicalTrack
            if (isPerc) {
              target = getOrCreateTrack('percussion', 'Bodhrán', true)
            } else if (trackIdx === 0) {
              target = getOrCreateTrack('melody', 'Melody', false)
            } else if (prog === instruments.bass && instruments.bass !== instruments.chords) {
              target = getOrCreateTrack('bass', 'Bass', false)
            } else if (trackIdx === 1) {
              target = getOrCreateTrack('chords', 'Chords', false)
            } else {
              target = getOrCreateTrack(`voice-${trackIdx}`, `Voice ${trackIdx + 1}`, false)
            }
            maxTuneWholeNotes = Math.max(maxTuneWholeNotes, note.end)
            target.notes.push({
              startTick: currentOffsetTicks + Math.round(note.start * TICKS_PER_WHOLE_NOTE),
              endTick: currentOffsetTicks + Math.round(note.end * TICKS_PER_WHOLE_NOTE),
              pitch: note.pitch,
              volume: note.volume,
              program: isPerc ? 0 : prog,
              cents: isPerc ? 0 : (note.cents ?? 0),
            })
          }
        })
      }

      currentOffsetTicks += Math.max(1, Math.round(maxTuneWholeNotes * TICKS_PER_WHOLE_NOTE))
    }
  }

  const hasAnyNotes = Array.from(logicalTracks.values()).some((t) => t.notes.length > 0)
  if (!hasAnyNotes) {
    throw new Error('No notes could be generated for MIDI export.')
  }

  const serializedTracks: Uint8Array[] = [serializeTrack(conductorEvents)]
  for (const track of logicalTracks.values()) {
    if (track.notes.length === 0) continue
    serializedTracks.push(serializeTrack(buildTrackEvents(track)))
  }

  return {
    bytes: serializeSmf(serializedTracks),
    filename: sanitizeMidiFilename(exportTitle),
    infiniteRepeatClamped,
  }
}

/** Triggers a browser file download for a generated `.mid` byte array. */
export function downloadMidiFile(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy.buffer], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
