# Android release signing

GitHub Release APKs use the Android package `com.hanssen0.khiemobile` and are
signed by a dedicated PKCS#12 release key. The key is an update identity: keep
it for the lifetime of this package name. Losing it prevents direct APK updates;
leaking it lets an attacker create an APK that Android accepts as an update.

## Generate the key offline

Generate the key on an offline or otherwise trusted machine. Do not place the
keystore in this repository, a shell history, or a shared cloud folder.

```sh
umask 077
mkdir -p "$HOME/khie-signing"
keytool -genkeypair -v \
  -keystore "$HOME/khie-signing/khie-mobile-release.p12" \
  -storetype PKCS12 \
  -alias khie-mobile-release \
  -keyalg RSA -keysize 4096 -sigalg SHA256withRSA \
  -validity 10950
```

Use a randomly generated, unique password when `keytool` prompts. PKCS#12 uses
the keystore password for the key as well. The alias is fixed as
`khie-mobile-release`. Confirm the key and record its public SHA-256 certificate
fingerprint:

```sh
keytool -list -v -storetype PKCS12 \
  -keystore "$HOME/khie-signing/khie-mobile-release.p12" \
  -alias khie-mobile-release
```

Make two offline encrypted backups of the `.p12` file, stored separately from
the password. Retain the fingerprint and alias in the project records; neither
is secret.

## GitHub Actions encryption and secrets

The PKCS#12 file encrypts the private key using its password. For CI, its binary
contents are base64-encoded and stored as a GitHub **environment secret**;
base64 is transport encoding, not another layer of encryption. GitHub encrypts
the secret at rest and only exposes it after environment approval. The workflow
decodes it into the ephemeral runner temp directory, uses it for Gradle signing,
verifies the produced APK certificate, then removes the temporary file.

Create an environment named `production-android-release` and add these secrets:

| Secret | Value |
| --- | --- |
| `KHIE_ANDROID_RELEASE_KEYSTORE_BASE64` | One-line base64 form of `khie-mobile-release.p12` |
| `KHIE_ANDROID_RELEASE_PASSWORD` | PKCS#12 password |

On GNU/Linux, set the binary secret without writing its base64 form to disk:

```sh
base64 -w 0 < "$HOME/khie-signing/khie-mobile-release.p12" \
  | gh secret set --env production-android-release KHIE_ANDROID_RELEASE_KEYSTORE_BASE64
```

Use `gh secret set --env production-android-release KHIE_ANDROID_RELEASE_PASSWORD`
to enter the password interactively. Never use repository-wide secrets for this
signing material.

## Approval policy

Configure `production-android-release` in GitHub Settings → Environments:

1. Restrict deployments to the `master` branch.
2. Require approval before deployment. With a second trusted maintainer, require
   that person; while this is a one-person project, require the repository owner
   and leave self-review enabled so each release remains an explicit decision.
3. Keep signing secrets only on this environment, not as repository secrets.
4. Protect `master`: require pull requests and passing CI, and limit who can
   change workflow files.

Each push to `master` first runs the secret-free verification job. Only after it
passes does the protected release job wait for approval, before the signing key
is restored. Approve only after checking the commit, diff, release version, and
workflow changes. If protected-environment approvals are unavailable on the
repository plan, do not place signing secrets in the repository; instead use a
manually dispatched release workflow or sign the APK on the trusted machine.

## Verification

The workflow fails if release credentials are unavailable or if the universal
APK does not carry the expected certificate. Each GitHub Release includes both
APK checksums and `<version>.certificate.sha256`, and its description publishes
the signing certificate fingerprint.

The former development APK uses a different debug certificate. It cannot update
to this release identity. Before uninstalling it, users must back up their
mnemonic; uninstalling clears the app's local wallet data.
