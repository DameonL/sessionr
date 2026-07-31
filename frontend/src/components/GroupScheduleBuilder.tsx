"use client";

import { type RecurrencePattern } from '../services/api'

export interface ScheduleDraft {
  id: string
  name: string
  recurrencePattern: RecurrencePattern
  recurrenceDayOfWeek: number
  recurrenceWeekOfMonth: number
  startDate: string
  meetingTime: string
  meetingDescription: string
}

interface GroupScheduleBuilderProps {
  schedules: ScheduleDraft[]
  onChange: (schedules: ScheduleDraft[]) => void
  disabled?: boolean
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKS_OF_MONTH = [
  { val: 1, label: 'First (1st)' },
  { val: 2, label: 'Second (2nd)' },
  { val: 3, label: 'Third (3rd)' },
  { val: 4, label: 'Fourth (4th)' },
  { val: 5, label: 'Last' },
]

export function generateScheduleText(s: ScheduleDraft): string {
  const timeStr = s.meetingTime ? ` at ${s.meetingTime}` : ''
  let patternText = 'No recurring meeting'
  if (s.recurrencePattern === 'Weekly') {
    patternText = `Every ${DAYS_OF_WEEK[s.recurrenceDayOfWeek]}${timeStr}`
  } else if (s.recurrencePattern === 'Biweekly') {
    const startStr = s.startDate ? ` starting ${s.startDate}` : ''
    patternText = `Every other ${DAYS_OF_WEEK[s.recurrenceDayOfWeek]}${startStr}${timeStr}`
  } else if (s.recurrencePattern === 'MonthlyNthDay') {
    const weekLabel = WEEKS_OF_MONTH.find((w) => w.val === s.recurrenceWeekOfMonth)?.label ?? `${s.recurrenceWeekOfMonth}`
    patternText = `${weekLabel} ${DAYS_OF_WEEK[s.recurrenceDayOfWeek]} of every month${timeStr}`
  } else if (s.recurrencePattern === 'SpecificDate') {
    patternText = `Specific date: ${s.startDate || 'Unspecified'}${timeStr}`
  }

  if (s.name && s.name.trim()) {
    return `${s.name.trim()} (${patternText})`
  }
  return patternText
}

export function GroupScheduleBuilder({ schedules, onChange, disabled }: GroupScheduleBuilderProps) {
  const addSchedule = () => {
    const newSchedule: ScheduleDraft = {
      id: Math.random().toString(36).substring(2, 9),
      name: '',
      recurrencePattern: 'Weekly',
      recurrenceDayOfWeek: 3, // Wednesday
      recurrenceWeekOfMonth: 1,
      startDate: new Date().toISOString().split('T')[0],
      meetingTime: '19:30',
      meetingDescription: '',
    }
    onChange([...schedules, newSchedule])
  }

  const removeSchedule = (id: string) => {
    onChange(schedules.filter((s) => s.id !== id))
  }

  const updateSchedule = (id: string, updates: Partial<ScheduleDraft>) => {
    onChange(schedules.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontWeight: 600 }}>📅 Meeting Schedules ({schedules.length})</label>
        <button
          type="button"
          className="secondary"
          onClick={addSchedule}
          disabled={disabled}
          style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
        >
          + Add Meeting Schedule
        </button>
      </div>

      {schedules.length === 0 ? (
        <p className="tune-meta" style={{ fontStyle: 'italic', margin: 0, fontSize: '0.85rem' }}>
          No recurring schedules added yet. (Ad-hoc sessions only)
        </p>
      ) : (
        schedules.map((s, idx) => {
          const summaryText = generateScheduleText(s)
          return (
            <div
              key={s.id}
              style={{
                background: 'var(--surface-3)',
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent)' }}>
                  🔄 Schedule #{idx + 1}: {summaryText}
                </span>
                <button
                  type="button"
                  className="secondary danger-hover"
                  onClick={() => removeSchedule(s.id)}
                  disabled={disabled}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto' }}
                >
                  🗑️ Remove
                </button>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--muted)' }}>Meeting Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Wednesday Pub Session, Beginners Circle, or Sunday Workshop"
                  value={s.name ?? ''}
                  onChange={(e) => updateSchedule(s.id, { name: e.target.value })}
                  disabled={disabled}
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--muted)' }}>Pattern</label>
                  <select
                    value={s.recurrencePattern}
                    onChange={(e) => updateSchedule(s.id, { recurrencePattern: e.target.value as RecurrencePattern })}
                    disabled={disabled}
                    style={{ width: '100%', fontSize: '0.85rem' }}
                  >
                    <option value="Weekly">Every week on a specific day</option>
                    <option value="Biweekly">Every other week on a specific day</option>
                    <option value="MonthlyNthDay">Monthly on a specific week & day</option>
                    <option value="SpecificDate">Non-recurring specific meeting date</option>
                  </select>
                </div>

                {s.recurrencePattern === 'MonthlyNthDay' && (
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--muted)' }}>Week of Month</label>
                    <select
                      value={s.recurrenceWeekOfMonth}
                      onChange={(e) => updateSchedule(s.id, { recurrenceWeekOfMonth: parseInt(e.target.value) })}
                      disabled={disabled}
                      style={{ width: '100%', fontSize: '0.85rem' }}
                    >
                      {WEEKS_OF_MONTH.map((w) => (
                        <option key={w.val} value={w.val}>{w.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {s.recurrencePattern !== 'SpecificDate' && (
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--muted)' }}>Day of Week</label>
                    <select
                      value={s.recurrenceDayOfWeek}
                      onChange={(e) => updateSchedule(s.id, { recurrenceDayOfWeek: parseInt(e.target.value) })}
                      disabled={disabled}
                      style={{ width: '100%', fontSize: '0.85rem' }}
                    >
                      {DAYS_OF_WEEK.map((d, i) => (
                        <option key={d} value={i}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(s.recurrencePattern === 'Biweekly' || s.recurrencePattern === 'SpecificDate') && (
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--muted)' }}>
                      {s.recurrencePattern === 'SpecificDate' ? 'Meeting Date' : 'Anchor Start Date'}
                    </label>
                    <input
                      type="date"
                      value={s.startDate}
                      onChange={(e) => updateSchedule(s.id, { startDate: e.target.value })}
                      disabled={disabled}
                      style={{ width: '100%', fontSize: '0.85rem' }}
                    />
                  </div>
                )}

                <div style={{ flex: 1, minWidth: '110px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--muted)' }}>Meeting Time</label>
                  <input
                    type="time"
                    value={s.meetingTime}
                    onChange={(e) => updateSchedule(s.id, { meetingTime: e.target.value })}
                    disabled={disabled}
                    style={{ width: '100%', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--muted)' }}>Notes / Description</label>
                <input
                  type="text"
                  placeholder="e.g. Slow session for beginners in back room"
                  value={s.meetingDescription}
                  onChange={(e) => updateSchedule(s.id, { meetingDescription: e.target.value })}
                  disabled={disabled}
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
