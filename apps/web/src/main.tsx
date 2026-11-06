import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initDesktopAuth } from './lib/auth-client'

// Pages are loaded on demand. After a new version is deployed, an open tab may ask for a page file that no longer
// exists; reload once to pick up the new version instead of showing an error.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('td-reloaded-for-update')) return
    sessionStorage.setItem('td-reloaded-for-update', '1')
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => {
  // A successful start clears the guard, so the next deploy can reload again.
  setTimeout(() => {
    try {
      sessionStorage.removeItem('td-reloaded-for-update')
    } catch {
      // storage blocked: nothing to clear
    }
  }, 10_000)
})

// In the desktop app the saved login token is loaded first, so the first screen already knows who is signed in.
void initDesktopAuth().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
