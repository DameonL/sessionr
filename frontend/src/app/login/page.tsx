"use client";

import { isMsalEnabled } from '../../services/authConfig'
import { DevLoginForm } from '../../components/DevLoginForm'
import { MsalLoginPanel } from '../../components/MsalLoginPanel'

export default function LoginPage() {
  return (
    <div className="login-landing-container">
      <div className="card login-card">
        <h1 className="login-title">Session Practice</h1>
        {isMsalEnabled ? <MsalLoginPanel /> : <DevLoginForm />}
      </div>
    </div>
  )
}
