/**
 * Desktop installers are published as GitHub Release assets by .github/workflows/desktop-release.yml
 * (see docs/DEPLOY.md). The file names below are what electron-builder produces.
 */
const RELEASES = 'https://github.com/alihassan-coder/timedesk/releases/latest'

export const DESKTOP_VERSION = '0.1.0'

export const downloads = [
  { id: 'win', label: 'Windows', file: `timedesk-Setup-${DESKTOP_VERSION}.exe`, note: 'Windows 10 and 11, 64-bit', href: RELEASES },
  { id: 'deb', label: 'Linux (.deb)', file: `timedesk_${DESKTOP_VERSION}_amd64.deb`, note: 'Ubuntu, Debian and Mint', href: RELEASES },
  { id: 'appimage', label: 'Linux (AppImage)', file: `timedesk-${DESKTOP_VERSION}.AppImage`, note: 'Any distro, updates itself', href: RELEASES },
] as const
