# Timer state, transport, and power — implementation report

Date: 2026-09-28. Source specification: `timer-state-and-performance-spec-2026-09-28.md`.

## Follow-up, 2026-09-29

- Status and floating-widget countdowns now use the next watchface-visible cue. Sub-bells hidden from the watchface remain in the audible native schedule; their times no longer take over those short countdowns. The running watchface's next-cue label follows the same rule.
- Android and device sounds selected for any cue enter a device-local shared library. The sound picker shows that library for every cue, with selection marks reflecting only the cue being edited. Existing imported sounds are recovered from working programs and saved configurations on load; removing a sound from a cue does not remove it from the library.
- Sound rows, sequence and sub-bell summaries, mixers, and saved-configuration details now use the same multi-sound summary as the sound-choices editor.
- Focused JS/Kotlin tests cover display-only filtering and shared-library retention. The local Android debug build launched on the emulator without a fatal error. Imported-sound selection across two different cues and the promoted status presentation remain for device UI testing.

## Delivered

| Requirement | Implementation | Verification |
| --- | --- | --- |
| One live session and safe foreground return | Native timer remains the runtime authority. Foreground reconciliation applies an externally changed program only; periodic overlay snapshots no longer replace the working program, settings, or saved preset. A generation guard discards delayed sound preparation from an old start/update. | Unit test for identical/stale native reads and pending volume edits; emulator minimization and return. |
| Pause and clock alignment | Native pause freezes the exact position and changes the live program to elapsed alignment. Resume shifts anchors and deadlines by paused time without rejoining the wall clock. Choosing a clock mark while paused explicitly reanchors and resumes. | Kotlin alignment tests; emulator native state at pause and after Snap. |
| Immediate transport | Cycle has one Pause/Play button; Sequence has Previous, Pause/Play, Next below the watchface. Buttons disappear with hidden controls without moving the watchface. The Playback sheet is removed; ringing alarms disable transport. | Emulator layout and Sequence pause/skip. |
| Floating timer stability | Native sends structural state rather than one full snapshot per second. Expand, collapse, and cue attention update one Fabric surface. Resize follows the committed React layout so the old compact pill cannot stretch across the expanded window. The overlay surface is removed while the screen is off. | Emulator expand/collapse, background return, screen-off/on, and React root-tag log inspection. |
| Android sheet handoff | When the overlay owns the shared React host while the Activity is away, Activity return explicitly hands the resumed host back to the Activity. The overlay no longer adds an unused Gesture Handler root. A debug-client guard avoids creating the overlay React context before Expo Dev Launcher initializes. | Emulator Sound & mute and Snap sheets open after returning from the overlay; native volume changed from 0.60 to 0.45. |
| Bounded Sequence end gong | The existing `completionCue` is exposed as **End gong** for bounded runs. It replaces the terminal step cue and remains a single event. Continuous runs retain but ignore it. | Existing terminal-event fixtures plus focused JS and Kotlin tests; configuration wording inspected. |
| Per-cycle random sub-bells | One immutable seed is stored with the session and passed to the JS and Kotlin timelines. Cycle index derives a new pattern without moving the seed on pause. The watchface caches the current cycle's offsets. | Shared JS/Kotlin vectors and multiple-cycle stability/variation tests. Physical bell delivery is pending. |
| Display and service work | Foreground React refresh is aligned to second boundaries, stops while paused/backgrounded, and releases keep-awake in background. The overlay keeps a local display clock only while visible and unpaused. The native service ticks only for promoted status, and rebuilds its notification only when compact text changes. It stops when neither overlay nor promoted status needs it. | Static call-path audit, focused tests, Android build, and emulator smoke. No controlled device power measurement yet. |

## Performance investigation

The code audit found four independent display paths before this change: a 250 ms foreground `useTimerV2` refresh, a one-second overlay native state poll, a one-second overlay React display refresh, and a one-second native service snapshot plus notification rebuild. The service snapshot also entered `App.tsx` and could replace a pending volume edit. Random watchface cue offsets were recalculated on each display refresh. The foreground keep-awake request could survive backgrounding.

The new expected callback rates, derived from the code paths, are:

| Work | Before | Now |
| --- | --- | --- |
| Foreground display refresh | 4/s while running | 1/s while visible and running; 0 while paused/backgrounded |
| Native to JS full overlay snapshot | 1/s from service | 0 periodic; structural/control events only |
| Overlay native state poll | 1/s | 0 |
| Overlay local display clock | 1/s | 1/s only while screen is interactive and timer running; 0 while paused/screen off |
| Promoted notification rendering | 1/s while service running | Only when compact text changes, and only if promotion is available; it can still be 1/s during a seconds countdown |
| Random watchface offset generation | Every display refresh | Once for a program/cycle/seed combination |

These are **source-derived rates**, not measured CPU, React commit, Android wakeup, or battery rates. The emulator did not provide a controlled before/after power trace or a reliable promoted-pill flicker capture. The foreground service and Android's exact alarms may still contribute wakeups, and an e-ink panel can have device-specific refresh costs. No Supernote battery improvement is claimed yet.

## Verification performed

- `npm run release:check`: Expo dependency check, TypeScript, and 133 Vitest tests across 11 files passed.
- `:chandas-timer-service:testDebugUnitTest :app:assembleDebug --offline`: Kotlin tests and local Android debug APK build passed using installed SDK 36 and Kotlin 2.1.20.
- Android API 37 emulator: Sequence controls rendered and skipped steps while paused; floating pill expanded to the orbit watchface and returned to the app; the same React surface persisted across expand/collapse. Screen off removed the overlay window and screen on restored it. No FATAL/React error appeared in the final log inspection.
- Clock-aligned Cycle paused at a frozen 1:18; native persisted program alignment changed to `elapsed`. Selecting `:00` from the returned running screen cleared pause and persisted `local-clock` alignment. Sound & mute remained usable after an overlay round trip; the native volume value changed from 0.60 to 0.45.

The QA artifact is `android/app/build/outputs/apk/debug/app-debug.apk`, package `com.yukti.chandas.dev`, SHA-256 `E569625EFE0202921D2F5590EA15B84D831907DDB174DB0B75C87B5D08900672` (254,026,454 bytes). Its existing native debug manifest reports version `2.2.1` while the JavaScript package is `2.2.2`; this build is only for QA and is not a versioned release artifact. It is a development client that requires Metro for JavaScript. It is not a signed production battery-test artifact. No OTA update or store submission was made.

## Physical-device acceptance still pending

Run a controlled comparison on the Supernote using the prior signed release and a signed candidate with the same program. Record model/firmware, battery level, front light/brightness, theme, Wi-Fi state, Android power mode, schedule, notification permission, overlay permission, and exact-alarm permission. Keep these identical between builds. Warm each run for 10 minutes, then observe long enough for a meaningful battery change, preferably at least 60–120 minutes per scenario. Repeat when battery percentage resolution is coarse. Compare idle app, running without overlay, collapsed overlay, expanded overlay, screen off, and foreground e-ink mode. Report percent/hour or mAh/hour with run duration and measurement resolution. A development client connected to Metro is unsuitable for this comparison.

During each run, note visible full-screen/pill flashes and cue accuracy. If ADB is available, capture `dumpsys batterystats`, `dumpsys cpuinfo`, `dumpsys power`, service state, and a Perfetto CPU/wakeup trace for both builds. Check whether the promoted status pill redraws at each second on the target Android/OEM build. Also verify real cue sound, long background timing, alarm behavior, and at least two realized random cycles across a pause/resume. A short emulator run cannot establish e-ink battery or audio acceptance.
