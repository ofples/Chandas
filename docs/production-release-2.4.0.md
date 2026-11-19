# Chandas 2.4.0 production release

Prepared and submitted November 19, 2026, under the user's explicit authority to manage and publish the Google Play project without further approval except for charges. No paid builds or other charged actions were used.

## Release identity

- Android package: `com.yukti.chandas`; version `2.4.0`; version code `21`.
- Release source: `bf8bf09c75b3b5a5f7f7788ac6c6f97cdb990f08` on `codex/timer-setup-prototype`.
- Signed local AAB: `artifacts/android/2.4.0/chandas-2.4.0-production-21.aab`.
- SHA-256: `2d51e24b11c0886e29916733274650fae56550578e0a141eb0ee97351a353ba7`.
- Registered upload certificate SHA-256: `636242675b8faf103faebbdae62ecef76345feaf3d3387b71680dac2ff6d60f6`; matched prior Play artifacts and accepted by Play. No key rotation.
- Expo Updates channel: `production`; embedded native fingerprint: `cac818ae8511dacfeee37af63758127a8bd2f954`. Runtime policy remains fingerprint; no incompatible OTA was published.
- Remote EAS Android version code synchronized to 21 to prevent future version collisions.
- Production rollout: 100% of existing targeted countries, managed publishing off. Publication is automatic after Google approval. Submission is not proof the release is live.

## Product and release changes

Bell Points combines relative percentages and fixed after-start/before-end positions. Visibility combines color and clock-face controls. Quick tour highlights real controls, includes repeating sub-bells, and can be skipped or replayed without discarding timers. Starter templates are ordinary deletable configurations.

The release pass additionally fixed running transport being obscured by the footer on shorter phones, removed the retired live-countdown preference as a hidden gate for native timer status, exposed Android notification settings after permission is granted, and made Bluetooth hardware optional. Play's final device comparison reported zero previously supported devices lost, seven newly supported phones, and ten newly supported tablets.

The existing portrait design remains intentional for this release. Play's portrait-hardware availability advisory was acknowledged with that explanation. This is distinct from the Bluetooth restriction, which was fixed. The deobfuscation advisory is informational because R8/ProGuard obfuscation is not enabled in this generated release variant.

## Verification

- `npm run release:check`: Expo dependency compatibility, TypeScript and 326 tests in 27 suites passed.
- Native release compilation, Android lint and 81 unit tests passed.
- Signed AAB validated with bundletool and certificate verification. All four ABIs are present, with 22 libraries each. All 64-bit ELF load segments meet 16 KB alignment; the bundle requests 16 KB ZIP alignment.
- Actual native release APK installed on a dedicated Android 16 emulator. Older 2.2.3 setup name survived upgrade; active native timers survived the candidate update. Fresh-install guided tour and starter configurations were also checked on the emulator. Earlier prototype checks on the Pixel are separate evidence, not acceptance of this final release binary.
- Visually checked running and setup screens, configurations and card-width menu, nested settings, Bell Points with 25/50/75 percent positions, import selection, two simultaneous timers, and safe-area/transport layout at short and larger logical screen sizes.
- Recorded real background bell playback, lock-screen alarm presentation, notification dismissal, and finite playback of an Android alarm sound used as an ordinary cue.
- Verified the special-use countdown foreground service while the user-enabled floating timer was visible over the home screen. Stopping the timer through its ongoing notification removed the overlay and foreground service.
- This emulator exposes standard ongoing notifications rather than Android's optional promoted status-bar chip. A new physical Pixel chip-presentation test was not performed after the user asked to continue without the phone.
- Repeated-round test evidence is recorded separately in the local `round-verification.json` artifact; see the final verification addendum below.

## Store and permission package

Four actual 1080 by 1920 native screenshots replace the old listing screenshots. The description now covers multiple timers, steps, Bell Points, templates and the tour. These screenshots are direct captures, not generated promotional imagery.

The privacy policy and Data safety form were corrected for Expo Update's random installation identifier and update-failure diagnostics, following Expo's current [privacy declaration guide](https://docs.expo.dev/eas-update/store-privacy-declarations/). Declared collected data: Device or other IDs and Crash logs; service-provider processing, not third-party sharing; HTTPS; required collection, not ephemeral. No user accounts or advertising. The privacy policy also explains optional call-state checks, Bluetooth output categorization, floating-timer access and user-directed file sharing.

- [Published privacy policy](https://ofples.github.io/StaticPages/chandas_privacy_policy.html)
- [Permission review page and both videos](https://ofples.github.io/StaticPages/chandas-play-review-2.4.0.html)
- Foreground-service declaration: MEDIA_PLAYBACK / Other for scheduled audible cues and alarms; SPECIAL_USE / Other for active live status and floating timer. Both video links were saved in Play Console.
- Existing exact-alarm and full-screen-intent declarations identify the app's alarm functionality and remain in place.

Google Play Console showed all five changes in the submitted review group: production rollout, short description, full description, screenshots and Data safety. The foreground-service declaration is attached to the review context. Managed publishing was off. Automated checks and Google's review determine when the release becomes available.

## Final verification and submission readback

The signed build 21 completed a real-clock 60-cycle, seven-minute native sequence: a five-second step with alarm enabled followed by a two-second step without alarm. The latter used Android's looping Beep-Beep-Beep alarm asset as an ordinary cue. Instrumentation observed rounds 30 through 59, including all 30 quiet windows and all 30 intended alarm windows; it found zero unexpected alarm states, and the timer completed normally. The observer was restarted midway after a transient empty preference-file read; this was corrected in the test reader, without changing the app or its timing. The final Android crash buffer was empty. This is accelerated repeated-round evidence, not an hours-long physical-device test.

Play's automated submission checks finished, and the final publishing overview explicitly reported: "Your changes are now in review." The production row was "2.4.0 — Multiple timers and Bell Points" / "Start full rollout", with managed publishing off. The release is awaiting Google's review and will publish automatically after approval; it was not yet live at this readback. Local proof: `artifacts/android/2.4.0/play-production-in-review.jpg`.

Nonbreaking dependency updates removed the critical build-tool advisory. Four npm advisories remain in build/development dependencies (three moderate and one high); the proposed forced resolution would downgrade Expo across SDK generations and was not applied. No untrusted-image processing or other corresponding input path was identified in the installed native app. These advisories should be revisited with upstream-compatible dependency updates.
