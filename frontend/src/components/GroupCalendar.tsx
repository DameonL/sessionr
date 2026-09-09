"use client";

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import {
  addGroupScheduleException,
  deleteGroupScheduleException,
  rsvpToGroupSession,
  rsvpToGroupScheduleDate,
  type GroupSessionData,
  type GroupMeetingScheduleData,
  type RsvpStatus,
  parseServerDate,
} from '../services/api'
import { showToast } from '../state/appState'

interface GroupCalendarProps {
  groupId: string
  userId: string
  isAdmin: boolean
  isMember?: boolean
  schedules?: GroupMeetingScheduleData[]
  sessions: GroupSessionData[]
  timeZone?: string | null
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const RSVP_LABELS: Record<RsvpStatus, string> = { Going: 'Going', Maybe: 'Maybe', NotGoing: "Can't Go" }

export function GroupCalendar({
  groupId,
  userId,
  isAdmin,
  isMember = false,
  schedules = [],
  sessions,
  timeZone = 'UTC',
}: GroupCalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const queryClient = useQueryClient()

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['group-details', groupId, userId] })

  const rsvpMutation = useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: string; status: RsvpStatus }) =>
      rsvpToGroupSession(groupId, sessionId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-sessions', groupId, userId] })
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to update RSVP status.', 'error')
    },
  })

  const rsvpScheduleDateMutation = useMutation({
    mutationFn: ({ scheduleId, date, status }: { scheduleId: string; date: string; status: RsvpStatus }) =>
      rsvpToGroupScheduleDate(groupId, scheduleId, date, status),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['group-sessions', groupId, userId] })
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to update RSVP status.', 'error')
    },
  })

  const addExceptionMutation = useMutation({
    mutationFn: ({ scheduleId, exceptionDate }: { scheduleId: string; exceptionDate: string }) =>
      addGroupScheduleException(groupId, scheduleId, exceptionDate),
    onSuccess: () => {
      invalidate()
      showToast('Meeting cancelled for that date.')
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to cancel this date.', 'error')
    },
  })

  const deleteExceptionMutation = useMutation({
    mutationFn: ({ scheduleId, exceptionId }: { scheduleId: string; exceptionId: string }) =>
      deleteGroupScheduleException(groupId, scheduleId, exceptionId),
    onSuccess: () => {
      invalidate()
      showToast('Meeting restored.')
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to restore this date.', 'error')
    },
  })

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

  const allSchedules = schedules
    .filter((s) => s.recurrencePattern !== 'None')
    .map((s) => ({
      id: s.groupMeetingScheduleId,
      name: s.name,
      pattern: s.recurrencePattern,
      dayOfWeek: s.recurrenceDayOfWeek,
      weekOfMonth: s.recurrenceWeekOfMonth,
      start: s.startDate,
      time: s.meetingTime,
      text: s.meetingScheduleText,
      desc: s.meetingDescription,
      exceptions: s.exceptions ?? [],
    }))

  // Test if a schedule matches a specific day in the month
  const matchesSchedule = (sch: typeof allSchedules[0], day: number): boolean => {
    const date = new Date(year, month, day)
    date.setHours(0, 0, 0, 0)

    if (sch.pattern === 'SpecificDate' && sch.start) {
      const sDate = parseServerDate(sch.start)
      return (
        sDate.getFullYear() === year &&
        sDate.getMonth() === month &&
        sDate.getDate() === day
      )
    }

    if (sch.dayOfWeek == null) return false
    const dayOfWeek = date.getDay()
    if (dayOfWeek !== sch.dayOfWeek) return false

    if (sch.pattern === 'Weekly') return true

    if (sch.pattern === 'Biweekly') {
      if (!sch.start) return true
      const sDate = parseServerDate(sch.start)
      sDate.setHours(0, 0, 0, 0)
      if (date < sDate) return false
      const diffDays = Math.round((date.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24))
      const diffWeeks = Math.floor(diffDays / 7)
      return diffWeeks % 2 === 0
    }

    if (sch.pattern === 'MonthlyNthDay' && sch.weekOfMonth != null) {
      const weekIndex = Math.floor((day - 1) / 7) + 1
      if (sch.weekOfMonth === 5) {
        return day + 7 > daysInMonth
      }
      return weekIndex === sch.weekOfMonth
    }

    return false
  }

  const isExcepted = (sch: typeof allSchedules[0], day: number) => {
    const date = new Date(year, month, day)
    return sch.exceptions.find((ex) => {
      const exDate = parseServerDate(ex.exceptionDate)
      return exDate.getFullYear() === date.getFullYear() && exDate.getMonth() === date.getMonth() && exDate.getDate() === date.getDate()
    })
  }

  const getMatchingSchedulesForDay = (day: number) => {
    return allSchedules
      .filter((sch) => matchesSchedule(sch, day))
      .map((sch) => ({ ...sch, exception: isExcepted(sch, day) }))
  }

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

  const selectedDaySchedules = selectedDate ? getMatchingSchedulesForDay(selectedDate.getDate()) : []
  const selectedDaySessions = selectedDate ? getSessionsForDay(selectedDate.getDate()) : []

  const toIsoDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  const isPastScheduleDate = (date: Date, meetingTimeStr?: string | null) => {
    const now = new Date()
    const d = new Date(date)
    if (meetingTimeStr) {
      const [h, m] = meetingTimeStr.split(':').map(Number)
      if (!isNaN(h) && !isNaN(m)) {
        d.setHours(h, m, 0, 0)
      } else {
        d.setHours(23, 59, 59, 999)
      }
    } else {
      d.setHours(23, 59, 59, 999)
    }
    return d < now
  }

  const isSessionPast = (startsAtIso: string) => {
    return parseServerDate(startsAtIso) < new Date()
  }

  // Deduplicate schedules: if a GroupSession already exists for a schedule on the selected date,
  // hide the un-materialized schedule template card so the user sees only ONE card for the meeting.
  const displayDaySchedules = selectedDaySchedules.filter((sch) => {
    if (sch.exception) return true
    const hasMatchingSession = selectedDaySessions.some((s) => {
      if (!sch.time) return true
      const sDate = parseServerDate(s.startsAt)
      const [h, m] = sch.time.split(':').map(Number)
      if (!isNaN(h) && !isNaN(m)) {
        return sDate.getHours() === h && sDate.getMinutes() === m
      }
      return true
    })
    return !hasMatchingSession
  })

  return (
    <div className="card" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>📅 Meeting Calendar</h2>
          <span className="tune-meta" style={{ fontSize: '0.8rem', marginTop: '0.2rem', display: 'inline-block' }}>
            🌐 Group Time Zone: <strong>{timeZone}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="secondary" onClick={handlePrevMonth} style={{ padding: '0.25rem 0.6rem' }}>&lt;</button>
          <span style={{ fontWeight: 600, minWidth: '130px', textAlign: 'center' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button className="secondary" onClick={handleNextMonth} style={{ padding: '0.25rem 0.6rem' }}>&gt;</button>
          <button className="secondary" onClick={handleToday} style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}>Today</button>
        </div>
      </div>

      {allSchedules.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <strong style={{ color: 'var(--accent)', fontSize: '0.9rem' }}>🕒 Meeting Schedules:</strong>
          <ul style={{ margin: '0.35rem 0 0 0', paddingLeft: '1.25rem', fontSize: '0.85rem' }}>
            {allSchedules.map((sch, i) => (
              <li key={i} style={{ marginBottom: '0.2rem' }}>
                <strong>{sch.name ? `${sch.name} (${sch.text || 'Regular meetup'})` : (sch.text || 'Regular meetup')}</strong> {sch.desc ? `— ${sch.desc}` : ''}
              </li>
            ))}
          </ul>
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

          const daySchedules = getMatchingSchedulesForDay(day)
          const specificSessions = getSessionsForDay(day)
          const unmaterializedSchedules = daySchedules.filter((sch) => {
            if (sch.exception) return false
            return !specificSessions.some((s) => {
              if (!sch.time) return true
              const sDate = parseServerDate(s.startsAt)
              const [h, m] = sch.time.split(':').map(Number)
              return !isNaN(h) && !isNaN(m) ? sDate.getHours() === h && sDate.getMinutes() === m : true
            })
          })
          const isRecurring = unmaterializedSchedules.length > 0
          const allCancelled = daySchedules.length > 0 && daySchedules.every((s) => s.exception)
          const hasSpecificSession = specificSessions.length > 0
          const isToday = new Date().toDateString() === new Date(year, month, day).toDateString()
          const isSelected = selectedDate?.getDate() === day

          let bg = 'var(--surface-3)'
          let border = '1px solid transparent'

          if (isToday) {
            border = '1px solid var(--accent)'
          }

          if (isRecurring || hasSpecificSession) {
            bg = 'var(--accent-soft)'
          } else if (allCancelled) {
            bg = 'var(--hover-bg)'
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
              {(isRecurring || hasSpecificSession || allCancelled) && (
                <div style={{ display: 'flex', gap: '2px' }}>
                  {isRecurring && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} title="Group Meeting Day" />
                  )}
                  {!isRecurring && allCancelled && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--muted)' }} title="Meeting Cancelled" />
                  )}
                  {hasSpecificSession && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--brand-2)' }} title="Scheduled Session Event" />
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
          {displayDaySchedules.length === 0 && selectedDaySessions.length === 0 ? (
            <p className="tune-meta italic" style={{ margin: 0 }}>No meeting or session scheduled for this day.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {displayDaySchedules.map((sch, i) => {
                const isPast = isPastScheduleDate(selectedDate, sch.time)
                const hasExistingSession = selectedDaySessions.length > 0

                return (
                  <div
                    key={i}
                    style={{
                      padding: '0.5rem 0.75rem',
                      background: 'var(--surface-3)',
                      borderRadius: '6px',
                      borderLeft: `3px solid ${sch.exception ? 'var(--muted)' : 'var(--accent)'}`,
                      opacity: sch.exception ? 0.75 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: sch.exception ? 'var(--muted)' : 'var(--accent)' }}>
                        <span>{sch.exception ? '🚫' : '🔄'}</span>
                        <span>
                          <strong>{sch.exception ? 'Cancelled: ' : 'Group Meeting: '}</strong>
                          <span style={{ textDecoration: sch.exception ? 'line-through' : 'none' }}>
                            {sch.name ? <strong>{sch.name} </strong> : null}
                            {sch.name ? `(${sch.text || 'Regular meetup'})` : (sch.text || 'Regular meetup')}
                          </span>
                        </span>
                      </div>
                      {isAdmin && sch.pattern !== 'SpecificDate' && !isPast && (
                        sch.exception ? (
                          <button
                            className="secondary"
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                            disabled={deleteExceptionMutation.isPending}
                            onClick={() => deleteExceptionMutation.mutate({ scheduleId: sch.id, exceptionId: sch.exception!.groupScheduleExceptionId })}
                          >
                            Un-cancel
                          </button>
                        ) : (
                          <button
                            className="secondary"
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                            disabled={addExceptionMutation.isPending}
                            onClick={() => addExceptionMutation.mutate({ scheduleId: sch.id, exceptionDate: toIsoDate(selectedDate) })}
                          >
                            Cancel this date
                          </button>
                        )
                      )}
                    </div>
                    {sch.desc && (
                      <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                        {sch.desc}
                      </p>
                    )}

                    {/* Show RSVP options on schedule card if no session exists yet for this day */}
                    {!sch.exception && !hasExistingSession && (
                      <div style={{ marginTop: '0.5rem' }}>
                        {isPast ? (
                          <span className="tune-meta italic" style={{ fontSize: '0.8rem' }}>
                            ⏳ Past meeting — RSVPs closed
                          </span>
                        ) : isMember ? (
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {(['Going', 'Maybe', 'NotGoing'] as RsvpStatus[]).map((status) => (
                              <button
                                key={status}
                                className="secondary"
                                style={{ padding: '0.2rem 0.55rem', fontSize: '0.8rem' }}
                                onClick={() =>
                                  rsvpScheduleDateMutation.mutate({
                                    scheduleId: sch.id,
                                    date: toIsoDate(selectedDate),
                                    status,
                                  })
                                }
                                disabled={rsvpScheduleDateMutation.isPending}
                              >
                                {RSVP_LABELS[status]}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="tune-meta" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                            <Link href="/login" prefetch={false}>Sign in</Link> and join group to RSVP.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {selectedDaySessions.map((s) => {
                const goingAttendees = (s.attendees ?? []).filter((a) => a.status === 'Going')
                const maybeAttendees = (s.attendees ?? []).filter((a) => a.status === 'Maybe')
                const isPast = isSessionPast(s.startsAt)

                return (
                  <div key={s.groupSessionId} style={{ padding: '0.65rem 0.75rem', background: 'var(--surface-3)', borderRadius: '6px', borderLeft: '3px solid var(--brand-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <strong>📍 {s.isCancelled ? '❌ ' : ''}{s.title}</strong> {s.location ? `at ${s.location}` : ''} ({parseServerDate(s.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                      </div>
                      <div className="tune-meta" style={{ fontSize: '0.8rem' }}>
                        {s.goingCount} going · {s.maybeCount} maybe · {s.notGoingCount} can&apos;t go
                      </div>
                    </div>

                    {s.notes && (
                      <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                        💬 <strong>Notes / Description:</strong> {s.notes}
                      </p>
                    )}

                    {(goingAttendees.length > 0 || maybeAttendees.length > 0) && (
                      <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--surface-2)', borderRadius: '6px', fontSize: '0.8rem' }}>
                        {goingAttendees.length > 0 && (
                          <div style={{ marginBottom: maybeAttendees.length > 0 ? '0.25rem' : 0 }}>
                            <strong style={{ color: 'var(--accent)' }}>✅ Going ({goingAttendees.length}):</strong>{' '}
                            <span>{goingAttendees.map((a) => a.displayName).join(', ')}</span>
                          </div>
                        )}
                        {maybeAttendees.length > 0 && (
                          <div>
                            <strong style={{ color: 'var(--learning)' }}>❓ Maybe ({maybeAttendees.length}):</strong>{' '}
                            <span>{maybeAttendees.map((a) => a.displayName).join(', ')}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {!s.isCancelled && (
                      isPast ? (
                        <div style={{ marginTop: '0.5rem' }}>
                          <span className="tune-meta italic" style={{ fontSize: '0.8rem' }}>
                            ⏳ Past event — RSVPs closed
                          </span>
                        </div>
                      ) : isMember ? (
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          {(['Going', 'Maybe', 'NotGoing'] as RsvpStatus[]).map((status) => (
                            <button
                              key={status}
                              className={s.viewerRsvpStatus === status ? '' : 'secondary'}
                              style={{ padding: '0.2rem 0.55rem', fontSize: '0.8rem' }}
                              onClick={() => rsvpMutation.mutate({ sessionId: s.groupSessionId, status })}
                              disabled={rsvpMutation.isPending}
                            >
                              {RSVP_LABELS[status]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="tune-meta" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                          <Link href="/login" prefetch={false}>Sign in</Link> and join group to RSVP.
                        </p>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
