# Chandas release and update guide

This project has three isolated EAS channels and build profiles:

| Environment | Artifact | Purpose | Update channel |
| --- | --- | --- | --- |
| `development` | APK with Expo development client | Local development and native debugging | `development` |
| `preview` | Installable release APK | Device QA before production | `preview` |
| `production` | Android App Bundle (AAB) | Google Play | `production` |

EAS owns the Android `versionCode` remotely and increments it for EAS builds. Local development builds do not replace that release versioning. The user-facing version is kept in both `app.json` and `package.json`; these values must match. Version 2 starts at `2.0.0`.

## Compatibility model

Chandas derives each platform runtime from Expo's native fingerprint policy. A
binary receives an OTA only when its native code, native dependencies, bundled
assets, permissions, config plugins, and other fingerprinted inputs are
compatible with that update. Never add a platform-specific manual runtime pin
to bridge incompatible native generations.

Use a new store build when any native dependency, Expo SDK package, config
plugin, Android permission, app configuration field, packaged asset, or native
timer-service code changes. JavaScript, TypeScript, and styling changes can
normally ship as an EAS Update when the fingerprint is unchanged. Never publish
code that assumes an unavailable native capability.

`ChandasTimerService.getCapabilities` advertises the installed engine's program schemas, safety ceilings, and additive features. Keep product limits, Focus status presentation, notification wording, and the dynamic sound catalog in the OTA layer when they fit that contract. The native ceilings are intentionally larger than the current UI and must not be treated as product defaults. A missing capability function or flag identifies an older binary; OTA code must preserve its documented fallback instead of assuming the new method exists.

## Local development and verification

Android debug builds use `com.yukti.chandas.dev` and the label **Chandas Dev** through the checked-in development-identity plugin. Release builds retain `com.yukti.chandas` and **Chandas**, allowing both to coexist with independent data. Regenerate Android with `npx expo prebuild --platform android --no-install` after changing this configuration.

For local artifacts, run `gradlew.bat :app:assembleDebug :app:assembleRelease` in the generated `android` directory. Debug requires Metro; release embeds the JavaScript bundle. The generated local release configuration currently uses the debug signing key: these APKs are standalone test builds, not Google Play signed releases. EAS production signing and remote versionCode remain the store delivery path. Known failing acceptance tests must remain disclosed when building an unaccepted version for testing.

A Play upload AAB can also be built locally with Gradle. Export the existing Android upload keystore with `eas credentials`, keep `credentials.json` and `credentials/` out of Git, and configure the generated Android release variant to use that keystore. Set a `versionCode` above the last Play upload. For EAS Update parity, add the intended channel (`production`) to the generated Android manifest and set `EXPO_UPDATES_FINGERPRINT_OVERRIDE` to the exact native fingerprint runtime hash when building; the `expo_runtime_version` string should remain `file:fingerprint` so Expo reads the generated `assets/fingerprint`. Plain `expo prebuild` does not apply the channel from `eas.json`, and a local fingerprint can differ from the EAS build's fingerprint. Build with `gradlew.bat :app:bundleRelease`, then verify the bundle certificate against the EAS upload-key SHA-256 fingerprint, the package/version/code, and the embedded runtime/channel before uploading. The generated `android/` folder is ignored, so these local signing and metadata changes must be repeated after prebuild. Google Play App Signing signs the delivered APKs, but the uploaded AAB still needs the registered upload key. [Expo local release builds](https://docs.expo.dev/guides/local-app-production/) · [EAS Update without EAS Build](https://docs.expo.dev/eas-update/standalone-service/) · [Android app signing](https://developer.android.com/studio/publish/app-signing)

The current Windows development machine can run Android emulators and local native builds. After confirming that the Android SDK, JDK, and an emulator or connected device are available, use `npm run android` (equivalent to `npx expo run:android`) to generate the ignored Android project, compile a development build, install it, and start Metro. For later JavaScript-only edits, `npm start` reconnects the installed development client without recompiling native code. Rebuild after changing native code, native dependencies, permissions, or config plugins.

Local `expo prebuild`, targeted Gradle compile and unit-test tasks, Android Studio builds, `npx expo export`, and emulator or physical-device checks are permitted when useful. A local Android release variant can help catch release-only failures, but an unsigned local build is not a Play Store artifact. Do not treat an emulator as proof of background timing, haptics, audio routing, or notification presentation on a physical phone. The generated `android/` directory is ignored; source changes belong in `app.json`, the config plugin, or the checked-in native module. iOS compilation requires macOS and Xcode.

Remote EAS Build remains an option for distributable artifacts and matching the configured release workflow. Expo does not officially support `eas build --local` on Windows; use Expo CLI and the Android toolchain for local builds, or use EAS Build remotely. [Expo local development](https://docs.expo.dev/guides/local-app-development/) · [EAS local build limitations](https://docs.expo.dev/build-reference/local-builds/)

## Bell Points and guided onboarding (native contract 15)

Bell Points adds optional authored percentage, after-start, and before-end positions
inside each step. Percentages resolve to exact seconds with half-up rounding; fixed
positions outside a shortened step remain stored and reactivate when lengthened.
Coincident positions share one event and retain explicit-marker precedence. Existing
single after/before markers remain readable without rewriting saved configurations.
The Android engine advertises `supportsBellPoints`; older binaries must refuse a
program containing points rather than silently omit its cues. This requires a new
native binary, not a JavaScript-only update.

The first-run Quick tour now highlights actual controls across setup, sub-bells,
running, saving, and configurations. Skip exits without discarding edits or stopping
runs. Settings can replay it. Existing starter timers and first-run dismissal state
remain unchanged.

## Before every release

### Unified timer migration (native contract 14)

The unified editor writes program schema 4 and requires the matching native engine
for new starts. This change includes native scheduler/overlay code and Expo native
package patches, so it requires a new compatible binary. Do not publish it to an
older runtime as an OTA-only change.

Configuration migration writes `chandas-timer-unified-state-v3`, verifies readback,
then writes an advisory migration marker. Original legacy keys remain untouched;
both legacy working copies, preset snapshots, settings and imported sounds are
retained. The retired experimental setup key is never read. Malformed or future
records require recovery and must not be overwritten with defaults.

Accepted canonical runs use the separate `chandas-timer-unified-session-v3` record.
Android remains authoritative for active timing, transport and alarms. Existing
schema-2/3 running programs keep their original runtime adapter until stopped;
incomplete old sessions are preserved for recovery. Configuration drafts never
replace an active run.

Before a rollback, stop the active unified timer explicitly and preserve/export
configuration data. Older binaries cannot edit schema-4 configurations; returning
to legacy keys is a downgrade of the library view, not a reverse migration of new
edits. Do not delete the unified records or restore legacy records over them as a
rollback shortcut. Verify any release candidate against the acceptance audit and
the physical-device checks below. No release was performed as part of this work.

1. Start from the exact commit intended for release and ensure unrelated working-tree changes are not included.
2. For a new store version, set the same semantic version in `app.json` and `package.json`, then refresh `package-lock.json` with `npm install`.
3. Run `npm run release:check`. This verifies Expo package compatibility, TypeScript, and the test suite. For native changes, also compile locally and run relevant Android tests and device checks before creating the release artifact.
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
eas workflow:run .eas/workflows/publish-production-update.yml -F "message=Describe the hotfix" --non-interactive --wait
```

This dedicated workflow performs the bundle export on EAS, runs type-checking
and tests, computes the Android fingerprint, and refuses to publish unless a
production AAB exists with that exact fingerprint. It never creates a native
build as a side effect. The local `publish:production` script is also available
after verifying the exact commit, environment, credentials, matching Android
fingerprint, and preview result. `eas update` performs the export locally, then
uploads the bundle to EAS Update. [Expo update workflow](https://docs.expo.dev/eas-update/getting-started/)

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
