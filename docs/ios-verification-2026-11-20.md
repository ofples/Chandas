# iPhone port verification

Android baseline: `76e2855` (2.4.0). Feature branch: `codex/ios-support`.
Research and design decisions: [iOS port plan](ios-port-plan.md).

## Scope and isolation

The canonical schema-4 configurations, drafts, timeline, availability and audio
gates remain shared. Swift runs a bundled copy of that pure kernel through
JavaScriptCore and owns iOS persistence, foreground audio, scheduled notifications,
AlarmKit and the last-viewed run's Live Activity. Android Kotlin source is
unchanged. A direct comparison confirmed that Android manifest settings, existing
EAS build profiles and submission profiles are unchanged. No production publish
or OTA update was performed during this port.

The iPhone app requires iOS 18. System alarms require iOS 26 and separate user
authorization. Regular background bells follow notification settings and use
29-second excerpts; foreground previews keep full source duration. Eligible
deterministic patterns use repeating calendar triggers; other patterns expose
bounded coverage and a continuation reminder. System alarm volume, haptics and
dismissal follow iOS. Android Focus/output filtering/overlay controls are hidden.

## Local evidence

- `npm run release:check`: Expo compatibility, actual Apple autolinking and
  generated Info.plist checks, TypeScript and **348 tests across
  28 suites passed**. The iOS adapter tests include 200 alarm/non-alarm rounds,
  global rarity arbitration, random/percentage points, muted/paused runs, bounded
  completion, quiet hours, invalid programs, sound selection, calendar compression
  and exclusion of cues predating a newly accepted run.
- Generated native JavaScriptCore resource matches its source; iOS Hermes export
  succeeded. Export logs are separate from native compilation evidence.
- Android `:chandas-timer-service:testReleaseUnitTest` was explicitly rerun using
  the existing installed NDK override: **81 tests in 12 suites passed, none
  skipped**. Native compilation inputs were unchanged/up to date. This was not
  a physical Android acceptance run.

## Native and cloud evidence

An independent public GitHub macOS job executed the kernel through actual
JavaScriptCore, checking 28 alarm/non-alarm rounds and the 56-batch bound. Swift
type checking and the full simulator app/extension compilation succeeded.
That first job stalled during simulator startup, so it was cancelled; it is not
recorded as a completed simulator acceptance pass.

EAS simulator build `15056140-ac0e-4e7e-9f63-a10f3a69e705` and unsigned arm64 build
`ad8d3584-0252-419f-b810-ee33910bba12` succeeded from `7d3eb39`. Artifact inspection
confirmed the embedded Live Activity extension, native kernel, privacy manifests
and weak AlarmKit linkage. It also found the generated executable's older minimum
OS and an inherited background-audio declaration. Both were corrected; these
first artifacts are superseded and must not be used as the final candidate.

The first interactive simulator run also exposed a missing Expo module
registration: React Native compiled the root podspec, but Expo's provider did not
discover it. Explicit `apple.podspecPath` fixes discovery of both the module and
its AppDelegate subscriber. The new release check resolves actual Expo
autolinking and inspects generated Info.plist values; iOS refuses to start
without its native engine instead of silently using a foreground fallback.

A native-clock regression checks actual Swift milliseconds and pause/resume
through JavaScriptCore. Swift dates are now floored to match integer `Date.now()`
timestamps. Iteration mute deadlines also keep their final audible boundary when
the anchor shifts during pause/resume. Unreadable native journals preserve their
source, cancel owned OS work and block destructive JavaScript restoration.

Final candidate evidence follows. Failed/cancelled builds are not passes. Only free EAS capacity and
standard public-repository macOS runners were used; EAS readback reported no cost.

The registered native simulator exposed an omitted initial mute field in control
events. Explicit defaults now cover initial, active and stopped states. Ordinary
notification bells no longer query AlarmKit without authorization; its observer
starts only after authorization, with a generation guard for replacement tasks.
The background planner budgets audible requests, skips muted/quiet spans, and
retains Alarm Once through quiet hours. Long mute and future availability fixtures
cover scheduling beyond the former 24-hour lookahead.

Final application source: `eac425bc46956c03129986ed1c1a1f863d26ec9e`.
EAS simulator build: `c453ea6d-47b5-4cb4-9e1c-98fc9f3f5c63` (succeeded).
Artifact: `artifacts/ios/chandas-eac425b-simulator.tar.gz`.
SHA-256: `a8fa1618cf419c07dec2e7914c1c68e9d09b25661dce21d0e515348ec12c72d1`.
Inspection confirms iOS 18, both simulator architectures, embedded WidgetKit
extension, weak AlarmKit linkage, privacy manifests and no background audio mode.
The embedded kernel exactly matches the normalized checked-in resource:
`b80f639c550962fd62506fd7cb7038cb28035fba22bf5c870e4db4334608ae45`.

EAS unsigned arm64 build: `5636d1d3-4599-4474-aa3c-cc075d2df848` (succeeded).
Artifact: `artifacts/ios/chandas-eac425b-unsigned.ipa`.
SHA-256: `a936c823112643f35d98c0d78cacc0b441dc4f00f21722974642f455fa1d1599`.
Its deployment target, embedded extension, weak framework linkage, background
modes and kernel match the simulator candidate. It contains no provisioning
profile or code signature; it must be personally signed before installation.

[Native verification run 44652628861](https://github.com/ofples/Chandas/actions/runs/44652628861)
completed successfully at the exact application source above. Both the fast
checks/native JavaScriptCore/Swift checks and the separate clean CocoaPods app
and extension compilation job passed.

EAS account readback after the final builds: Free plan, nine builds used in the
reported aggregate allowance, total cost zero. No plan upgrade or paid simulator
service was enabled.

Simulator run `44655232565` reached the real native running screen, verified
accepted background coverage, pause/resume and two simultaneous timers. Its
subsequent card-open assertion failed because Maestro tapped the parent's center,
which is intentionally the nested pause button; the capture confirms that timer
paused. The test now targets the card's title area. Earlier test setup also now
waits for cold-start onboarding and confirms Skip dismissal before navigation.
These are harness corrections, not changes to the application artifact.

Run `44656848180` captured a separate simulator permission-dialog race: after
the Allow dialog disappeared, the tap hid the underlying timer controls, also
hiding the coverage caption. The flow now conditionally reveals controls before
the unchanged coverage assertion. This preserves the app's tap-to-hide behavior.

Visual review of this candidate's setup, running, paused and simultaneous-timer
gallery captures found consistent shared controls and no clipped title or timer.
Representative local captures: `artifacts/ios/ios-preview-running.png` and
`artifacts/ios/ios-preview-multiple-timers.png`.

### Completed simulator acceptance

[Run 44658602182](https://github.com/ofples/Chandas/actions/runs/44658602182)
**passed** on an iPhone 17 Pro simulator running iOS 26.5, using the exact EAS
simulator artifact above. The workflow source is `35a0935`; its differences
from application build source `eac425b` are exclusively the smoke-test YAML.

The flow verified cold launch/onboarding dismissal, Configurations and New,
native start and accepted background scheduling coverage, pause/resume, starting
Meditation alongside the unnamed timer, opening its card outside the pause
button, both running pages, backgrounding, process termination and native-ledger
restoration, then confirmed Stop all and removal of group running controls.
Eleven screenshots and the interaction trace are saved under
`artifacts/ios/ui-eac425b-final/`. Visual review also confirmed the simulator's
Dynamic Island Live Activity countdown while on Home, the two restored timer
cards and the stopped library. This is simulator evidence, not physical iPhone
lock-screen or alarm/audio acceptance.

## Remaining physical acceptance

No iPhone or paid Apple Developer membership is available for this run. The IPA
is intentionally unsigned. Free personal signing, seven-day re-signing, extension
installation and AlarmKit permissions still require an actual iPhone. TestFlight
and App Store distribution are not available with a free account.

Before calling the port production accepted, verify real locked/silent/Focus
bells and alarms, permission denial/revocation, long-running 5/2 and simultaneous
timers, dismissal/stop, relaunch/termination/reboot, imported sounds and audio
routes, Live Activity focus and expiry. Simulator screens and successful builds
do not establish those behaviors.
