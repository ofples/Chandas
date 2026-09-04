# Chandas release and update guide

This project has three isolated EAS channels and build profiles:

| Environment | Artifact | Purpose | Update channel |
| --- | --- | --- | --- |
| `development` | APK with Expo development client | Local development and native debugging | `development` |
| `preview` | Installable release APK | Device QA before production | `preview` |
| `production` | Android App Bundle (AAB) | Google Play | `production` |

EAS owns the Android `versionCode` remotely and increments it for every build. The user-facing version is kept in both `app.json` and `package.json`; these values must match. Version 2 starts at `2.0.0`.

## Compatibility model

Chandas uses the Expo fingerprint runtime policy. The runtime includes native dependencies, app configuration, permissions, and the local timer service. An over-the-air update is therefore eligible only for a binary with the same native contract. This is especially important here: a JavaScript release must never assume a different alarm, focus-mode, or scheduling API than the installed Android service provides.

Use a new store build when any native dependency, Expo SDK package, config plugin, Android permission, app configuration field, or native timer-service code changes. JavaScript, TypeScript, styling, and bundled asset changes can normally ship as an EAS Update. The fingerprint is the final safety check rather than human memory.

## Before every release

1. Start from the exact commit intended for release and ensure unrelated working-tree changes are not included.
2. For a new store version, set the same semantic version in `app.json` and `package.json`, then refresh `package-lock.json` with `npm install`.
3. Run `npm run release:check`. This verifies Expo package compatibility, TypeScript, and the test suite without performing a local native build.
4. Review Android permissions and the local native module whenever either changed.
5. Use the `preview` channel first for any OTA change. Do not use development-client behavior as proof that production update loading works; the full Updates API is a release-build feature.

## New store version

Create the Android store artifact with:

```sh
npm run build:android:prod
```

This creates an AAB on EAS and increments the remote Android build number. It does not upload or release the bundle automatically. That separation is deliberate: creating an artifact is reversible; publishing a store release affects users and should remain an explicit decision.

After reviewing the EAS build logs and installing the matching preview build for device QA, submit to Google Play's internal testing track with:

```sh
npm run submit:android:prod
```

The submission profile completes the internal-track release so enrolled testers can receive it after Google Play finishes processing. It does not promote the app to production.

For unattended future releases, pushing a semantic version tag such as `v2.0.1` triggers `.eas/workflows/deploy-production.yml` once the Expo project is connected to this GitHub repository. The workflow runs checks and computes the native fingerprint. It creates a new AAB when no compatible production binary exists; otherwise it publishes an Android OTA update to the existing compatible binary. Store submission intentionally remains a separate approval.

## OTA update: preview, verify, promote

Publish to testers:

```sh
npm run publish:preview -- --message "Describe the user-visible change"
```

The preview workflow in `.eas/workflows/publish-preview-update.yml` is the cloud equivalent and gates publication on type-checking and tests.

Verify the update on a preview APK made from the same native fingerprint. Exercise timer start/stop, a background bell, alarm dismissal, focus automation, permissions, session restore, and update restart. A development client is useful for inspecting the bundle but is not a production update-loader test.

Promote the exact tested update group instead of rebuilding it:

```sh
npm run promote:preview:production -- --message "Promote verified update"
```

Direct production publishing remains available for an urgent, already-verified change:

```sh
npm run publish:production -- --message "Describe the hotfix"
```

For a cautious rollout, use EAS Update's rollout percentage on the production command and increase it from the dashboard after monitoring successful launches.

## What users experience

Production builds check for a compatible update on cold launch without delaying the timer UI. A downloaded update is held safely and Chandas offers a gentle restart action while idle. It never reloads during a running timer. If the user does nothing, Expo applies the update on a later cold start. The embedded bundle remains available as the recovery fallback if a downloaded update cannot launch.

Transient network/update-check failures do not block the app or alarm service. An emergency fallback is communicated once in calm language and the app continues using its embedded version.

## Rollback and monitoring

Monitor launch adoption and failed installs on the EAS deployment page before increasing a rollout. If a production update is unhealthy, use:

```sh
npm run rollback:production
```

Rollback affects OTA content only. A faulty native binary requires a new version and Play Store release. Never try to fix an incompatible native contract with JavaScript alone.

The rollback command is intentionally interactive because EAS needs the exact production update group and runtime being reverted. Confirm the `production` branch/runtime in its prompt; this avoids accidentally rolling back a different compatible line.

## Security and environment notes

- Keep production, preview, and development environment variables in the matching EAS environment. Fingerprint, build, and update jobs use the same environment name so their native/runtime calculations agree.
- `.easignore` excludes generated native folders, local mockups, documentation, build artifacts, and secrets from uploads. EAS regenerates Android from `app.json` and the checked-in config plugin.
- EAS Update code signing can be added later if the threat model requires an application-owned signing key. Its private key must live outside the repository and be available to every update-publishing workflow; enabling or rotating it requires a new native runtime and store build.
- Do not publish OTA updates from an uncommitted or ambiguous working tree. Release metadata and rollback diagnosis are only dependable when every update maps to an exact commit.
