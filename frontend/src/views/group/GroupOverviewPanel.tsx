"use client";

import { useQuery } from '@tanstack/react-query'
import { getGroupSessions } from '../../services/api'
import { useAuthStatus } from '../../state/appState'
import { GroupCalendar } from '../../components/GroupCalendar'
import { GroupSessions } from '../../components/GroupSessions'
import { GroupUpdates } from '../../components/GroupUpdates'
import { useGroupDetail } from './groupDetailContext'

export function GroupOverviewPanel() {
  const { groupId, userId, details, isAdmin, isMember } = useGroupDetail()
  const authStatus = useAuthStatus()

  const sessionsQuery = useQuery({
    queryKey: ['group-sessions', groupId, userId],
    queryFn: () => getGroupSessions(groupId, userId),
    enabled: authStatus !== 'pending',
  })

  return (
    <div>
      <GroupCalendar
        groupId={groupId}
        userId={userId}
        isAdmin={isAdmin}
        isMember={isMember}
        schedules={details.schedules ?? []}
        sessions={sessionsQuery.data ?? []}
        timeZone={details.timeZone}
      />

      <div style={{ marginTop: '2rem' }}>
        <GroupSessions
          groupId={groupId}
          userId={userId}
          isAdmin={isAdmin}
          isMember={isMember}
        />
      </div>

      <div style={{ marginTop: '2rem' }}>
        <GroupUpdates
          groupId={groupId}
          userId={userId}
          isAdmin={isAdmin}
          updates={details.updates ?? []}
        />
      </div>
    </div>
  )
}
