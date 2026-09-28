# Timer controls and cue timing — implementation contract

Status: implemented; Android interaction checks are recorded below.

Follow-up: `timer-state-and-performance-spec-2026-09-28.md` supersedes the clock-rejoin-on-resume and Playback-sheet interaction specified here. The remaining verified history below describes the earlier implementation.

## Shared behavior

- The running app, Android scheduler and floating overlay must describe one authoritative session. Timer controls made from any surface update that session and survive Activity recreation. Saved presets remain explicit snapshots: changing a step during a run changes the working program, not a saved preset until the user saves it.
- User confirmations use one themed modal with accessible title, message, Cancel and action buttons. Android permission and system dialogs remain native. Back and outside dismissal have the same effect as Cancel; the app must never run a deferred destructive action after dismissal.
- Cycle status shows `next bell • current cycle end` with the end in whole minutes above one minute and seconds below it. If the next bell is the cycle end, show one countdown. Sequence status keeps the current step name after its countdown. Quiet and paused states must be explicit. Android may clip promoted critical text: the full wording also belongs in the expanded notification, with on-device width inspection before finalizing the compact form.

## Alarms and transport

- A sequence step has an `alarmEnabled` setting, false for existing steps. It means the cue at that step's **end** rings as a looping alarm until dismissed, subject to the same call, mute, availability and terminal-boundary rules as cycle alarms. The running alarm control edits the current step in the working program; subsequent visits in this run use the new value. The step editor exposes the same setting. On a sequence, the control is a simple on/off state, while the cycle's existing once/locked gesture remains intact.
- Pause freezes the remaining time in the current interval/step and bounded run. It silences and unschedules future cues and alarms while retaining the working program, mute, sound order and current position. Resume shifts the session's time anchors and timed mute by the elapsed pause, reschedules once and avoids replaying a cue at the pause edge. Paused time does not consume a bounded run. A clock-aligned cycle temporarily follows the frozen remaining time on resume, then returns to its configured wall-clock rhythm at the next main boundary.
- Next/previous on a sequence changes the current step without playing either the skipped-out or entered boundary cue. Previous chooses the previous step immediately; at the beginning of the first bounded cycle it is disabled. Next from the last step advances to the next cycle, or completes a bounded run if it was the final step. Skipping while paused stays paused at the new step's full duration. The transport panel is reached from one running-screen icon; the floating watchface uses distinct buttons, with accessibility labels and the same native actions.
- Pause and skip are disabled while an alarm is ringing; dismiss it first. Notification, watchface and widget show the paused position and never present a moving countdown while paused.

## Random cues and limits

- An advanced sub-bell may combine fixed cadence with randomized delays within an inclusive user-chosen seconds range (minimum gap 5 seconds). `after start` and `before end` remain independent additions. The chosen delays form a stable realized schedule for each cycle: compute them from the session anchor, track ID and cycle index so every JS/native query and process restart sees the same cue times. Generate only interior offsets, stop before the main boundary, and deduplicate coincident cues. The setup timeline shows a representative pattern; the running watchface shows realized offsets.
- Cycle and sequence step duration are at least one second. Zero, negative and non-finite inputs remain invalid; minute-only UI may offer one-minute presets, but its custom editor can enter seconds. Native scheduling, run length, clock snap, status and persisted records must not silently round a valid sub-minute duration up to a minute.
- Sound choices have no arbitrary eight-item selection cap. If a technical limit is necessary, it must be justified by measurement and enforced consistently in UI and normalization. Keep the sortable list scrollable and preview responsive.

## Implementation notes

- The Android bridge advertises explicit capabilities for random repeats, step alarms, transport controls and larger sound lists. Older binaries reject unsupported timer programs instead of silently playing a different schedule. Installing a new native build is required for these features.
- The native paused timestamp is persisted with the session. No alarm is scheduled while paused. The notification says Paused, and the floating pill holds its frozen countdown. Resume restores Focus automation only if its schedule allows it.
- A sequence step alarm uses the configured global alarm sound and volume. A terminal bounded-run cue remains the completion cue, even when that step's alarm is enabled.
- Skipping is silent. Previous is disabled at the beginning of a bounded run. Next from its final step completes the run without sounding a skipped boundary. The skip reanchors the current step to its beginning and adjusts cycle-count deadlines; a duration deadline remains fixed.

## Manual device checks

1. Start a two-step sequence; pause near a boundary, wait past it, reopen the app, and verify the countdown has not moved. Resume and check that the step changes after the retained remaining time.
2. Skip next and previous from both the app and floating watchface. Verify the current step starts at full duration, the other surface updates, and no skipped cue sounds. Check the first and final steps of a bounded sequence.
3. Enable an alarm at a step end, dismiss it, then disable it from the running screen. Verify the next visit uses the new setting. Repeat with mute and with a completion cue.
4. Configure a random sub-bell range of 10–60 seconds. Compare several upcoming cue times and ring progress with the sound events, including after force-closing and reopening the app.
5. Save and reload a one-second interval and a cue with more than eight sound choices. Open each confirmation over its parent sheet; verify Back and scrim cancel the action.
6. On Android 16, inspect the compact status text at a sub-bell and at the final bell. Check `next • end` and the single countdown, allowing for OEM truncation.

## Verification gates

- Focused tests cover status formatting, exact boundary timestamps, pause/resume across recreation, first/last skips, per-step alarms, random schedule stability and bounds, sub-minute normalization, and sound-list persistence.
- Pass dependency/TypeScript/Vitest checks and targeted Kotlin unit/compile plus an Android APK build. Smoke-test setup, running, pause, skip, sequence alarm and overlay on an emulator. Leave OEM notification width, real e-ink refresh, alarm audibility and long background runs for documented device QA.

## Verification on the Android emulator

- `npm run release:check` passed: Expo dependency check, TypeScript and 130 Vitest tests. Native module compile and unit tests passed; `:app:assembleDebug` built and the APK installed on the API 37 emulator.
- Cycle and sequence running screens rendered. The Playback sheet paused a cycle and froze its visible countdown. The floating widget expanded over the launcher with pause on the upper arc; pausing there changed its collapsed text to `Paused • 04:07`, and returning to the app showed the same frozen time.
- The sequence step editor exposed `Alarm at step end`; enabling it showed the active running alarm control. Next and Previous in Playback moved between Prepare and Deep work, each at nearly its full configured duration. The sequence list initially raised a React missing-key LogBox; adding the rendered row key removed it on reload.
- Manual checks still needed on a physical device: actual alarm sound and dismissal, long background runs/process recovery, status-bar chip width, and e-ink refresh. Random-cue sound timing, sub-minute cue audibility and larger imported sound lists were covered by logic tests but not listened to in this emulator pass.
