/**
 * Start with the computer. Windows is handled by Electron (login items). Linux has no Electron API for it,
 * so we write a standard autostart entry that desktop environments (GNOME, KDE, XFCE, Cinnamon) honour.
 */
export function linuxAutostartEntry(execPath: string): string {
  const quoted = /\s/.test(execPath) ? `"${execPath}"` : execPath
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=timedesk',
    'Comment=Time tracking and todos',
    `Exec=${quoted} --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

export const linuxAutostartPath = (home: string) => `${home}/.config/autostart/timedesk.desktop`
