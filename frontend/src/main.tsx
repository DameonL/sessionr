import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initTheme } from './services/theme'

// Before the first render, so the opening paint is already in the right palette.
initTheme()

const rootElement = document.getElementById('app')
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
