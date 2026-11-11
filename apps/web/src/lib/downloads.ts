/**
 * Desktop installers are published as GitHub Release assets by .github/workflows/desktop-release.yml
 * (see docs/DEPLOY.md). The file names below are what electron-builder produces.
 */
const RELEASES = 'https://github.com/alihassan-coder/timedesk/releases/latest'

declare const __DESKTOP_VERSION__: string
/** Taken from apps/desktop/package.json when the site is built (vite.config.ts), so it always matches the latest release. */
export const DESKTOP_VERSION = __DESKTOP_VERSION__

export const downloads = [
  { id: 'win', label: 'Windows', file: `timedesk-Setup-${DESKTOP_VERSION}.exe`, note: 'Windows 10 and 11, 64-bit', href: RELEASES },
  { id: 'deb', label: 'Linux (.deb)', file: `timedesk_${DESKTOP_VERSION}_amd64.deb`, note: 'Ubuntu, Debian and Mint', href: RELEASES },
  { id: 'appimage', label: 'Linux (AppImage)', file: `timedesk-${DESKTOP_VERSION}.AppImage`, note: 'Any distro, updates itself', href: RELEASES },
] as const
