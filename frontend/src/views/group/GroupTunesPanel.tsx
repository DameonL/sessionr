"use client";

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  searchTunes,
  addGroupTune,
  updateGroupTune,
  removeGroupTune,
  formatTuneType,
  type GroupTuneListItem,
} from '../../services/api'
import { normalizeTitleForSorting } from '../../services/abcTools'
import { TuneSettingsModal } from '../../components/TuneSettingsModal'
import { useGroupDetail } from './groupDetailContext'

export function GroupTunesPanel() {
  const { groupId, isAdmin, details, invalidate } = useGroupDetail()

  const [tuneSearchInput, setTuneSearchInput] = useState('')
  const [submittedTuneSearch, setSubmittedTuneSearch] = useState('')
  const [addTuneId, setAddTuneId] = useState<string | null>(null)
  const [settingChangeTarget, setSettingChangeTarget] = useState<GroupTuneListItem | null>(null)

  const librarySearch = useQuery({
    queryKey: ['tunes', submittedTuneSearch],
    queryFn: () => searchTunes(submittedTuneSearch),
    enabled: submittedTuneSearch.length >= 2,
  })

  const removeGroupTuneMutation = useMutation({
    mutationFn: (groupTuneId: string) => removeGroupTune(groupId, groupTuneId),
    onSuccess: invalidate,
  })

  const masterTuneIds = new Set(details.masterTunes.map((t) => t.tuneId))
  const librarySearchMatches = (librarySearch.data?.items ?? []).filter((t) => !masterTuneIds.has(t.tuneId))

  return (
    <div>
      <h2>Master Tune List</h2>
      <p className="tune-meta italic">
        The curated list of tunes this group plays, including the specific setting used for each.
        {isAdmin ? ' As an administrator, you can add, remove, and change settings below.' : ' Only group administrators can edit this list.'}
      </p>

      {details.masterTunes.length === 0 ? (
        <p className="tune-meta italic">No tunes on the master list yet.</p>
      ) : (
        <ul className="tune-list">
          {[...details.masterTunes]
            .sort((a, b) => normalizeTitleForSorting(a.title).localeCompare(normalizeTitleForSorting(b.title)))
            .map((t) => (
            <li key={t.groupTuneId} className="card tune-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ flex: 1 }}>
                <span className="tune-title">{t.title}</span>
                <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                  {formatTuneType(t.tuneType)} · Key: {t.key}
                  {t.settingSubmitterName ? ` · Setting by ${t.settingSubmitterName}` : ''}
                  {' · added by '}{t.addedByDisplayName}
                </span>
              </div>

              {isAdmin && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="secondary"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                    onClick={() => setSettingChangeTarget(t)}
                  >
                    Change Setting
                  </button>
                  <button
                    className="secondary danger-hover"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                    onClick={() => removeGroupTuneMutation.mutate(t.groupTuneId)}
                    disabled={removeGroupTuneMutation.isPending}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div style={{ marginTop: '2rem' }}>
          <h3>Add a Tune</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setSubmittedTuneSearch(tuneSearchInput.trim())
            }}
            style={{ display: 'flex', gap: '0.5rem' }}
          >
            <input
              className="search-box"
              type="search"
              placeholder="Search tunes to add… (title or alternate name)"
              value={tuneSearchInput}
              onChange={(e) => setTuneSearchInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" style={{ padding: '0.45rem 1rem' }}>
              🔍 Search
            </button>
          </form>

          {submittedTuneSearch.length >= 2 && (
            <ul className="tune-list" style={{ marginTop: '0.75rem' }}>
              {librarySearchMatches.length === 0 && <p className="tune-meta italic">No matches found.</p>}
              {librarySearchMatches.map((tune) => (
                <li key={tune.tuneId} className="card tune-row">
                  <span className="tune-title">{tune.title}</span>
                  <span className="tune-meta">
                    {formatTuneType(tune.tuneType)} · {tune.key}
                  </span>
                  <button onClick={() => setAddTuneId(tune.tuneId)}>+ Add</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {addTuneId !== null && (
        <TuneSettingsModal
          tuneId={addTuneId}
          onClose={() => setAddTuneId(null)}
          onAdded={invalidate}
          onSelectSetting={(settingId) => addGroupTune(groupId, addTuneId, settingId)}
          actionLabel="+ Add to Master List"
        />
      )}

      {settingChangeTarget !== null && (
        <TuneSettingsModal
          tuneId={settingChangeTarget.tuneId}
          onClose={() => setSettingChangeTarget(null)}
          onAdded={invalidate}
          onSelectSetting={(settingId) => updateGroupTune(groupId, settingChangeTarget.groupTuneId, settingId)}
          actionLabel="Use this setting"
        />
      )}
    </div>
  )
}
