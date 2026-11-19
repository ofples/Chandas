# iPhone support: research, architecture and delivery plan

Research date: 20 November 2026. Baseline: Android 2.4.0, source `76e2855`.
Authority: implement the port, cloud-build it, and use only free or already
included capacity. No Apple Developer membership; an iPhone may be available
later. Android production publishing and OTA updates are outside this port.

## Goal prompt

Implement maintainable iPhone support without weakening Android. Audit every
integration, verify current primary-source APIs, share canonical timer semantics,
isolate platform delivery, and make unavailable guarantees visible. Preserve
configuration identity/drafts, multi-run isolation, deterministic randomness,
cue rarity precedence, alarm ownership, absolute timing and restoration. Compile
and test native iOS code on free macOS infrastructure, build with Expo when free
capacity permits, and prepare an unsigned device artifact for eventual free
personal signing. Separate source implementation, cloud compilation, simulator
acceptance and physical-device acceptance in all reports. Never claim arbitrary
background execution, alarm auto-dismissal or unrestricted distribution on iOS.

## Research rounds and findings

### 1. Existing system audit

The UI, configurations, migration, import/export, tour, gestures, timeline and
audio gates are shared TypeScript. `src/native/ChandasTimerService.ts` selects
only Android, so iOS currently falls back to foreground JavaScript and cannot
deliver reliable suspended-app bells. Android has authoritative per-run storage,
AlarmManager receivers, independently scoped alarm/cue services, global cue
arbitration, ongoing notifications, promoted status, an optional overlay and a
Do Not Disturb rule. Native schema/feature capability negotiation already exists.
Retain it rather than inventing another saved-program format.

### 2. Scheduling and background execution

Apple's [background execution guide](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app)
does not provide an exact recurring CPU wakeup for interval apps. Refresh jobs
are discretionary; short background tasks finish work, not run timers forever.
Do not substitute polling, silent audio, VoIP, location or background pushes.
[Review guideline 2.5.4](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
requires background modes to be used for their intended purposes.

Use absolute, precomputed local notifications for ordinary suspended-app bells.
Use a bounded earliest-first global queue, reserve capacity for a continuation
reminder, verify scheduling errors, expose the actual coverage deadline, and
refill on launch, foreground interaction and foreground progression. Historical
[Apple documentation](https://developer.apple.com/documentation/uikit/uilocalnotification)
documents the 64-pending limit; current UserNotifications docs do not promise an
unlimited queue. Conservatively budget below 64 and read actual pending requests.
Do not advertise infinite unattended scheduling. A future server/APNs system
would add network dependency and still would not guarantee exact delivery.

### 3. Alarms

[AlarmKit](https://developer.apple.com/documentation/alarmkit) is available from
iOS/iPadOS 26. It provides user-authorized system alarms that bypass silent mode
and Focus. `NSAlarmKitUsageDescription` is mandatory. Authorization is independent
of notification authorization. Its maximum scheduled count is not a public fixed
number: handle `AlarmManager.AlarmError.maximumLimitReached` rather than assume
unlimited alarms. [Apple's sample](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit)
shows fixed dates, persisted identifiers, stop intents, daemon reconciliation and
an alarm update stream. A countdown presentation requires a widget extension;
do not configure one unless that extension is actually installed.

Use fixed-date AlarmKit alerts only for authored alarm events, never ordinary
bells. Bind each to run, generation and logical event; cancel only owned IDs.
Observe daemon state for the in-app alarm screen, reconcile missing/dismissed
alarms, and discard stale work after stop/reanchor. AlarmKit has no documented
automatic ring-duration parameter. While suspended, iOS owns dismissal; explain
that these alarms ring until dismissed. Do not pretend Android's automatic
duration cap or programmatic future stop can execute while suspended. Before
iOS 26, prominent alarms are unavailable; refuse an alarm-enabled start with an
actionable explanation rather than silently call a normal notification an alarm.

### 4. Sounds, haptics, routes and Focus

[Notification sounds](https://developer.apple.com/documentation/usernotifications/unnotificationsound)
must be supported PCM/IMA4/uLaw/aLaw in WAV/CAF/AIFF, under 30 seconds and already
in bundle/Library/Sounds. Prepare compatible copies of included/imported audio;
never silently truncate the user's source file or use MP3 directly as a system
notification sound. Foreground previews/cues use the full original audio; show
the background sound limit. Notification volume and background haptic patterns
are system-controlled. No ordinary notification sound bypasses the silent switch.

[AVAudioSession](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)
supports mix/duck/exclusive foreground playback. Activate only for real sound,
handle interruptions and route changes, release with notify-others-on-deactivation.
No microphone permission. iOS has no Android ringtone-library picker; Files
imports and included sounds remain available. Android content URIs imported in a
configuration must remain visibly unavailable, not rewritten to a different bell.
System alerts use system-selected output and mixing, so hide Android's output
filter control and explain this boundary. Foreground call/interruption muting is
possible; suspended notification/alarm policy is controlled by iOS, not a live
call observer. iOS does not let Chandas toggle global Focus: hide the Android
Focus automation and floating overlay, retain cross-platform user preferences.

### 5. System surfaces

[Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
are the iPhone equivalent of ongoing timer status, not an Android notification
clone. They need an extension, have a 4KB state limit and an eight-hour active
life. No extension CPU timer or network access can keep the app alive. Use one
activity for the last-viewed active run, an active-run count, system-rendered
bounded remaining time or continuous elapsed time and a link back to that run.
Avoid a stale step countdown labelled as the current step after suspension.
The OS chooses Dynamic Island prominence; visibility cannot be guaranteed.
An independent Home Screen data widget needs shared-container capabilities and
refresh budgets; do not add App Groups to the free-signing baseline. The Live
Activity extension can receive its small state directly through ActivityKit.

### 6. Build, testing and free sharing

[EAS simulator builds](https://docs.expo.dev/build-reference/simulators/) need no
Apple membership, but cannot run on an iPhone or Windows simulator. The public
repository permits [free standard GitHub macOS runners](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Use them for Swift tests, clean prebuild, CocoaPods, unsigned compilation,
simulator launch, screenshots and focused UI smoke tests. Use simulator/device
artifacts as separate outputs. No private Apple credentials in CI.

[EAS custom builds](https://docs.expo.dev/eas/json/#common-properties-for-native-platforms)
support `withoutCredentials`; package an unsigned arm64 device app separately for
personal re-signing. Inspect the account's included build allowance before
starting it. No paid queue or resource class. No TestFlight/App Store submission
without membership. [Apple Personal Teams](https://developer.apple.com/help/account/basics/about-your-developer-account)
expire provisioning in seven days and permit three apps per device. Microsoft's
Windows cannot replace Xcode's simulator. [Sideloadly](https://sideloadly.io/) and
[AltStore Classic](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows)
describe Windows/free-Apple-account installation; this is a third-party signing
route, not unrestricted official distribution. The user enters credentials
locally. Extension/AlarmKit acceptance under the resulting profile must be tested,
not inferred from successful unsigned compilation. Never strip capabilities and
claim they still work.

## Architecture decisions

1. Keep Android Kotlin source and Android-only plugin behavior intact. Add Apple
   registration, a podspec and an iOS-only prebuild plugin; no manual generated
   Xcode edits, no library migration solely for the port.
2. Reuse the pure canonical TypeScript timeline, normalization and audio gates
   inside a bundled JavaScriptCore kernel on iOS. Generate a deterministic local
   resource with esbuild, check it for drift, and run the same fixture assertions
   through native JavaScriptCore. This avoids maintaining a third handwritten
   recurrence engine. The resource is shipped in the binary, never downloaded.
3. Swift owns the durable run ledger, generations, foreground deadline driver,
   native audio, notification/AlarmKit reconciliation and ActivityKit lifecycle.
   React is a presentation/client layer and uses the existing service contract.
   All native mutations serialize; asynchronous system work checks its generation.
4. Keep schema 4 and existing AsyncStorage journals. Validate before accepting a
   native start; persist accepted state before scheduling; stop removes owned
   system work and verifies inactivity. On relaunch attach durable native runs,
   reconcile deadlines, do not replay old sounds, and preserve unreadable data.
5. Plan all runs together. Resolve each timestamp using existing per-program
   precedence and shared cross-run rarity/alarm precedence before allocating OS
   requests. Keep logical event progression independent of the winning sound.
   Muting, availability, completion, per-step alarm flags and Alarm Once must use
   the canonical pure transitions. Sound selection is deterministic per cue/event.
6. Permissions and feature support are explicit. Request at start/use, show denied
   or unavailable states and the actual background coverage. Do not show Android
   setting links, DND toggles or hardware pickers on iOS. Do not mutate saved
   Android settings simply because the iPhone cannot use them.
7. Separate `ios-simulator` and unsigned-device EAS profiles and a manual cloud
   verification workflow. Pin/select an Xcode with AlarmKit SDK support and build
   the extension and app together. Never reuse Android native fingerprints.

## Implementation and acceptance sequence

1. Add shared kernel/planner and fixture tests: second precision, 5/2 after many
   rounds, no alarm inheritance, random/relative points, finite/infinite runs,
   simultaneous rarer cues, mute boundaries, availability/DST, pause/skip/scrub,
   queue exhaustion and invalid/future programs.
2. Add native ledger/audio/scheduling adapters and permission/status bridge.
   Check generation races, restore, atomic file writes, failed OS requests,
   notification ownership and AlarmKit daemon reconciliation.
3. Add Live Activity extension with compact/minimal/expanded/lock-screen views,
   safe links, accessibility, count and honest elapsed/bounded countdown text.
4. Add iOS capability-aware settings, sound sources, alarm explanations and
   scheduling coverage. Keep shared UI components and Android behavior.
5. Run shared suite, TypeScript, clean prebuild and iOS export locally. Run native
   macOS tests/compilation/simulator screenshots remotely and fix failures. Run
   Android contract/regression checks; inspect generated Android diff for changes.
6. Build on EAS within included quota; download/inspect simulator and unsigned
   device outputs as available. Document exact commits/artifact hashes and limits.
7. Physical iPhone acceptance later: actual free signing and extension install,
   permission denial/revocation, silent/Focus/locked/terminated/reboot, many 5/2
   rounds, concurrent cues, import sounds, calls/headphones/Bluetooth, Live Activity
   duration, user stop/dismiss/pause and seven-day provisioning expiry. A simulator
   pass does not prove those behaviors. No production iOS claim before this gate.

## Risk register

The unavoidable constraints are bounded background queues, system-controlled alert
volume/haptics, no exact arbitrary background execution, no Android DND/overlay,
AlarmKit's iOS 26 availability and dismissal behavior, and expiring free signing.
The main engineering risks are stale async scheduling, duplicate foreground/system
audio, lost draft/run identity and drift between timeline implementations. The
generation ledger, one shared kernel, explicit coverage and native/cloud tests
address the controllable risks. Keep this document updated with observed evidence
and unresolved acceptance rather than replacing constraints with optimistic claims.
