import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const path = new URL('../electron-builder.config.cjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const SIGNING_VARS = ['AZURE_SIGN_ENDPOINT', 'AZURE_SIGN_ACCOUNT', 'AZURE_SIGN_PROFILE', 'AZURE_SIGN_PUBLISHER', 'WIN_CSC_LINK', 'CSC_LINK', 'TIMEDESK_PUBLISHER', 'REQUIRE_SIGNING']

/** Loads the config fresh with exactly these environment variables set. */
function load(vars: Record<string, string> = {}) {
  for (const k of SIGNING_VARS) delete process.env[k]
  Object.assign(process.env, vars)
  delete require.cache[require.resolve(path)]
  return require(path)
}

afterEach(() => {
  for (const k of SIGNING_VARS) delete process.env[k]
})

describe('Windows code signing switches', () => {
  it('builds unsigned, without errors, when nothing is configured', () => {
    const win = load().win
    expect(win.azureSignOptions).toBeUndefined()
    expect(win.signtoolOptions).toBeUndefined()
    expect(win.forceCodeSigning).toBe(false)
  })

  it('turns on Azure Artifact Signing only when all four settings are present', () => {
    const all = { AZURE_SIGN_ENDPOINT: 'https://eus.codesigning.azure.net', AZURE_SIGN_ACCOUNT: 'acct', AZURE_SIGN_PROFILE: 'profile', AZURE_SIGN_PUBLISHER: 'CN=Ali Hassan' }
    expect(load(all).win.azureSignOptions).toEqual({
      endpoint: 'https://eus.codesigning.azure.net',
      codeSigningAccountName: 'acct',
      certificateProfileName: 'profile',
      publisherName: 'CN=Ali Hassan',
    })
    const { AZURE_SIGN_PROFILE: _omit, ...missingOne } = all
    expect(load(missingOne).win.azureSignOptions).toBeUndefined()
  })

  it('records the publisher name for a .pfx certificate so updates can be verified', () => {
    expect(load({ WIN_CSC_LINK: 'cert.pfx', TIMEDESK_PUBLISHER: 'Ali Hassan' }).win.signtoolOptions).toEqual({ publisherName: ['Ali Hassan'] })
    expect(load({ WIN_CSC_LINK: 'cert.pfx' }).win.signtoolOptions).toBeUndefined()
  })

  it('REQUIRE_SIGNING makes an unsigned release fail instead of shipping silently', () => {
    expect(load({ REQUIRE_SIGNING: 'true' }).win.forceCodeSigning).toBe(true)
    expect(load({ REQUIRE_SIGNING: 'false' }).win.forceCodeSigning).toBe(false)
  })

  it('names the Windows installer without spaces so the updater link survives GitHub renaming it', () => {
    expect(load().nsis.artifactName).toBe('timedesk-Setup-${version}.${ext}')
  })

  it('gives the Linux program and packages valid names even though the npm package is called @timedesk/desktop', () => {
    const cfg = load()
    expect(cfg.linux.executableName).toBe('timedesk')
    expect(cfg.deb.packageName).toBe('timedesk')
    expect(cfg.deb.artifactName).toBe('timedesk_${version}_${arch}.${ext}')
    expect(cfg.appImage.artifactName).toBe('timedesk-${version}.${ext}')
    // none of the names electron-builder will use may contain characters Linux rejects
    for (const n of [cfg.linux.executableName, cfg.deb.packageName]) expect(n).toMatch(/^[a-z0-9][a-z0-9.+-]*$/)
  })

  it('always unpacks the native app-tracking helper and publishes to the GitHub release', () => {
    const cfg = load()
    expect(cfg.asarUnpack).toContain('node_modules/active-win/**')
    expect(cfg.publish).toMatchObject({ provider: 'github', repo: 'timedesk' })
  })
})
