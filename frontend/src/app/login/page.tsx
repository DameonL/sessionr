"use client";

import { useEffect, useState } from 'react'
import { MsalLoginPanel } from '../../components/MsalLoginPanel'

export default function LoginPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="login-landing-container">
      <div className="card login-card">
        <h1 className="login-title">Session Practice</h1>
        {!mounted ? (
          <div style={{ minHeight: '150px' }} />
        ) : (
          <MsalLoginPanel />
        )}
      </div>
    </div>
  )
}
