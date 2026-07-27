"use client";

import { useEffect, type ReactNode } from 'react'

interface DialogProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children: ReactNode
  maxWidth?: string
}

export function Dialog({ isOpen, title, onClose, children, maxWidth = '480px' }: DialogProps) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth }}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginTop: '1rem' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
