/**
 * Linux desktop files. Start with the computer: Windows is handled by Electron (login items); Linux has no Electron API
 * for it, so we write a standard autostart entry that desktop environments (GNOME, KDE, XFCE, Cinnamon) honour.
 */

/** The window name Electron uses on Linux (from desktopName in package.json). Docks match it to StartupWMClass. */
export const LINUX_WM_CLASS = 'timedesk'

const quote = (path: string) => (/\s/.test(path) ? `"${path}"` : path)

export function linuxAutostartEntry(execPath: string, iconPath = 'timedesk'): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=timedesk',
    'Comment=Time tracking and todos',
    `Exec=${quote(execPath)} --hidden`,
    `Icon=${iconPath}`,
    `StartupWMClass=${LINUX_WM_CLASS}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

export const linuxAutostartPath = (home: string) => `${home}/.config/autostart/timedesk.desktop`

/**
 * The menu entry for the AppImage. An AppImage installs nothing, so without this the dock has no .desktop file to match
 * the window to and shows a generic gear icon instead of the timedesk logo. The .deb installs its own entry.
 */
export function linuxDesktopEntry(appImagePath: string, iconPath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=timedesk',
    'Comment=Time tracking and todos',
    `Exec=${quote(appImagePath)} %U`,
    `Icon=${iconPath}`,
    `StartupWMClass=${LINUX_WM_CLASS}`,
    'Categories=Office;ProjectManagement;',
    'Terminal=false',
    '',
  ].join('\n')
}

export const linuxDesktopEntryPath = (home: string) => `${home}/.local/share/applications/timedesk.desktop`
export const linuxIconPath = (home: string) => `${home}/.local/share/icons/hicolor/512x512/apps/timedesk.png`
