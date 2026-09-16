import { Navigate } from 'react-router-dom'
import { currentUserId, useAuthStatus, useSignal } from '../../state/appState'

/**
 * /practice lands on the daily queue, which needs an account — so signed-out
 * visitors go to ear training, the first tab they can use.
 */
export default function PracticeIndexRedirect() {
  const userId = useSignal(currentUserId)
  const status = useAuthStatus()
  if (status === 'pending') return null
  return <Navigate to={userId ? '/practice/queue' : '/practice/ear'} replace />
}
