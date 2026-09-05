# Timer v2 implementation review and completion report

Status: source implementation complete; remote Android build and on-device validation required before release

Reviewed and remediated: 2026-09-03
Scope: product specification, approved HTML mockup, React Native application, Android native module, persistence, scheduling, audio, Focus/DND, accessibility, and permitted verification

## 1. Executive assessment

Timer v2 is now implemented as the cohesive program-based timer described in `timer-v2-spec-and-log.md`. The original review found fifteen substantive gaps. Each has been addressed in source, and the later completion audit found and fixed additional recovery and interaction defects.

No known P0 or P1 source-level defect remains after this review. The strongest parts of the result are:

- One deterministic Pattern/Sequence program model with validation on both sides of the native bridge.
- Android-owned exact scheduling with one future event, a session generation, and a logical event identity.
- Explicit Pattern-main versus Sequence-cycle semantics.
- Alarm-stream routing for all timer audio, independently of Focus.
- A Chandas-owned priority DND rule whose read path does not mutate Android state.
- Immutable presets, a working-copy editor, multi-track Pattern grids, ordered Sequence steps, Mixer, mute, Help, and the approved running visualization.
- Recovery paths for process recreation, reboot, package replacement, manual time changes, timezone changes, daylight-saving transitions, URI loss, permission loss, and stale PendingIntents.

This is not yet an assertion that the Android binary is release-ready. Repository policy prohibits local Gradle/native builds, so the Kotlin source and manifest integration have been reviewed statically but not compiled in this pass. A remote EAS development build followed by the device matrix in section 10 remains the release gate.

## 2. Review method

The audit covered:

- Every locked product decision D-001 through D-034.
- The ten HTML mockup surfaces and their desktop/mobile behavior.
- All Timer v2 TypeScript domain, persistence, runtime, editor, sheet, and running-screen code.
- The complete local Expo Android module: bridge, exact scheduler, timeline mirror, state store, receivers, notifications, audio player, alarm foreground service, call-state gate, active hours, DND condition provider, and Focus controller.
- App configuration, local-module autolinking, and the config plugin.
- Current Android and Expo documentation for exact alarms, alarm audio usage, audio focus, DND automatic rules, Android 15 user-managed rules, full-screen alarms, persisted document access, phone-call state, broadcasts, and Expo activity-result contracts.

Permitted verification completed:

- `npx tsc --noEmit`
- `npm test` — 37 focused tests passing
- `git diff --check`
- Expo public configuration resolution
- Expo Android local-module autolinking resolution, with no duplicate module
- Live React Native Web walkthrough at desktop and `390 × 844`
- Direct browser checks of Pattern, Sequence, trigger-grid, bulk selection, presets, sounds, Mixer, running controls, Help, and responsive layout

Not run:

- Gradle compilation or Kotlin tests
- Android Studio or emulator builds
- `expo run:android`, Expo export, prebuild, or local EAS

Those omissions are deliberate requirements of `AGENTS.md`, not skipped verification.

## 3. Findings and remediation status

| ID | Original finding | Resolution | Evidence |
| --- | --- | --- | --- |
| R-01 | Ordinary cues were not always routed as alarm audio. | Every native one-shot and continuous alarm now uses `USAGE_ALARM` and sonification content type. Focus no longer controls routing. | `0286d2b` |
| R-02 | A Sequence cycle boundary could start the continuous alarm. | Pattern-main and Sequence-cycle are distinct boundaries. Only Pattern main events consult Alarm Once/Locked; Sequence has no Alarm control. | `160ed81`, `50f070e` |
| R-03 | React and native runtime state could diverge after recovery or an external change. | Android runtime state is authoritative; startup and foreground paths query/reconcile it, and native emits schedule, alarm, control, cue, and Focus events. | `50f070e`, `d3921a7`, `06c84f6` |
| R-04 | Focus policy and refresh could overwrite or misreport Android state. | Focus uses a priority rule with only alarm allowance set. Read-only query is separate from reconciliation. Disable, removal, activation, deactivation, manual snooze, missing access, and Android 15 user management are modeled. | `0f3e8f2`, `d3921a7`, `06c84f6` |
| R-05 | Exact timing silently degraded to an inexact alarm. | Start requires exact access; scheduling uses `setExactAndAllowWhileIdle`; loss or `SecurityException` fails closed and clears the authoritative session instead of leaving a limbo timer. Android 12/12L permission coverage was added. | `50f070e`, `06c84f6` |
| R-06 | JavaScript fallback consumed Alarm Once before choosing continuous playback. | Runtime gating returns playback disposition and next control state separately; the complete alarm gesture/gate table is tested. | `160ed81` |
| R-07 | Sound-sheet changes could apply against stale cue data. | Cue edits resolve current state by identity and sheet state follows the current cue; sound and volume changes no longer undo each other. | `78f6eed` |
| R-08 | PendingIntents lacked complete logical identity. | Every scheduled event persists and carries timestamp, event type, logical ID, and session generation. A receiver rejects any mismatch. | `50f070e` |
| R-09 | Native program JSON was insufficiently validated. | Kotlin validates schema version, size, mode, counts, duration bounds, IDs, labels, offsets, cue volume, sound kind, URI/title length, cycle duration, and anchor arithmetic before scheduling. | `d3921a7`, `06c84f6` |
| R-10 | Clock snapping did not fully cover DST offset transitions. | Local-clock schedules compare their civil lattice at delivery and scheduling, use an exact timezone-transition sentinel on API 24+, and listen for time/timezone/date/offset changes. Elapsed schedules shift across manual wall-clock edits. | `396413d`, `d3921a7` |
| R-11 | Call auto-mute could fail opaquely. | Call access is an explicit optional setup state. Native uses aggregate `TelecomManager.isInCall` with a compatible telephony fallback. Normal cues are suppressed without consuming mute or Alarm Once and are never replayed. | `396413d`, `d3921a7` |
| R-12 | Continuous alarm focus and cue fidelity were incomplete. | The service requests transient alarm focus, reacts to gain/loss, loops the selected main cue at master × cue level, updates live volume, and cleans up foreground/audio state idempotently. | `0286d2b`, `d3921a7` |
| R-13 | Device sounds, documents, preview, and fallback were incomplete. | Modern registered activity-result contracts open Android ringtone and document pickers. Document permission is persisted when granted. One resolver handles preview/playback and falls back to a built-in cue without breaking scheduling. | `0286d2b`, `06c84f6`, `311755f` |
| R-14 | Rapid persistence writes could finish out of order. | Configuration and session writes use independent serialized queues; stopping cannot be overtaken by an older session save. | `0837fb1` |
| R-15 | Preset provenance could become stale. | Mode changes clear unrelated provenance. Deleting a loaded source marks it deleted while retaining the independent working copy. | `78f6eed`, `0837fb1` |
| R-16 | Foregrounding could still surface a queued background cue animation. | Native events now carry actual delivery time. UI flashes require a fresh, unsuppressed signal while the app is active; delayed web timers skip catch-up playback. | `5248e14` |
| R-17 | Trigger-grid bulk updates and drag painting could render or apply stale selection state. | Rendering follows props while stable refs serve only the in-flight gesture. Clear/Select and drag updates use the latest offsets/callback. | `311755f` |
| R-18 | A quick double Start could create two native sessions; a receiver exception could retain `goAsync`. | Start is guarded and exposes a busy/disabled state. Receiver completion is exactly-once and attempts safe schedule restoration after an unexpected exception. | `5248e14` |
| R-19 | The alarm overlay allowed accidental whole-screen dismissal and exposed the timer controls to accessibility. | Dismissal is an explicit action; the underlying screen is inert and hidden from accessibility while the modal alarm is visible. | `311755f` |
| R-20 | Animated SVG fill produced a React Native Web failure in the ringing surface. | The flash fill is now an equivalent centered animated native View while the progress rings remain SVG. | `311755f` |

## 4. Architecture assessment

### 4.1 Domain and validation

The TypeScript domain is the editor/configuration source of truth. It normalizes corrupt storage into safe values, retains stable cue IDs, caps Pattern tracks at five and Sequence steps at twenty, and enforces the 1–240 minute duration/cadence bounds.

The Kotlin runtime deliberately does not trust the bridge. It validates the serialized version-2 program independently before saving, updating, restoring, or scheduling it. Pattern overlap candidates remain observable but exactly one winner is selected by current array order. Main boundaries are not valid sub-track offsets, so the main gong never competes with a sub-bell.

A shared JSON fixture corpus is consumed by TypeScript tests and staged Kotlin tests to reduce timeline drift. The Kotlin tests still need a remote/native test run.

### 4.2 Native runtime authority

Android stores the complete recoverable program, anchor, relevant settings, mute boundary, Alarm Once/Locked state, next event identity, session generation, ringing state, and wall/monotonic clock samples.

Only one timer event is scheduled at a time. On delivery:

1. The receiver validates generation, logical ID, event type, and epoch.
2. Native reconciles a local-clock phase if needed.
3. Active hours and call gating are evaluated at delivery time.
4. Mute and Alarm Once are consumed only when their exact semantic conditions are satisfied.
5. The next event is scheduled before potentially long audio playback.
6. Native emits a typed event and starts one-shot or continuous alarm audio.

This ordering prevents duplicate delivery, stale PendingIntent playback, and a long media preparation from blocking the next schedule.

### 4.3 Exact alarms

Precise timer delivery is a hard invariant rather than an optimistic preference:

- Android 12/12L declare `SCHEDULE_EXACT_ALARM` only through API 32.
- Android 13+ declare `USE_EXACT_ALARM`.
- The scheduler checks `canScheduleExactAlarms()` before Start and before every next-event schedule.
- It uses `setExactAndAllowWhileIdle`, not an inexact fallback.
- If access is unavailable or a scheduling call throws `SecurityException`, native cancels pending work, audio, Focus, notifications, alarm service, and persisted active state, then publishes one authoritative inactive state.

Android does not broadcast exact-alarm revocation. Therefore a background process cannot detect revocation at the instant it happens. Chandas closes the unavoidable gap on the next foreground/reconciliation and never continues to claim a viable timer afterward.

### 4.4 Civil time, active hours, and DST

Pattern clock alignment is expressed as a local minute offset, not a fixed UTC phase. After timezone, DST, date, or manual-time changes, the scheduler selects a strictly future event on the current civil lattice. A timezone-transition sentinel provides pre-API-37 DST coverage.

Elapsed Pattern and Sequence schedules retain elapsed cadence across manual clock changes using paired wall and monotonic samples. Active hours gate audio and Focus while phase advances silently. Skipped cues are never replayed. Cross-midnight windows are attributed to their starting day. Equal endpoints mean the selected civil day is active for the full day, with midnight as its boundary.

### 4.5 Audio and alarms

All timer sounds are application-level `MediaPlayer` playback with alarm audio attributes. Notification channels are intentionally soundless, preventing a second notification sound from competing with the selected cue.

Effective level is:

`app master × cue level × phone Alarm stream volume`

Chandas never writes the phone's Alarm volume. User mute is stored separately from both app levels.

Alarm Once and Locked are Pattern-main-only. The continuous service promotes itself before requesting audio focus, honors focus results and losses, uses the selected main cue, loops until explicit dismissal, and can be dismissed from either the app overlay or native notification action. Alarm visibility remains available even if Android denies audio focus, so the user can understand and dismiss the alarm state.

Alarm audio usage is not an absolute bypass around every Android mode. An unrelated user DND mode that disallows alarms can still silence the Alarm stream. Chandas Focus explicitly allows alarms, but Chandas neither displays nor rewrites unrelated DND modes.

### 4.6 Focus/DND

The implementation separates:

- Automation preference.
- Whether the running timer currently requests Focus.
- The actual/observable Android state.

Read-only queries never publish a condition. Reconciliation is limited to real preference, timer, active-hours, or permission transitions. The owned rule uses priority interruption with `allowAlarms(true)` and does not request changes to other interruption categories or visual effects. Android and the user remain authoritative for those unspecified fields; Chandas does not claim to copy or inherit every property of another DND rule.

Chandas does not claim it can clone the active DND profile. Android has no supported API that safely copies every exclusion and OEM-specific policy into a new automatic rule.

On Android 15, user-managed rule state is read directly and the rule-specific settings page is opened. On older releases where actual rule activation is not exposed, the UI reports Ready/Unknown rather than falsely claiming Active.

### 4.7 Sound selection

Five stable built-in identities exist now; placeholder assets intentionally share the current bell/gong recordings until a production sound pack is supplied. Android ringtone and notification choices retain their content URI. Device files use `ACTION_OPEN_DOCUMENT` and persist read access when the provider grants it.

Availability is checked without mutating the configured sound. Missing sources are labeled Unavailable, offer Replace, and fall back at playback. Media descriptors and players are closed on completion, failure, replacement, backgrounding, sheet close, and module teardown.

### 4.8 React/native bridge

The Expo bridge uses declared typed events and modern `RegisterActivityContracts` launchers. Picker calls run on the main queue and use a non-queuing mutex, so an accidental double tap cannot open a second picker after the first closes. Cancellation is rethrown; other launcher failures become a calm recoverable UI message.

The module is discoverable through Expo autolinking with no duplicates. Full-screen alarm window flags are applied by the config plugin to both cold-launch and single-task `onNewIntent` paths.

The repository uses Expo continuous native generation as its tracked delivery model: `app.json`, the config plugin, and `modules/chandas-timer-service` are the source artifacts. The local generated `android/` directory is ignored and is not evidence of what a remote build will compile; it must be regenerated by the supported build pipeline rather than treated as hand-maintained source.

## 5. UX and mockup alignment

### Pattern configuration

- Exact main quick choices `10m`, `15m`, `30m`, and Custom are restored.
- Clock alignment uses `:00`, `:10`, `:15`, and Custom.
- Up to five sub-bell tracks are summarized on the main screen.
- Detailed cue positions live in a dedicated sheet with cadence choices, tap/drag paint, Clear all, Select all, overlap markers, and explicit top-row priority.
- Reordering the visible list is the sole overlap-priority control.
- Disabled tracks retain their configured selections.

### Sequence configuration

- One to twenty steps repeat as a cycle.
- Each step has label, duration, sound, volume, duplicate, and conditional removal.
- Drag handles lift the whole row, clamp travel to valid positions, provide boundary/drop haptics, and expose accessibility increment/decrement actions.
- Sequence running deliberately has no Alarm control.

### Running timer

- Pattern shows an outer main ring and one inner progress ring per enabled track with selected cues.
- Center text shows the main countdown and only the next sub-bell.
- Sequence shows current step/index and the next step.
- Restart, clock alignment, Alarm, Focus, Mixer/mute, Help, and Stop are present only where applicable.
- Alarm uses exclusive single/double recognition: one tap arms the next main gong, a quick second tap locks every main gong, and an active alarm setting can be turned off.
- Long press produces a tooltip without activating the control.
- No overlap explanation, `Main boundary at…` label, or unwired overflow dots remain on the running page.

### Mixer, mute, presets, sounds, and help

- Mixer exposes Master and every cue channel, preview, percentage, and the effective-volume explanation.
- Cycle mute retains `1×`, `2×`, `3×`, and custom minutes; the selected final main/cycle boundary remains audible.
- Presets are immutable, mode-filterable snapshots. Load creates a working copy; Save always creates another item; Delete never destroys the working copy.
- Sound selection is progressively divided into Built-in, Android, and Device sources.
- Help covers every running control, alarm gesture, Focus/DND, active hours, collision order, volume, and mute.

### Accessibility and motion

- Icon controls have roles, labels, state, and hints.
- Cue cells announce minute, selection, overlap, and winner.
- Sliders announce cue and percentage.
- Reorder controls have 44-point targets and adjustable actions.
- Alarm content is modal; underlying controls are unavailable while ringing.
- Modal container pressables are not exposed as false accessibility controls.
- Reduced-motion preference disables row layout/lift animation and immediate-cancels a terminated drag.

## 6. Verification results

| Check | Result |
| --- | --- |
| TypeScript | Pass |
| Focused Vitest suite | Pass — 37/37 |
| Whitespace/diff validation | Pass |
| Expo config resolution | Pass |
| Expo local-module discovery | Pass; one `chandas-timer-service`, no duplicates |
| React Native Web desktop walkthrough | Pass |
| React Native Web mobile `390 × 844` walkthrough | Pass |
| Trigger Clear all / Select all state | Pass in live browser |
| Pattern/Sequence mode-specific controls | Pass in live browser |
| Native compilation | Not run; prohibited locally |
| Kotlin unit tests | Not run; require allowed remote/native environment |
| Physical Android behavior | Pending device matrix |

The web preview produced one benign browser `AbortError` when a playing HTML audio element was immediately stopped during QA/HMR. This comes from browser media interruption and was not an application crash. Native timer playback does not use that web media path.

The package manager also reports 20 dependency advisories (12 moderate, 8 high) in the current dependency tree. They were not auto-fixed because broad dependency upgrades are outside this timer change and can introduce breaking Expo/React Native version drift. They should be triaged as a separate dependency-maintenance task before a production release.

## 7. Remaining limitations and recommendations

### Required before release

1. Request a remote EAS development build so Kotlin and manifest merging compile in the supported environment.
2. Run the Kotlin fixture tests in that environment.
3. Install the development build on representative Android devices and complete section 10.
4. Complete the Google Play `USE_EXACT_ALARM` declaration. Chandas is a timer app, which is an eligible core use case, but store review still requires the declaration.
5. Confirm the full-screen-intent declaration and user-facing behavior for Android 14+.
6. Triage dependency advisories without using a blanket forced upgrade.

### Product follow-ups, not v2 blockers

- Replace the five placeholder sound identities with five distinct mastered recordings while retaining their stable IDs.
- Add component-level automated gesture/accessibility tests when the project adopts a React Native component-test harness.
- Consider a small diagnostics/export screen for support if real-world OEM scheduling behavior proves difficult to reproduce.

## 8. Why no complete DND-profile cloning exists

Android lets an app create and manage its own automatic DND rule, and newer releases let the user modify that rule. It does not expose a dependable API for reading an arbitrary currently active profile and cloning all contacts, applications, conversations, schedules, display effects, and OEM-specific exclusions into another rule.

The safe implementation is therefore:

- Create only Chandas Focus.
- Explicitly permit alarms.
- Leave all unrelated policy fields unspecified.
- Never rewrite a user-modified policy during routine refresh.
- Show only the state of the Chandas-owned rule.
- Let Android settings remain the authoritative editor.

That is what the implementation now does.

## 9. Authoritative references

- [AlarmManager API](https://developer.android.com/reference/android/app/AlarmManager)
- [Schedule exact alarms](https://developer.android.com/develop/background-work/services/alarms)
- [NotificationManager and automatic DND rules](https://developer.android.com/reference/android/app/NotificationManager)
- [ZenPolicy](https://developer.android.com/reference/android/service/notification/ZenPolicy)
- [ZenPolicy.Builder](https://developer.android.com/reference/android/service/notification/ZenPolicy.Builder)
- [Android Settings actions](https://developer.android.com/reference/android/provider/Settings)
- [AudioAttributes](https://developer.android.com/reference/android/media/AudioAttributes)
- [AudioFocusRequest](https://developer.android.com/reference/android/media/AudioFocusRequest)
- [Manage audio focus](https://developer.android.com/media/optimize/audio-focus)
- [Android Do Not Disturb behavior](https://support.google.com/android/answer/9069335?hl=en)
- [Google Play exact-alarm policy](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en)
- [Expo Modules API](https://docs.expo.dev/modules/module-api/)

## 10. On-device validation matrix

### API coverage

- API 24: pre-modern activity/result and exact-alarm compatibility.
- API 29: ZenPolicy and `setAutomaticZenRuleState`.
- API 31/32: user-granted `SCHEDULE_EXACT_ALARM`.
- API 33: `USE_EXACT_ALARM`, notification runtime permission.
- API 34: full-screen intent access.
- API 35+: user-managed automatic DND rules and actual rule-state query.
- API 37 when available: timezone-offset broadcast in addition to the transition sentinel.

### Timer/recovery scenarios

- Screen on, screen off, Doze, app background, task removed, process killed.
- Reboot and package replacement during Pattern and Sequence.
- Exact-alarm access removed, then app foregrounded.
- Stale PendingIntent injected after restart/reanchor.
- Main duration, cue volume, and Master updated rapidly.

### Civil-time scenarios

- Clock-snapped Pattern over a spring DST gap.
- Clock-snapped Pattern over an autumn DST fold.
- A non-hour timezone change.
- Manual wall-clock jump forward and backward.
- Elapsed Pattern and Sequence across the same changes.
- Same start/end active-hours window.
- Cross-midnight window with only the starting weekday selected.

### Audio/alarm scenarios

- Every built-in ID, Android alarm tone, notification tone, and document URI.
- URI permission retained after process death/reboot.
- URI removed or provider unavailable, confirming fallback and Replace.
- Master/cue/system Alarm volume multiplication.
- External DND allowing alarms and external DND blocking alarms.
- Alarm Once and Locked while unlocked, locked, notification-denied, and full-screen-intent-denied.
- Incoming/active call for normal cues and a user-armed continuous alarm.
- Audio-focus denial, transient loss/gain, and permanent loss.

### Focus scenarios

- Access absent, granted, and removed.
- Rule active, manually snoozed, resumed, disabled, re-enabled, removed, and explicitly recreated.
- Active-hours exit/re-entry.
- Android 15 user-managed editing.
- Another unrelated DND mode active, confirming Chandas does not display or mutate it.

### Interaction/accessibility scenarios

- TalkBack traversal of every sheet and alarm overlay.
- Drag-paint across cells and scroll-vs-paint distinction.
- Reorder across multiple rows plus adjustable accessibility actions.
- Rapid Start, Alarm double tap, sound-picker double tap, Stop, and slider changes.
- Reduced motion, large font, compact handset, and tablet/desktop width.
