"use client";

import { activeToasts, useSignal } from '../state/appState'

export function ToastContainer() {
  const toasts = useSignal(activeToasts)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type}`}>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => {
              activeToasts.value = activeToasts.value.filter((t) => t.id !== toast.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
