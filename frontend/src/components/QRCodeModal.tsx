"use client";

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Dialog } from './Dialog'
import { showToast } from '../state/appState'

interface QRCodeModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  url: string
  downloadFilename?: string
}

export function QRCodeModal({
  isOpen,
  onClose,
  title,
  subtitle,
  url,
  downloadFilename = 'qrcode.png',
}: QRCodeModalProps) {
  const [dataUrl, setDataUrl] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isFullScreen, setIsFullScreen] = useState(false)

  useEffect(() => {
    if (!isOpen || !url) return

    QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((data) => {
        setDataUrl(data)
        setError(null)
      })
      .catch((err) => {
        console.error('Failed to generate QR Code:', err)
        setError('Failed to generate QR code.')
      })
  }, [isOpen, url])

  const handleCopyLink = () => {
    if (typeof window !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url)
      showToast('Invite link copied to clipboard!', 'success')
    }
  }

  const handleDownload = () => {
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = downloadFilename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    showToast('QR code image downloaded!', 'success')
  }

  if (!isOpen) return null

  return (
    <>
      <Dialog isOpen={isOpen && !isFullScreen} title={title} onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '1rem' }}>
          {subtitle && <p className="tune-meta" style={{ margin: 0, fontSize: '0.9rem' }}>{subtitle}</p>}

          <div
            style={{
              padding: '1rem',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {error ? (
              <p className="error">{error}</p>
            ) : dataUrl ? (
              <img
                src={dataUrl}
                alt="QR Code"
                style={{ width: '220px', height: '220px', display: 'block', borderRadius: '4px' }}
              />
            ) : (
              <div style={{ width: '220px', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="tune-meta">Generating QR Code…</span>
              </div>
            )}
          </div>

          <div style={{ width: '100%', wordBreak: 'break-all', fontSize: '0.8rem', opacity: 0.85, padding: '0.4rem 0.6rem', background: 'var(--surface-2)', borderRadius: '6px', fontFamily: 'monospace' }}>
            {url}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', width: '100%', marginTop: '0.5rem' }}>
            <button type="button" className="primary" onClick={handleCopyLink}>
              📋 Copy Link
            </button>
            <button type="button" className="secondary" onClick={handleDownload} disabled={!dataUrl}>
              ⬇️ Download PNG
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setIsFullScreen(true)}
              disabled={!dataUrl}
              title="Expand for easy phone screen scanning"
            >
              🔍 Maximize
            </button>
          </div>
        </div>
      </Dialog>

      {/* Fullscreen Display Mode */}
      {isFullScreen && (
        <div
          onClick={() => setIsFullScreen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            cursor: 'pointer',
          }}
        >
          <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '1.25rem', marginBottom: '1.5rem', textAlign: 'center' }}>
            {title}
          </div>
          {dataUrl && (
            <img
              src={dataUrl}
              alt="QR Code Fullscreen"
              style={{ width: '85vw', maxWidth: '360px', height: 'auto', aspectRatio: '1/1' }}
            />
          )}
          <p style={{ color: '#64748b', marginTop: '1.5rem', fontSize: '0.9rem' }}>
            Tap anywhere to return
          </p>
        </div>
      )}
    </>
  )
}
