// Packaging config for the desktop app. It is a script (not YAML) so Windows code signing can switch on
// by itself when the signing settings exist, and stay off, without errors, when they do not.
// See docs/SIGNING.md for how to get a certificate and which settings to add.

const env = process.env

/** Azure Artifact Signing (formerly Trusted Signing): needs the four names below plus AZURE_TENANT_ID,
 *  AZURE_CLIENT_ID and AZURE_CLIENT_SECRET in the environment. */
const azure =
  env.AZURE_SIGN_ENDPOINT && env.AZURE_SIGN_ACCOUNT && env.AZURE_SIGN_PROFILE && env.AZURE_SIGN_PUBLISHER
    ? {
        endpoint: env.AZURE_SIGN_ENDPOINT,
        codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
        certificateProfileName: env.AZURE_SIGN_PROFILE,
        publisherName: env.AZURE_SIGN_PUBLISHER,
      }
    : undefined

/** A .pfx certificate: electron-builder reads WIN_CSC_LINK (file path, https link or base64) and WIN_CSC_KEY_PASSWORD itself.
 *  TIMEDESK_PUBLISHER is the "issued to" name on the certificate; it lets the updater check that updates come from you. */
const pfx = env.WIN_CSC_LINK || env.CSC_LINK

/** Set REQUIRE_SIGNING=true on the release build to fail instead of publishing an unsigned installer. */
const requireSigning = env.REQUIRE_SIGNING === 'true'

module.exports = {
  appId: 'com.timedesk.app',
  productName: 'timedesk',
  copyright: 'Copyright (c) timedesk',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**', 'package.json'],
  asarUnpack: ['node_modules/active-win/**'],

  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    forceCodeSigning: requireSigning,
    ...(azure ? { azureSignOptions: azure } : {}),
    ...(!azure && pfx && env.TIMEDESK_PUBLISHER ? { signtoolOptions: { publisherName: [env.TIMEDESK_PUBLISHER] } } : {}),
  },
  nsis: {
    // No spaces: GitHub renames spaces in release file names, which would break the auto-updater's download link.
    artifactName: 'timedesk-Setup-${version}.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },

  linux: {
    // The package is called @timedesk/desktop, which is not a valid program or package name on Linux, so name them explicitly.
    executableName: 'timedesk',
    icon: 'build/icon.png',
    category: 'Office',
    maintainer: 'timedesk <alihassan-coder@users.noreply.github.com>',
    synopsis: 'Time tracking and todos',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
  },

  // File names are fixed here (not derived from the package name) so they match what the updater metadata points to.
  appImage: { artifactName: 'timedesk-${version}.${ext}' },
  deb: { packageName: 'timedesk', artifactName: 'timedesk_${version}_${arch}.${ext}' },

  publish: { provider: 'github', owner: 'alihassan-coder', repo: 'timedesk' },
}
