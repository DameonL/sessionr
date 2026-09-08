"use client";

import { useQuery } from '@tanstack/react-query'
import { getTuneDetails, formatTuneType } from '../services/api'
import { useAuthStatus } from '../state/appState'
import { Dialog } from './Dialog'
import { TuneView } from './TuneView'

interface TuneSettingsModalProps {
  tuneId: string
  onClose: () => void
  onAdded: () => void
  userTuneId?: string
  /** The setting currently in effect, so it can be marked and previewed first. */
  currentTuneSettingId?: string | null
  /** False when currentTuneSettingId was resolved from votes rather than chosen by the user. */
  isPinnedSetting?: boolean
  /** Overrides the default repertoire add/switch action (e.g. for a group's master tune list). */
  onSelectSetting?: (settingId: string) => Promise<unknown>
  /** Label for the per-setting action button; defaults based on userTuneId/onSelectSetting. */
  actionLabel?: string
}

/**
 * The tune screen in a dialog. Everything inside it is TuneView, which the Tune Library page
 * renders too — the two used to be separate copies of the same screen and drifted apart.
 */
export function TuneSettingsModal({
  tuneId,
  onClose,
  onAdded,
  userTuneId,
  currentTuneSettingId,
  isPinnedSetting,
  onSelectSetting,
  actionLabel,
}: TuneSettingsModalProps) {
  const authStatus = useAuthStatus()
  // Titling the dialog needs the tune's name before its content has rendered. Same query key as
  // TuneView's, so this reads the cache rather than fetching a second time.
  const { data: details } = useQuery({
    queryKey: ['tune-details', tuneId],
    queryFn: () => getTuneDetails(tuneId),
    enabled: authStatus !== 'pending',
  })

  return (
    <Dialog
      isOpen
      title={details?.title ?? 'Loading tune…'}
      onClose={onClose}
      className="tune-settings-modal"
      maxWidth="680px"
    >
      <TuneView
        tuneId={tuneId}
        variant="modal"
        header={(d) => (
          <p className="tune-meta" style={{ marginTop: 0 }}>{formatTuneType(d.tuneType)}</p>
        )}
        userTuneId={userTuneId}
        currentTuneSettingId={currentTuneSettingId}
        isPinnedSetting={isPinnedSetting}
        onSelectSetting={onSelectSetting}
        actionLabel={actionLabel}
        onApplied={() => {
          onAdded()
          onClose()
        }}
      />
    </Dialog>
  )
}
