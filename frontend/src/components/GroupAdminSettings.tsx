"use client";

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GroupDetails, updateGroupInfo, replaceGroupSchedules, deleteGroup } from '../services/api'
import { GroupScheduleBuilder, ScheduleDraft, generateScheduleText } from './GroupScheduleBuilder'
import { GroupUpdates } from './GroupUpdates'
import { showToast } from '../state/appState'
import { getDetectedTimeZone, getTimeZoneGroups } from '../utils/timezones'

interface GroupAdminSettingsProps {
  details: GroupDetails
  userId: string
  isOwner: boolean
  onSaved: () => void
}

export function GroupAdminSettings({ details, userId, isOwner, onSaved }: GroupAdminSettingsProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  // General Info State
  const [name, setName] = useState(details.name)
  const [description, setDescription] = useState(details.description ?? '')
  const [city, setCity] = useState(details.city ?? '')
  const [isPrivate, setIsPrivate] = useState(details.isPrivate)
  const [timeZone, setTimeZone] = useState(details.timeZone || 'UTC')
  const [tzFilter, setTzFilter] = useState('')
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)

  const detectedTz = getDetectedTimeZone()
  const timeZoneGroups = getTimeZoneGroups(tzFilter, timeZone)

  // Schedules State
  const [schedules, setSchedules] = useState<ScheduleDraft[]>(() =>
    (details.schedules ?? []).map((s) => ({
      id: s.groupMeetingScheduleId,
      name: s.name ?? '',
      recurrencePattern: s.recurrencePattern,
      recurrenceDayOfWeek: s.recurrenceDayOfWeek ?? 3,
      recurrenceWeekOfMonth: s.recurrenceWeekOfMonth ?? 1,
      startDate: s.startDate ? s.startDate.split('T')[0] : '',
      meetingTime: s.meetingTime ?? '19:30',
      meetingDescription: s.meetingDescription ?? '',
    }))
  )
  const [schedulesSaving, setSchedulesSaving] = useState(false)
  const [schedulesError, setSchedulesError] = useState<string | null>(null)

  // Delete Group State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const deleteMutation = useMutation({
    mutationFn: () => deleteGroup(details.groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', userId] })
      showToast('Group deleted successfully.', 'success')
      router.push('/groups')
    },
  })

  const canDelete = deleteConfirmText.trim().toLowerCase() === details.name.trim().toLowerCase() && !deleteMutation.isPending

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !description.trim()) return

    setInfoSaving(true)
    setInfoError(null)

    try {
      await updateGroupInfo(details.groupId, {
        name: name.trim(),
        description: description.trim(),
        city: city.trim() || undefined,
        isPrivate,
        timeZone: timeZone.trim() || 'UTC',
      })
      showToast('Group details updated successfully!')
      onSaved()
    } catch (err: any) {
      setInfoError(err.message || 'Failed to update group details.')
    } finally {
      setInfoSaving(false)
    }
  }

  const handleSchedulesSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSchedulesSaving(true)
    setSchedulesError(null)

    try {
      const formattedSchedules = schedules.map((s) => ({
        name: s.name.trim() || undefined,
        recurrencePattern: s.recurrencePattern,
        recurrenceDayOfWeek: s.recurrencePattern !== 'SpecificDate' ? s.recurrenceDayOfWeek : undefined,
        recurrenceWeekOfMonth: s.recurrencePattern === 'MonthlyNthDay' ? s.recurrenceWeekOfMonth : undefined,
        startDate: s.startDate ? new Date(s.startDate).toISOString() : undefined,
        meetingTime: s.meetingTime || undefined,
        meetingScheduleText: generateScheduleText(s),
        meetingDescription: s.meetingDescription.trim() || undefined,
      }))

      await replaceGroupSchedules(details.groupId, formattedSchedules)
      showToast('Meeting schedules updated successfully!')
      onSaved()
    } catch (err: any) {
      setSchedulesError(err.message || 'Failed to update meeting schedules.')
    } finally {
      setSchedulesSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* 1. General Group Info Form */}
      <form className="card" onSubmit={handleInfoSubmit} style={{ padding: '1.5rem', background: 'var(--surface-2)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>⚙️ General Group Settings</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Group Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{ width: '100%' }}
              disabled={infoSaving}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
              Group Description * {isPrivate && <span className="tune-meta">(Hidden for non-members on private groups)</span>}
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              style={{ width: '100%', resize: 'vertical' }}
              disabled={infoSaving}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>City / Location</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Dublin, Ireland or Boston, MA"
                style={{ width: '100%' }}
                disabled={infoSaving}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '0.25rem' }}>
                <label style={{ fontWeight: 600 }}>Group Time Zone</label>
                {detectedTz && detectedTz !== timeZone && (
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', margin: 0 }}
                    onClick={() => setTimeZone(detectedTz)}
                  >
                    📍 Use My Local Time Zone ({detectedTz})
                  </button>
                )}
              </div>

              <input
                type="text"
                value={tzFilter}
                onChange={(e) => setTzFilter(e.target.value)}
                placeholder="🔍 Search time zones (e.g. London, York, UTC-05)..."
                style={{ width: '100%', marginBottom: '0.35rem', fontSize: '0.85rem' }}
                disabled={infoSaving}
              />

              <select
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                style={{ width: '100%' }}
                disabled={infoSaving}
              >
                {timeZoneGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((tz) => (
                      <option key={`${group.label}-${tz.id}`} value={tz.id}>
                        {tz.displayName}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              disabled={infoSaving}
              style={{ margin: 0, width: '1.1rem', height: '1.1rem', cursor: 'pointer', flexShrink: 0 }}
            />
            <span>Private group (new members must be approved or use an invite code)</span>
          </label>

          {infoError && <p className="error" style={{ margin: 0 }}>{infoError}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="submit" disabled={infoSaving || !name.trim() || !description.trim()}>
              {infoSaving ? 'Saving…' : 'Save Group Details'}
            </button>
          </div>
        </div>
      </form>

      {/* 2. Meeting Schedules Builder */}
      <form className="card" onSubmit={handleSchedulesSubmit} style={{ padding: '1.5rem', background: 'var(--surface-2)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>📅 Meeting Schedules & Recurrence</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <GroupScheduleBuilder
            schedules={schedules}
            onChange={setSchedules}
            disabled={schedulesSaving}
          />

          {schedulesError && <p className="error" style={{ margin: 0 }}>{schedulesError}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="submit" disabled={schedulesSaving}>
              {schedulesSaving ? 'Saving…' : 'Save Schedules'}
            </button>
          </div>
        </div>
      </form>

      {/* 3. Group Feed Updates & Announcements */}
      <div className="card" style={{ padding: '1.5rem', background: 'var(--surface-2)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>📢 Group Feed Announcements & Updates</h3>
        <p className="tune-meta" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
          Post updates, announcements, or pub session news to the group feed. Administrators can also delete existing updates.
        </p>

        <GroupUpdates
          groupId={details.groupId}
          userId={userId}
          isAdmin={true}
          updates={details.updates ?? []}
        />
      </div>

      {/* 4. Danger Zone: Delete Group (Owner Only) */}
      {isOwner && (
        <div className="card" style={{ padding: '1.5rem', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid var(--danger)' }}>
          <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>⚠️ Danger Zone</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
            As the owner, you can permanently delete this group, its meeting schedules, shared sets, and membership records. This action cannot be undone.
          </p>

          {!showDeleteConfirm ? (
            <button
              type="button"
              style={{ background: 'var(--danger)', color: '#fff' }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Group
            </button>
          ) : (
            <div style={{ background: 'var(--surface-1)', padding: '1.25rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0 }}>
                To confirm permanent deletion of <strong>{details.name}</strong>, type the group name below:
              </p>

              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={details.name}
                style={{ width: '100%' }}
                disabled={deleteMutation.isPending}
              />

              {deleteMutation.isError && (
                <p className="error" style={{ margin: 0 }}>
                  {(deleteMutation.error as Error).message || 'Failed to delete the group.'}
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{ background: 'var(--danger)', color: '#fff' }}
                  disabled={!canDelete}
                  onClick={() => deleteMutation.mutate()}
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Permanently Delete Group'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
