import { useRef, useState } from 'preact/hooks'
import type { RepertoireItem } from '../services/api.ts'
import {
  TUNE_STATUSES,
  TUNE_TYPES,
  addToRepertoire,
  createTune,
  searchTunes,
  updateUserTune,
} from '../services/api.ts'

interface ImportStatus {
  total: number
  current: number
  added: number
  updated: number
  skipped: number
  failed: number
  errors: string[]
}

interface RepertoireBackupProps {
  userId: number
  repertoireItems: RepertoireItem[]
  onImported: () => void
}

interface NormalizedTune {
  title: string
  tuneType: string
  key: string
  abc: string
  status: string
  targetBpm: number | null
}

function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function getDefaultTargetBpm(tuneType: string): number {
  switch (tuneType) {
    case 'Reel':
    case 'Jig':
    case 'SlipJig':
    case 'Waltz':
    case 'Mazurka':
    case 'Other':
    default:
      return 110
    case 'Hornpipe':
    case 'March':
      return 90
    case 'Polka':
      return 115
    case 'Slide':
      return 120
    case 'Strathspey':
      return 80
    case 'Barndance':
      return 95
    case 'Air':
      return 60
  }
}

export function exportToCSV(items: RepertoireItem[]): string {
  const headers = ['Title', 'Type', 'Key', 'Status', 'TargetBPM', 'Abc']
  const lines = [headers.join(',')]
  for (const item of items) {
    const row = [
      csvEscape(item.title),
      csvEscape(item.tuneType),
      csvEscape(item.key),
      csvEscape(item.status),
      csvEscape(item.targetBpm),
      csvEscape(item.abc),
    ]
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

export function parseCSV(csvText: string): Record<string, string>[] {
  const result: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  while (i < csvText.length) {
    const char = csvText[i]
    const nextChar = csvText[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"'
          i += 2
          continue
        } else {
          inQuotes = false
          i++
          continue
        }
      } else {
        cell += char
        i++
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
      } else if (char === ',') {
        row.push(cell)
        cell = ''
        i++
      } else if (char === '\n' || char === '\r') {
        row.push(cell)
        cell = ''
        if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
          result.push(row)
        }
        row = []
        if (char === '\r' && nextChar === '\n') {
          i += 2
        } else {
          i++
        }
      } else {
        cell += char
        i++
      }
    }
  }
  if (cell || row.length > 0) {
    row.push(cell)
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      result.push(row)
    }
  }

  if (result.length === 0) return []
  const headers = result[0].map((h) => h.trim().toLowerCase())
  const rows: Record<string, string>[] = []

  for (let r = 1; r < result.length; r++) {
    const values = result[r]
    const rowObj: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = values[c] !== undefined ? values[c] : ''
    }
    rows.push(rowObj)
  }
  return rows
}

export function RepertoireBackup({ userId, repertoireItems, onImported }: RepertoireBackupProps) {
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExportCsv = () => {
    try {
      const csv = exportToCSV(repertoireItems)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute(
        'download',
        `repertoire_export_${new Date().toISOString().split('T')[0]}.csv`
      )
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      setError(`Failed to export CSV: ${(err as Error).message}`)
    }
  }

  const handleExportJson = () => {
    try {
      const exportItems = repertoireItems.map((item) => ({
        title: item.title,
        tuneType: item.tuneType,
        key: item.key,
        status: item.status,
        targetBpm: item.targetBpm,
        abc: item.abc,
      }))
      const json = JSON.stringify(exportItems, null, 2)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute(
        'download',
        `repertoire_export_${new Date().toISOString().split('T')[0]}.json`
      )
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      setError(`Failed to export JSON: ${(err as Error).message}`)
    }
  }

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement
    if (!input.files || input.files.length === 0) return

    const file = input.files[0]
    const reader = new FileReader()

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string
        let rawItems: Record<string, string>[] = []

        if (file.name.endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
          const parsed = JSON.parse(text)
          rawItems = Array.isArray(parsed) ? parsed : [parsed]
        } else {
          rawItems = parseCSV(text)
        }

        if (rawItems.length === 0) {
          setError('No tunes found in the uploaded file.')
          return
        }

        // Normalize
        const normalized: NormalizedTune[] = rawItems
          .map((raw) => {
            const title = (raw.title || raw.name || '').trim()
            if (!title) return null

            const key = (raw.key || raw.mode || 'D').trim()

            let rawType = (raw.tuneType || raw.tunetype || raw.type || raw.genre || 'Other').trim()
            const matchType = TUNE_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase())
            const tuneType = (matchType || 'Other') as string

            let abc =
              raw.abc ||
              raw.notation ||
              raw.masterAbcText ||
              raw.masterabctext ||
              raw.customAbcText ||
              raw.customabctext ||
              ''
            if (!abc.trim()) {
              abc = `X:1\nT:${title}\nK:${key}\n`
            }

            let rawStatus = (raw.status || 'Learning').trim()
            const matchStatus = TUNE_STATUSES.find(
              (s) => s.toLowerCase() === rawStatus.toLowerCase()
            )
            const status = (matchStatus || 'Learning') as string

            let targetBpm: number | null = null
            const bpmRaw = raw.targetBpm || raw.targetbpm || raw.bpm
            if (bpmRaw) {
              const num = Number(bpmRaw)
              if (!isNaN(num) && num > 0) {
                targetBpm = num
              }
            }
            if (targetBpm === null) {
              targetBpm = getDefaultTargetBpm(tuneType)
            }

            return { title, tuneType, key, abc, status, targetBpm: targetBpm as number | null }
          })
          .filter((t): t is NormalizedTune => t !== null)

        if (normalized.length === 0) {
          setError('No valid tunes with a title found in the file.')
          return
        }

        const confirmImport = window.confirm(
          `Found ${normalized.length} tunes in "${file.name}". Would you like to import them into your repertoire?`
        )
        if (!confirmImport) {
          if (fileInputRef.current) fileInputRef.current.value = ''
          return
        }

        setError(null)
        setImporting(true)
        const initialStatus: ImportStatus = {
          total: normalized.length,
          current: 0,
          added: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          errors: [],
        }
        setStatus(initialStatus)

        // Sequentially import
        for (let i = 0; i < normalized.length; i++) {
          const item = normalized[i]
          try {
            // Find if already in repertoire
            const existingRepertoireItem = repertoireItems.find(
              (r) => r.title.toLowerCase() === item.title.toLowerCase()
            )

            if (existingRepertoireItem) {
              // Check if we need to update status, target BPM, or ABC
              const needsStatusUpdate = item.status && existingRepertoireItem.status !== item.status
              const needsBpmUpdate = item.targetBpm !== null && existingRepertoireItem.targetBpm !== item.targetBpm
              const needsAbcUpdate = item.abc && existingRepertoireItem.abc !== item.abc

              if (needsStatusUpdate || needsBpmUpdate || needsAbcUpdate) {
                await updateUserTune(existingRepertoireItem.userTuneId, {
                  status: item.status,
                  targetBpm: item.targetBpm !== null ? item.targetBpm : undefined,
                  customAbcText: needsAbcUpdate ? item.abc : undefined,
                })
                initialStatus.updated++
              } else {
                initialStatus.skipped++
              }
            } else {
              // Not in repertoire. Check if global tune exists.
              const searchResults = await searchTunes(item.title)
              const existingGlobal = searchResults.find(
                (t) => t.title.toLowerCase() === item.title.toLowerCase()
              )

              let tuneId: number
              if (existingGlobal) {
                tuneId = existingGlobal.tuneId
              } else {
                // Create global tune
                const created = await createTune({
                  title: item.title,
                  tuneType: item.tuneType,
                  key: item.key,
                  abc: item.abc,
                })
                tuneId = created.tuneId
              }

              // Add to repertoire
              const addedItem = await addToRepertoire(userId, tuneId)

              // Update metadata if needed
              const needsStatusUpdate = item.status && item.status !== 'Learning'
              const needsBpmUpdate = item.targetBpm !== null
              const needsAbcUpdate = item.abc && addedItem.abc !== item.abc

              if (needsStatusUpdate || needsBpmUpdate || needsAbcUpdate) {
                await updateUserTune(addedItem.userTuneId, {
                  status: item.status,
                  targetBpm: item.targetBpm !== null ? item.targetBpm : undefined,
                  customAbcText: needsAbcUpdate ? item.abc : undefined,
                })
              }
              initialStatus.added++
            }
          } catch (err) {
            initialStatus.failed++
            initialStatus.errors.push(`Failed importing "${item.title}": ${(err as Error).message}`)
          }

          initialStatus.current = i + 1
          setStatus({ ...initialStatus })
        }

        // Finished
        onImported()
      } catch (err) {
        setError(`Failed to read or parse file: ${(err as Error).message}`)
      } finally {
        setImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }

    reader.onerror = () => {
      setError('Error reading file.')
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }

    reader.readAsText(file)
  }

  return (
    <div class="card backup-section">
      <h2>Backup &amp; Restore</h2>
      <p class="tune-meta">
        Export your repertoire to a file, or import new/existing tunes from a CSV or JSON backup.
      </p>
      
      <div class="detail-controls">
        <button onClick={handleExportCsv}>⬆ Export CSV</button>
        <button onClick={handleExportJson}>⬆ Export JSON</button>
        
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? 'Importing…' : '⬇ Import File'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {error && <p class="error">{error}</p>}

      {status && (
        <div class="import-status-box">
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>
            Importing: {status.current} of {status.total}
          </h3>
          <div class="progress-bar-container">
            <div
              class="progress-bar"
              style={{ width: `${(status.current / status.total) * 100}%` }}
            ></div>
          </div>
          <p class="tune-meta" style={{ margin: '0.5rem 0 0 0' }}>
            Added: <strong>{status.added}</strong> ·{' '}
            Updated: <strong>{status.updated}</strong> ·{' '}
            Skipped: <strong>{status.skipped}</strong> ·{' '}
            Failed: <strong>{status.failed}</strong>
          </p>
          {status.errors.length > 0 && (
            <details class="import-errors">
              <summary>View {status.errors.length} errors/warnings</summary>
              <ul>
                {status.errors.map((err, idx) => (
                  <li key={idx} class="tune-meta" style={{ color: 'var(--danger)' }}>
                    {err}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
