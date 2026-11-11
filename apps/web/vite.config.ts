import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The download links and the sidebar show the desktop app's own version, so a release never leaves them behind.
const desktopVersion = (() => {
  try {
    return (JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../desktop/package.json'), 'utf8')) as { version: string }).version
  } catch {
    // Only if the build cannot see the rest of the repo. The links still go to the latest release page.
    console.warn('vite.config: apps/desktop/package.json not found; the desktop version shown on the site may be out of date')
    return '0.4.0'
  }
})()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __DESKTOP_VERSION__: JSON.stringify(desktopVersion) },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
