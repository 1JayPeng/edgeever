# Windows x64 Preview

## Distribution status

EdgeEver distributes a Windows x64 Preview from the managed fork
[GitHub Releases](https://github.com/1JayPeng/edgeever/releases/latest) page.
The current installer and packaged executables are not Authenticode-signed.
Windows SmartScreen, antivirus software, or organization policy may therefore
warn about or block the installer. This warning is expected for the Preview,
but it is not proof that an arbitrary copy is safe.

- Download only from the official `1JayPeng/edgeever` Release.
- Do not disable SmartScreen, antivirus software, or organization security
  controls for EdgeEver.
- If policy blocks the installer, use the Web/PWA client until an
  Authenticode-signed build is available.

## Automatic updates

An unsigned installer does not prevent the NSIS updater from downloading and
installing a later Release. EdgeEver adds an independent trust gate so that the
update channel does not rely only on an unsigned `latest.yml` file:

1. The client reads `latest.yml` to discover an update but does not begin the
   Windows download yet.
2. It fetches `latest-windows.json` and `latest-windows.json.sig` from that
   exact version's official Release.
3. It verifies the Ed25519 signature with a public key pinned in the packaged
   client, then requires the version, filename, size, and SHA-512 digest to
   match `latest.yml`.
4. It downloads the installer automatically and validates its size, SHA-512,
   and SHA-256 against the signed manifest.
5. Only a verified installer becomes eligible for restart installation or
   automatic installation when the user quits EdgeEver.

Missing metadata, an unknown key, an invalid signature, a version mismatch, or
a changed installer fails closed. The app never enables install-on-quit for a
Windows package that has not passed the final local-file check.

This protects the update decision and installer bytes. It does not remove the
initial Windows reputation warning, provide publisher identity in Explorer,
or bypass organization application-control policy; those require trusted
Authenticode signing.

## Release assets and offline signing

Every formal Release carries this Windows set:

- `EdgeEver-<version>-windows-x64.exe`
- `edgeever-self-hosted-<version>-windows-x64.zip`
- `latest.yml`
- `latest-windows.json`
- `latest-windows.json.sig`
- `SHA256SUMS-windows.txt`

The self-hosted ZIP contains only the compiled runtime, renderer assets,
migrations, and `release.json`; it never contains SQLite/WAL data, resources,
or credential files. Its name, size, SHA-256, version, and revision are bound
by `latest-windows.json` before the manifest is signed.

The fork's GitHub Action builds and verifies the five unsigned inputs
(installer, self-hosted ZIP, `latest.yml`, manifest, and checksum) as an
Actions artifact. It deliberately does not create a Release, upload assets, or
access the signing key. An operator downloads that exact artifact, verifies the
tag/revision and ZIP layout, creates a Draft Release, signs the exact manifest
locally, uploads all six assets, downloads the Draft assets, and reruns the
full signature, installer, ZIP hash, and embedded `release.json` audit before
publishing.

## Self-hosted Windows bundle

Extract the ZIP into a replaceable application directory, never into the data
directory. The compiled executable discovers its extracted assets automatically;
do not set `EDGE_EVER_APP_DIR`. It requires an absolute `EDGE_EVER_DATA_DIR`
outside that application directory and enforces loopback-only binding.

```powershell
$app = 'C:\EdgeEver\app\1.90.1'
$env:EDGE_EVER_DATA_DIR = "$env:LOCALAPPDATA\edgeever-local"
$env:EDGE_EVER_HOST = '127.0.0.1'
$env:EDGE_EVER_PORT = '18789'
# First launch only: set exactly one authentication source. Prefer an owner-only file.
$env:EDGE_EVER_AUTH_PASSWORD_FILE = '<absolute owner-only password file>'
& "$app\edgeever-self-hosted.exe"
Invoke-RestMethod 'http://127.0.0.1:18789/api/health'
```

Do not put the password file, SQLite database, `-wal`, `-shm`, resources, or
`edgeever-secrets.json` under `$app` or in the ZIP. For an upgrade, stop the
service gracefully, make a cold backup of the external data directory, then
replace only `$app`. Keep the data directory unchanged. If a migration has run,
roll back only by restoring both a matching older application directory and the
cold data backup; do not launch an older binary against migrated data.

The private key must be an Ed25519 PKCS#8 PEM file, must remain outside the
repository, and must be backed up in a separate secure location. Configure the
release shell with an absolute path:

```bash
export EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY=/absolute/path/to/windows-update-ed25519-private.pem
```

The fork trust anchor uses key ID `edgeever-fork-windows-update-2026-09`; its
SPKI DER SHA-256 fingerprint is
`d7a861ef54f4000fe7f0d29e805d4f4f732b4808301c6dbaa4a6de86242d156c`.

This fork does not possess the upstream signing private key. Existing upstream
installations therefore cannot transition through automatic update: download
and install the first fork Release manually from `1JayPeng/edgeever`. Later
fork releases use the pinned fork key and update normally. Never reuse an
upstream key ID for a different public key.

If the local signing key is missing or does not match the public key pinned in
the desktop client, the Release remains a Draft. Any future fork-key rotation
requires a two-release bridge signed by the currently trusted fork key.

## Future Authenticode migration

When a trusted certificate becomes available:

1. Sign every shipped PE executable, including `EdgeEver.exe`, the Rust
   sidecar, helper executables, and the final NSIS installer.
2. Configure the exact certificate subject as electron-builder's
   `publisherName` so signed clients enforce publisher continuity.
3. Generate `latest.yml`, the signed EdgeEver manifest, and checksums only
   after all Authenticode signing has finished, because signing changes bytes.
4. Keep the independent Ed25519 gate during and after migration. Existing
   unsigned Preview clients can accept the first signed installer because they
   do not claim an Authenticode publisher; newly signed clients then add the
   publisher check for subsequent updates.

The first public Windows platform Release is a user-visible platform addition
and must use a SemVer minor bump, not a patch bump.
