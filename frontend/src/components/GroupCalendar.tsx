"use client";

import { useState } from 'react'
import { type RecurrencePattern, type GroupSessionData, parseServerDate } from '../services/api'

interface GroupCalendarProps {
  recurrencePattern: RecurrencePattern
  recurrenceDayOfWeek: number | null
  recurrenceWeekOfMonth: number | null
  startDate?: string | null
  meetingTime: string | null
  meetingScheduleText: string | null
  meetingDescription?: string | null
  sessions: GroupSessionData[]
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function GroupCalendar({
  recurrencePattern,
  recurrenceDayOfWeek,
  recurrenceWeekOfMonth,
  startDate,
  meetingTime,
  meetingScheduleText,
  meetingDescription,
  sessions,
}: GroupCalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // First day of month & number of days in month
  const firstDayOfMonth = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
    setSelectedDate(null)
  }

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
    setSelectedDate(null)
  }

  const handleToday = () => {
    setCurrentDate(new Date())
    setSelectedDate(null)
  }

  // Helper to test if a given day in current month is a meeting day from group schedule settings
  const isRecurringMeetingDay = (day: number): boolean => {
    if (recurrencePattern === 'None') return false

    const date = new Date(year, month, day)
    date.setHours(0, 0, 0, 0)

    if (recurrencePattern === 'SpecificDate' && startDate) {
      const sDate = parseServerDate(startDate)
      return (
        sDate.getFullYear() === year &&
        sDate.getMonth() === month &&
        sDate.getDate() === day
      )
    }

    if (recurrenceDayOfWeek == null) return false
    const dayOfWeek = date.getDay()
    if (dayOfWeek !== recurrenceDayOfWeek) return false

    if (recurrencePattern === 'Weekly') return true

    if (recurrencePattern === 'Biweekly') {
      if (!startDate) return true
      const sDate = parseServerDate(startDate)
      sDate.setHours(0, 0, 0, 0)
      if (date < sDate) return false
      const diffDays = Math.round((date.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24))
      const diffWeeks = Math.floor(diffDays / 7)
      return diffWeeks % 2 === 0
    }

    if (recurrencePattern === 'MonthlyNthDay' && recurrenceWeekOfMonth != null) {
      const weekIndex = Math.floor((day - 1) / 7) + 1
      if (recurrenceWeekOfMonth === 5) {
        return day + 7 > daysInMonth
      }
      return weekIndex === recurrenceWeekOfMonth
    }

    return false
  }

  // Helper to find specific sessions on a given day
  const getSessionsForDay = (day: number): GroupSessionData[] => {
    return sessions.filter((s) => {
      const sDate = parseServerDate(s.startsAt)
      return (
        sDate.getFullYear() === year &&
        sDate.getMonth() === month &&
        sDate.getDate() === day
      )
    })
  }

  // Render days array
  const calendarCells = []
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarCells.push(null)
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarCells.push(day)
  }

  const selectedDaySessions = selectedDate ? getSessionsForDay(selectedDate.getDate()) : []
  const selectedDayIsRecurring = selectedDate ? isRecurringMeetingDay(selectedDate.getDate()) : false

  return (
    <div className="card" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>📅 Meeting Calendar</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="secondary" onClick={handlePrevMonth} style={{ padding: '0.25rem 0.6rem' }}>&lt;</button>
          <span style={{ fontWeight: 600, minWidth: '130px', textAlign: 'center' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button className="secondary" onClick={handleNextMonth} style={{ padding: '0.25rem 0.6rem' }}>&gt;</button>
          <button className="secondary" onClick={handleToday} style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}>Today</button>
        </div>
      </div>

      {meetingScheduleText && (
        <div style={{ marginBottom: '1rem' }}>
          <p className="tune-meta" style={{ marginTop: 0, marginBottom: '0.25rem', color: 'var(--accent)' }}>
            🕒 <strong>Schedule:</strong> {meetingScheduleText}
          </p>
          {meetingDescription && (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              💬 {meetingDescription}
            </p>
          )}
        </div>
      )}

      {/* Calendar Grid Header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontWeight: 600, fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '4px' }}>
        {DAYS_OF_WEEK.map((d) => (
          <div key={d} style={{ padding: '0.4rem 0' }}>{d}</div>
        ))}
      </div>

      {/* Calendar Grid Cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {calendarCells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} style={{ minHeight: '44px', background: 'transparent' }} />
          }

          const isRecurring = isRecurringMeetingDay(day)
          const specificSessions = getSessionsForDay(day)
          const hasSpecificSession = specificSessions.length > 0
          const isToday = new Date().toDateString() === new Date(year, month, day).toDateString()
          const isSelected = selectedDate?.getDate() === day

          let bg = 'var(--surface-3)'
          let border = '1px solid transparent'

          if (isToday) {
            border = '1px solid var(--accent)'
          }

          if (isRecurring || hasSpecificSession) {
            bg = 'rgba(77, 208, 165, 0.15)'
          }

          if (isSelected) {
            border = '2px solid var(--accent)'
          }

          return (
            <button
              key={`day-${day}`}
              onClick={() => setSelectedDate(new Date(year, month, day))}
              style={{
                minHeight: '44px',
                padding: '0.3rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: bg,
                border,
                borderRadius: '6px',
                color: 'var(--text)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: '0.85rem', fontWeight: isToday ? 700 : 400 }}>{day}</span>
              {(isRecurring || hasSpecificSession) && (
                <div style={{ display: 'flex', gap: '2px' }}>
                  {isRecurring && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} title="Group Meeting Day" />
                  )}
                  {hasSpecificSession && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3b82f6' }} title="Scheduled Session Event" />
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected Day Details Panel */}
      {selectedDate && (
        <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <h4 style={{ margin: '0 0 0.5rem 0' }}>
            Meeting Details for {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </h4>
          {!selectedDayIsRecurring && selectedDaySessions.length === 0 ? (
            <p className="tune-meta italic" style={{ margin: 0 }}>No meeting or session scheduled for this day.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {selectedDayIsRecurring && (
                <div style={{ padding: '0.5rem 0.75rem', background: 'var(--surface-3)', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)' }}>
                    <span>🔄</span>
                    <span><strong>Group Meeting:</strong> {meetingScheduleText || 'Regular meetup'} {meetingTime ? `(${meetingTime})` : ''}</span>
                  </div>
                  {meetingDescription && (
                    <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                      {meetingDescription}
                    </p>
                  )}
                </div>
              )}
              {selectedDaySessions.map((s) => (
                <div key={s.groupSessionId} style={{ padding: '0.5rem 0.75rem', background: 'var(--surface-3)', borderRadius: '6px', borderLeft: '3px solid #3b82f6' }}>
                  <strong>📍 {s.title}</strong> {s.location ? `at ${s.location}` : ''} ({parseServerDate(s.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  {s.notes && (
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                      💬 <strong>Notes / Description:</strong> {s.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
