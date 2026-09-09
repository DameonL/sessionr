"use client";

import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@/utils/routerCompat'
import jsQR from 'jsqr'
import { Dialog } from './Dialog'
import { showToast } from '../state/appState'

interface QRScannerModalProps {
  isOpen: boolean
  onClose: () => void
}

export function QRScannerModal({ isOpen, onClose }: QRScannerModalProps) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameId = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [mode, setMode] = useState<'camera' | 'file'>('camera')

  const stopCamera = () => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current)
      animationFrameId.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  const handleScanSuccess = (code: string) => {
    stopCamera()
    setScanResult(code)
    showToast('QR Code scanned successfully!', 'success')

    try {
      const currentOrigin = window.location.origin
      if (code.startsWith(currentOrigin)) {
        const path = code.substring(currentOrigin.length)
        onClose()
        router.push(path)
        return
      }
      if (code.startsWith('/')) {
        onClose()
        router.push(code)
        return
      }
      if (code.startsWith('http://') || code.startsWith('https://')) {
        window.location.href = code
        return
      }
    } catch (e) {
      console.error('Error handling scanned QR code link:', e)
    }
  }

  const tick = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animationFrameId.current = requestAnimationFrame(tick)
      return
    }

    const ctx = canvas.getContext('2d')
    if (ctx) {
      canvas.height = video.videoHeight
      canvas.width = video.videoWidth
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      })

      if (qrCode && qrCode.data) {
        handleScanSuccess(qrCode.data)
        return
      }
    }

    animationFrameId.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (!isOpen || mode !== 'camera') {
      stopCamera()
      return
    }

    setScanResult(null)

    if (typeof window !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            videoRef.current.setAttribute('playsinline', 'true')
            videoRef.current.play()
            animationFrameId.current = requestAnimationFrame(tick)
          }
          setHasCameraPermission(true)
        })
        .catch((err) => {
          console.warn('Webcam permission denied or camera unaccessible:', err)
          setHasCameraPermission(false)
          setMode('file')
        })
    } else {
      setHasCameraPermission(false)
      setMode('file')
    }

    return () => {
      stopCamera()
    }
  }, [isOpen, mode])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0)
          const imageData = ctx.getImageData(0, 0, img.width, img.height)
          const qrCode = jsQR(imageData.data, imageData.width, imageData.height)
          if (qrCode && qrCode.data) {
            handleScanSuccess(qrCode.data)
          } else {
            showToast('No QR code found in uploaded image.', 'error')
          }
        }
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  if (!isOpen) return null

  return (
    <Dialog
      isOpen={isOpen}
      title="📷 Scan QR Code"
      onClose={() => {
        stopCamera()
        onClose()
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem', width: '100%', justifyContent: 'center' }}>
          <button
            type="button"
            className={mode === 'camera' ? 'primary' : 'secondary'}
            onClick={() => setMode('camera')}
          >
            📹 Camera
          </button>
          <button
            type="button"
            className={mode === 'file' ? 'primary' : 'secondary'}
            onClick={() => setMode('file')}
          >
            🖼️ Upload Photo
          </button>
        </div>

        {mode === 'camera' && (
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '320px',
              // Capped against the viewport as well as a fixed size: in landscape
              // the dialog only has ~300px of height to give away.
              height: 'min(240px, 40dvh)',
              // The camera surround stays black in both themes — it frames video.
              background: '#000',
              borderRadius: '12px',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {hasCameraPermission === false ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)' }}>
                <p>Camera access unavailable or declined.</p>
                <p style={{ fontSize: '0.85rem' }}>Switching to photo upload mode.</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div
                  style={{
                    position: 'absolute',
                    inset: '20px',
                    border: '2px dashed var(--accent)',
                    borderRadius: '12px',
                    pointerEvents: 'none',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
                  }}
                />
              </>
            )}
          </div>
        )}

        {mode === 'file' && (
          <div
            style={{
              width: '100%',
              padding: '2rem 1rem',
              border: '2px dashed var(--border)',
              borderRadius: '12px',
              textAlign: 'center',
              background: 'var(--surface-2)',
            }}
          >
            <p style={{ margin: '0 0 1rem 0' }}>Select an image file containing a SessionApp QR code:</p>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              style={{ display: 'block', margin: '0 auto' }}
            />
          </div>
        )}

        {scanResult && (
          <div style={{ width: '100%', background: 'var(--surface-2)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
            <strong>Scanned Output:</strong>
            <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
              {scanResult}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
