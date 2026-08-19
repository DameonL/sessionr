import { Navigate } from 'react-router-dom'
import { GroupAdminSettings } from '../../components/GroupAdminSettings'
import { useGroupDetail } from './groupDetailContext'

export function GroupSettingsPanel() {
  const { groupId, userId, isOwner, isAdmin, details, invalidate } = useGroupDetail()

  if (!isAdmin) {
    return <Navigate to={`/group/${groupId}`} replace />
  }

  return (
    <GroupAdminSettings
      details={details}
      userId={userId}
      isOwner={isOwner}
      onSaved={invalidate}
    />
  )
}
