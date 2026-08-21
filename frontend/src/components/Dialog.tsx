"use client";

import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children: ReactNode
  maxWidth?: string
  /**
   * Consulted before Escape or a backdrop click closes the dialog; return false to keep it open.
   * Use it to guard unsaved work — the close button and any in-content Cancel are unaffected, so
   * a dialog with nothing at stake still closes on the first click.
   */
  onRequestClose?: () => boolean
  /** Extra class on the content element, e.g. to widen a specific dialog. */
  className?: string
}

export function Dialog({
  isOpen,
  title,
  onClose,
  children,
  maxWidth = '480px',
  onRequestClose,
  className,
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const requestClose = () => {
    if (onRequestClose && !onRequestClose()) return
    onClose()
  }

  useEffect(() => {
    if (!isOpen) return

    // Send focus into the dialog and put it back where it came from on close, so keyboard users
    // don't get dropped at the top of the document.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? contentRef.current)?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose()
        return
      }
      if (e.key !== 'Tab') return

      // Trap Tab inside the dialog; without this it walks into the page behind.
      const focusable = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose, onRequestClose])

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        ref={contentRef}
        className={`modal-content card${className ? ` ${className}` : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth }}
      >
        <div className="modal-header">
          <h2 id={titleId} style={{ margin: 0 }}>{title}</h2>
          <button className="close-button" onClick={onClose} aria-label="Close dialog">✕</button>
        </div>
        <div style={{ marginTop: '1rem' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
