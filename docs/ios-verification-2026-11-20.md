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

- `npm run release:check`: Expo compatibility, TypeScript and **341 tests across
  28 suites passed**. The iOS adapter tests include 200 alarm/non-alarm rounds,
  global rarity arbitration, random/percentage points, muted/paused runs, bounded
  completion, quiet hours, invalid programs, sound selection, calendar compression
  and exclusion of cues predating a newly accepted run.
- Generated native JavaScriptCore resource matches its source; iOS Hermes export
  succeeded. Export logs are separate from native compilation evidence.
- Android `:chandas-timer-service:testReleaseUnitTest` succeeded using the existing
  installed NDK override. Its unchanged native test outputs were up to date;
  this was not a fresh physical Android acceptance run.

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

Final candidate builds and simulator acceptance results are recorded below after
completion. Failed/cancelled builds are not passes. Only free EAS capacity and
standard public-repository macOS runners were used; EAS readback reported no cost.

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
