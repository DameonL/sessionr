"use client";

import { activeErrorReport, dismissErrorReport, showToast, useSignal } from '../state/appState'

/**
 * Global surface for genuine error responses. Unlike toasts it persists until
 * dismissed and shows the full backend diagnostic (status + message + detail/
 * stack), with a copy button — so failures are legible on mobile, where the raw
 * network response isn't otherwise accessible. Fed by the QueryClient's
 * MutationCache onError (see services/queryClient.ts) and reportError().
 */
export function ErrorReportModal() {
  const report = useSignal(activeErrorReport)
  if (!report) return null

  const copyText = [
    report.title,
    report.status != null ? `Status: HTTP ${report.status}` : null,
    report.message,
    report.detail ? `\n${report.detail}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const copyDetails = () => {
    navigator.clipboard
      ?.writeText(copyText)
      .then(() => showToast('Error details copied', 'success'))
      .catch(() => showToast('Could not copy to clipboard', 'error'))
  }

  return (
    <div className="error-report-overlay" role="alertdialog" aria-modal="true" onClick={dismissErrorReport}>
      <div className="error-report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="error-report-header">
          <span className="error-report-title">⚠️ {report.title}</span>
          <button className="error-report-close" onClick={dismissErrorReport} aria-label="Dismiss">
            ✕
          </button>
        </div>

        {report.status != null && <div className="error-report-status">HTTP {report.status}</div>}

        <p className="error-report-message">{report.message}</p>

        {report.detail && <pre className="error-report-detail">{report.detail}</pre>}

        <div className="error-report-actions">
          <button className="error-report-btn" onClick={copyDetails}>
            Copy details
          </button>
          <button className="error-report-btn error-report-btn-primary" onClick={dismissErrorReport}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
