/** Desktop installers are published as GitHub Release assets (phase 3). Links are placeholders until then. */
const RELEASES = 'https://github.com/alihassan-coder/timedesk/releases/latest'

export const DESKTOP_VERSION = '0.1.0'

export const downloads = [
  { id: 'win', label: 'Windows', file: 'timedesk-setup.exe', note: 'Windows 10 and 11, 64-bit', href: RELEASES },
  { id: 'deb', label: 'Linux (.deb)', file: 'timedesk_amd64.deb', note: 'Ubuntu, Debian and Mint', href: RELEASES },
  { id: 'appimage', label: 'Linux (AppImage)', file: 'timedesk.AppImage', note: 'Any distro, updates itself', href: RELEASES },
] as const
