# Windows code signing

An unsigned installer makes Windows show **"Windows protected your PC / Unknown publisher"** (SmartScreen). A signed one shows your name instead. Signing needs a certificate that a company sells, so it cannot be set up from code alone. The build is already wired to sign by itself the moment the settings below exist.

## What to expect (read this first)

- **You must buy or enroll in a signing service.** There is no free route that removes the warning for other people's computers.
- **Keys must live in secure hardware or a cloud service.** Since June 2023 a new publicly trusted code signing certificate cannot be a plain file you download. You use a cloud signing service, or a hardware token. For GitHub Actions that means a cloud service.
- **A signed app can still warn for a short while.** SmartScreen also looks at how many people have downloaded the file. Sources disagree on whether the more expensive EV certificate skips that wait: [SSL.com says EV and OV have been treated equally since March 2024](https://ssl.com/products/software-integrity/code-signing/), while several resellers still advertise instant trust for EV. Plan on: signed means your name is shown and the scary "Unknown publisher" is gone; a mild reputation warning may remain for the first downloads.
- With 3 to 5 people you can also tell them once: "More info -> Run anyway". Signing removes even that.

## Choose a route

| Route | Cost (approximate) | Good for | Catch |
|---|---|---|---|
| **Azure Artifact Signing** (formerly Trusted Signing) | about $10 a month ([Microsoft pricing](https://azure.microsoft.com/pricing/details/artifact-signing/)) | Cheapest, works from GitHub Actions | Needs an Azure account and identity validation. A March 2026 [Microsoft Q&A answer](https://learn.microsoft.com/en-us/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident) says it was limited to organizations in the US and Canada and individual sign-up was paused. Check the current [quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart) for your country |
| **OV certificate + cloud signing** (for example [SSL.com eSigner](https://ssl.com/products/software-integrity/code-signing/) or DigiCert KeyLocker) | roughly $220 to $500 a year | Anyone, including individuals in most countries | The build needs a small signing script for the chosen service. Tell me which provider you buy and I will add and test it |
| **EV certificate** | roughly $290 to $500 a year | Only if you need driver signing or a customer demands EV | More paperwork, more cost, unclear extra SmartScreen benefit |

If you are not in the US or Canada, or Azure refuses an individual, take the second route.

## Route A: Azure Artifact Signing

1. Create an Azure account, then an **Artifact Signing account** and complete **identity validation** (Azure portal -> Artifact Signing).
2. Create a **certificate profile** (type: Public Trust).
3. Create an app registration (service principal) and give it the role **Artifact Signing Certificate Profile Signer** on the signing account.
4. In the GitHub repo, **Settings -> Secrets and variables -> Actions**:

| Name | Kind | Value |
|---|---|---|
| `AZURE_TENANT_ID` | Secret | Directory (tenant) ID of the app registration |
| `AZURE_CLIENT_ID` | Secret | Application (client) ID |
| `AZURE_CLIENT_SECRET` | Secret | The client secret you created |
| `AZURE_SIGN_ENDPOINT` | Variable | The account endpoint, for example `https://eus.codesigning.azure.net` (must match the account region) |
| `AZURE_SIGN_ACCOUNT` | Variable | Your signing account name |
| `AZURE_SIGN_PROFILE` | Variable | Your certificate profile name |
| `AZURE_SIGN_PUBLISHER` | Variable | The subject exactly as in the certificate, for example `CN=Your Name, O=..., L=..., C=...` |

## Route B: a .pfx certificate

Only works if your certificate provider lets you export a `.pfx` (some older or provider-specific options do). Otherwise use the cloud route above.

| Name | Kind | Value |
|---|---|---|
| `WIN_CSC_LINK` | Secret | The `.pfx` file as base64 (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`) |
| `WIN_CSC_KEY_PASSWORD` | Secret | The `.pfx` password |
| `TIMEDESK_PUBLISHER` | Variable | The "issued to" name on the certificate |

## Turn on the safety net

After signing works once, add the repo **variable** `REQUIRE_SIGNING` = `true`. From then on the release build **fails** if the Windows installer would be unsigned, so you can never publish a warning-prone installer by accident.

## Check that an installer is signed

```powershell
Get-AuthenticodeSignature ".\timedesk Setup 0.1.0.exe" | Format-List Status, SignerCertificate
```

`Status : Valid` and your name under the signer means it is signed. Right-click the file -> Properties -> **Digital Signatures** shows the same.

## Updates and signing

The desktop app updates itself from GitHub Releases. Once builds are signed, the updater also checks that every update carries the same publisher name, so a tampered update is refused. Keep the publisher name stable from release to release.

## Linux

Linux installers are not signed with a certificate and show no warning. They are plain `.deb` and AppImage files from your GitHub Release.
