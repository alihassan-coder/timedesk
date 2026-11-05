import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initDesktopAuth } from './lib/auth-client'

// In the desktop app the saved login token is loaded first, so the first screen already knows who is signed in.
void initDesktopAuth().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
