"use client";

import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Every dialog currently open, innermost last. A dialog can be opened from inside another — the
 * settings modal's "add an alternate name", say — and both listen for Escape and Tab on the window,
 * so without knowing which one is on top, Escape closed the pair of them and the trap of the dialog
 * behind fought the one in front for the focus.
 */
const openDialogs: symbol[] = []

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

  /*
   * The callbacks the key handler needs, read fresh when a key arrives rather than captured.
   *
   * Callers pass them as inline arrows, so they are new on every render — as a dependency they had
   * the effect below tear down and set up again on each keystroke inside the dialog, and its
   * cleanup puts focus back where the dialog opened from. Typing in a dialog's field therefore
   * kicked focus out of it and onto the close button.
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onRequestCloseRef = useRef(onRequestClose)
  onRequestCloseRef.current = onRequestClose

  const requestClose = () => {
    if (onRequestCloseRef.current && !onRequestCloseRef.current()) return
    onCloseRef.current()
  }

  useEffect(() => {
    if (!isOpen) return

    const me = Symbol('dialog')
    openDialogs.push(me)
    const isTopmost = () => openDialogs[openDialogs.length - 1] === me

    // Send focus into the dialog and put it back where it came from on close, so keyboard users
    // don't get dropped at the top of the document. A dialog that exists to be typed into can mark
    // its field with data-autofocus; otherwise focus lands on the first thing in it, which is the
    // close button in the header — and React's own autoFocus loses to this, so it is no use there.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first =
      contentRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      contentRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? contentRef.current)?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      // Keys belong to whichever dialog is in front; this one waits its turn.
      if (!isTopmost()) return
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
      const at = openDialogs.indexOf(me)
      if (at !== -1) openDialogs.splice(at, 1)
      previouslyFocused?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

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
