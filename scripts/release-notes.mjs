// Release helpers used by .github/workflows/desktop-release.yml.
//   node scripts/release-notes.mjs check 0.1.0     fails unless apps/desktop version is 0.1.0 and CHANGELOG has a "## 0.1.0" section
//   node scripts/release-notes.mjs notes 0.1.0     prints the release notes (changelog section + install instructions)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The text under "## <version>" in the changelog, up to the next "## " heading. Null if there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === `## ${version}`)
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  const body = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim()
  return body || null
}

export function installInstructions(version) {
  return [
    '## Install',
    '',
    `- **Windows:** download \`timedesk-Setup-${version}.exe\` and run it. Until the installer is code-signed, Windows may say "Unknown publisher": choose **More info**, then **Run anyway**.`,
    `- **Linux (Ubuntu, Debian, Mint):** \`sudo apt install ./timedesk_${version}_amd64.deb\``,
    `- **Linux (any distro):** \`chmod +x timedesk-${version}.AppImage && ./timedesk-${version}.AppImage\``,
    '',
    'Installed copies check this page for newer versions and update themselves (Windows and AppImage). A `.deb` is updated by installing the newer `.deb`.',
    '',
    'Verify a download with `SHA256SUMS.txt`.',
  ].join('\n')
}

export function releaseNotes(changelog, version) {
  const section = changelogSection(changelog, version)
  if (!section) throw new Error(`CHANGELOG.md has no "## ${version}" section with content`)
  return `${section}\n\n${installInstructions(version)}\n`
}

/** Throws a clear message unless the tag/version matches the desktop package and the changelog has notes for it. */
export function checkRelease(version, desktopVersion, changelog) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" is not a version like 1.2.3`)
  if (desktopVersion !== version) throw new Error(`The tag says ${version} but apps/desktop/package.json says ${desktopVersion}. Update the version, commit, and tag again.`)
  if (!changelogSection(changelog, version)) throw new Error(`CHANGELOG.md has no "## ${version}" section. Describe the release there first.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, rawVersion] = process.argv.slice(2)
  const version = (rawVersion ?? '').replace(/^v/, '')
  const root = new URL('../', import.meta.url)
  const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8')
  try {
    if (command === 'check') {
      const desktopVersion = JSON.parse(readFileSync(new URL('apps/desktop/package.json', root), 'utf8')).version
      checkRelease(version, desktopVersion, changelog)
      console.log(`Release ${version} is consistent.`)
    } else if (command === 'notes') {
      process.stdout.write(releaseNotes(changelog, version))
    } else {
      throw new Error('Usage: release-notes.mjs check|notes <version>')
    }
  } catch (e) {
    console.error(`::error::${e.message}`)
    process.exit(1)
  }
}
