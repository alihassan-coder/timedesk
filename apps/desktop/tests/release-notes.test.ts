import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript helper shared with the GitHub workflow
import { changelogSection, checkRelease, installInstructions, releaseNotes } from '../../../scripts/release-notes.mjs'

const changelog = ['# Changelog', '', '## 0.2.0', '', '- newer thing', '', '## 0.1.0', '', 'First version.', '', '### Web', '- a feature', ''].join('\n')

describe('release notes from the changelog', () => {
  it('takes exactly the section for that version, including its sub-headings', () => {
    expect(changelogSection(changelog, '0.1.0')).toBe('First version.\n\n### Web\n- a feature')
    expect(changelogSection(changelog, '0.2.0')).toBe('- newer thing')
  })

  it('returns nothing for a version that has no section or an empty one', () => {
    expect(changelogSection(changelog, '9.9.9')).toBeNull()
    expect(changelogSection('## 1.0.0\n\n## 0.9.0\n- x', '1.0.0')).toBeNull()
  })

  it('adds install instructions that use the real file names', () => {
    const notes = releaseNotes(changelog, '0.1.0')
    expect(notes).toContain('First version.')
    expect(notes).toContain('timedesk-Setup-0.1.0.exe')
    expect(notes).toContain('timedesk_0.1.0_amd64.deb')
    expect(notes).toContain('timedesk-0.1.0.AppImage')
    expect(installInstructions('1.2.3')).toContain('SHA256SUMS.txt')
  })

  it('refuses to make notes for a version with no changelog entry', () => {
    expect(() => releaseNotes(changelog, '3.0.0')).toThrow(/no "## 3\.0\.0" section/)
  })
})

describe('refusing a release that is not ready', () => {
  it('passes when the tag, the app version and the changelog agree', () => {
    expect(() => checkRelease('0.1.0', '0.1.0', changelog)).not.toThrow()
  })

  it('fails when the tag and the app version differ', () => {
    expect(() => checkRelease('0.2.0', '0.1.0', changelog)).toThrow(/says 0\.1\.0/)
  })

  it('fails when the changelog has nothing for the version', () => {
    expect(() => checkRelease('0.3.0', '0.3.0', changelog)).toThrow(/no "## 0\.3\.0" section/)
  })

  it('fails on a tag that is not a version', () => {
    expect(() => checkRelease('banana', 'banana', changelog)).toThrow(/not a version/)
  })
})
