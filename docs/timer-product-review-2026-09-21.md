# Chandas: reliability, interaction, and everyday usefulness review

Date: 2026-09-21. Source reviewed: `5eefc6edbe6961b1b473b8dce5858712d34d1437` plus local documentation reconciliation. This is a source review, not a claim of device verification. No application features were changed for this report.

The implementation specification is [Timer v2, section 26](timer-v2-spec-and-log.md#26-september-2026-interaction-and-reliability-batch). That section distinguishes requested outcomes from recommended design details and optional future work. Earlier log entries remain historical evidence.

## 1. Product assessment

Chandas already has the foundations of a useful personal rhythm tool: repeating cycles, ordered routines, clock alignment, saved configurations, active hours, bounded sessions, sound, vibration, and Android background scheduling. The highest-value next step is making those foundations understandable and dependable together.

Three everyday questions should be easy to answer: **What happens next? Why is it quiet? What will this action change?** A timer that answers them can support work, meals, movement, reflection, study, household routines, and transitions between activities without becoming a task manager.

The current batch should favor reliable editing, clear state, and predictable transitions. Additional modes, schedules per configuration, calendar automation, and statistics would create substantial new complexity before those basics are settled.

## 2. Corrections to the previous review

- The existing dual countdown is **next cue plus bounded session finish**, not next cue plus the end of the current Cycle. `TimerNotifications.kt` passes `config.timerV2EndsAt` to `TimerCountdownText.forProgram`. Continuous sessions still use an identity prefix. The requested Cycle badge therefore remains a substantive change, including for continuous runs.
- The haptic preview path chooses native playback when supported and otherwise uses Expo. It does not retry Expo when a supported native preview returns false. `playExpoProfile` also catches individual errors, after which `previewHapticProfile` returns true. A success result therefore does not prove even that the fallback request succeeded, much less that a vibration was felt.
- `reanchor` is a useful foundation, but calling it a fully atomic configuration switch was too strong. It dismisses the ringing alarm before attempting native Start, and session persistence is asynchronous. Native failure/rollback and all visible side effects need auditing before a selector relies on it.
- The two failing native tests cannot both be dismissed as stale without examining product intent. The reorder expectation contradicts D-049 and the newer stable-collision test. The closing-boundary assertion exposes a real policy question: the implementation accepts any valid scheduled cue within five seconds, even after availability closes. The earlier spec explicitly discusses avoiding late replay into quiet hours. Decide and test the boundary policy; do not merely change assertions until they pass.
- Sequence and sub-bell editors share the title component, but that does not prove the reported clipping is fixed. The keyboard, font scaling, sheet header actions, and native text padding still require visual checks.
- The specification header remained at 2.6 even though its change log reached 4.17. The current revision updates that metadata and makes planned work distinct from implemented behavior.

## 3. Source findings and priorities

“Confirmed” means visible in source. “Risk” means a plausible failure requiring reproduction or targeted testing. Severity refers to impact, not certainty.

| Priority | Finding | Evidence and consequence | Action |
| --- | --- | --- | --- |
| High, confirmed | Time entry loses the fourth digit | `schedule-config.tsx` reformats three digits as `02:20`; the five-character limit prevents completing `2200` | Store raw digits separately; share a clock input with cursor, paste, delete, and validation behavior |
| High, confirmed | False snap selection | Running screen supplies zero for elapsed alignment | Represent unsnapped as null; show only native-confirmed alignment |
| High, confirmed | Title commit depends on blur | `EditableTitle` owns its draft; sheet Done immediately closes | Commit a shared editor draft explicitly before dismissing |
| High, confirmed | Haptic failure may look successful | Fallback errors are swallowed; capability check is optimistic on native platforms | Report request failure truthfully and test the actual device route |
| High, risk | Configuration switching can alter the old alarm before acceptance | `useTimerV2.reanchor` calls `dismissAlarm` before native Start | Make replacement transactional or explicitly recover the prior session |
| High, confirmed | Schedule boundary and delivery grace disagree with a test/spec wording | `ActiveHours.allowsCueDelivery` checks scheduled-time availability, not delivery-time quiet | Set one policy in JS/Kotlin and cover all boundaries |
| Medium, confirmed | Compact status describes the wrong second deadline | `finalAt` is whole-session end | Compute current-cycle end separately; keep session end in expanded details |
| Medium, confirmed | Routine notifications precede mute filtering | `TimerScheduler` posts event notification before mute handling | Remove routine posts; retain required service/alarm notifications |
| Medium, risk | Rapid sound previews race | Picker awaits playback and later updates local state without a request-generation guard | Latest selection wins; closing invalidates pending starts and UI updates |
| Medium, confirmed | Sound preview can display active after failure | Picker can set the preview key when native is available despite `didStart` false | Track actual start/end and report failure without a false Stop icon |
| Medium, confirmed | Resume prediction cannot directly handle weekly exclusions | `nextActiveHoursStart` enumerates weekly starts, not weekly quiet ends | Evaluate both edges of all ranges and return an explicit no-resume result |
| Medium, confirmed | Availability existence check is insufficient for exclusions | `hasAvailableTime` only checks for an enabled weekly window | Validate the resolved active-minus-quiet result before starting |
| Medium, risk | Hidden controls conflict with timer-tap unmute | Running ring currently clears mute on press | Hidden-state first tap reveals only; keep unmute an explicit revealed action |
| Medium, confirmed | Duration and list affordances remain inconsistent | Nested custom picker, custom-value action, swipe-only Delete, custom drag responder | Implement the shared editor and list contracts in section 26 |

Other persistence paths should be reviewed in context. `saveTimerV2State` already returns a failure boolean and writes are queued; it would be inaccurate to say all saves fail silently. Session and some individual-record helpers still swallow errors. Trace active callers before choosing remediation. A native running timer must remain authoritative when a UI cache write fails.

## 4. Make the requested interactions work together

### Running display and controls

Tap-to-hide should leave the timer face/countdowns and remove header/footer controls. The reveal tap must never activate an invisible button or unmute the timer. Pressing a visible button should perform that button's action without also toggling the entire screen. Drags, long presses, sheets, and alarm dismissal have separate gesture ownership.

On first use, a small temporary “Tap to show controls” hint makes the behavior discoverable. TalkBack needs a named Show/Hide controls action; invisible controls must leave the accessibility tree. New sessions should begin with controls visible. A ringing alarm or critical error must escape the hidden display. An inactive schedule must still have an intelligible timer state rather than unexplained dashes.

### Editing, time entry, and custom durations

Use one clock-time component everywhere. Keep clock times and elapsed durations as distinct domain types: `22:00` is a time of day; `22m` is an amount of time. Reuse field layout, validation, keyboard treatment, and styling without imposing a 23-hour ceiling on durations.

The clock digit progression should be `2 → 22 → 2:20 → 22:00`. Do not normalize a partially typed draft on every keystroke. Accept pasted `22:00`; reject invalid `24:00`/`22:70` with a nearby message instead of silently changing them. Backspace, selection replacement, middle edits, keyboard dismissal, and hardware keyboards need explicit coverage.

The duration editor should render hours/minutes/optional seconds inline in the first sheet. Maintain exact seconds when advanced controls are hidden. A saved 90-second duration must not silently become one or two minutes. The selected custom value belongs among duration chips, automatically visible on open, with Custom kept as a separate edit action.

Done must commit title and duration drafts synchronously before closure. Valid edits should also survive normal Back/scrim dismissal, consistently with the app's existing live-edit model. Invalid drafts need an inline error and an explicit way to discard them. Do not make blur order determine whether user data survives. Title editing must accommodate large fonts and the keyboard without shrinking the title to make room for actions.

### Drag, duplicate, and delete

Use whichever established React Native drag library best supports reliable touch handling, animated insertion, nested scrolling, accessibility, and maintenance. The user authorizes dependency upgrades where needed; the existing versions must not dictate an inferior choice. `react-native-draggable-flatlist` remains a candidate, not a locked selection. Validate the chosen dependency set with a local native build and interaction checks, including any upgrade migration requirements.

The handle sits outside the shaded content. Rows animate toward the destination while dragging; release commits exactly one order change. Stable IDs preserve the edited step, sounds, and any sound cursors. Scroll and drag should not compete. Keep Move up/Move down accessibility actions and reduced-motion behavior.

Use the same Duplicate and Delete actions in Sequence and sub-bell editors. Duplicate copies content with a new identity and obeys the existing limits. Sequence duplicates go immediately after the source; sub-bells follow the existing automatic cadence sort. Delete uses a deliberate second activation with an accessible “Delete [name]?” label and Cancel. Deleting the last Sequence step must not produce an invalid empty program. A disabled action should explain the limit rather than silently fail.

### Simple cues and advanced customization

Repeat cadence is an ordinary control. Optional After start and Before end values sit beside it as additional timing choices, with an example summary: “Every 5 min · 2 min after start · 1 min before end.” Do not force people into a cue grid to express this common routine.

For a 10-minute cycle, that example produces events at 2, 5, and 9 minutes. For a 3-minute cycle, after 2 and before 1 coincide and should ring once. Offsets must remain strictly inside the main interval. Shortening the cycle should preserve now-invalid settings with a clear inactive warning so lengthening it restores intent.

Advanced cue selection edits cadence occurrences. It must not accidentally erase explicit after/start or before/end events. One-off-only tracks introduce a collision case that the current “longest cadence wins” rule does not cover. Section 26 proposes a deterministic rule; it is not an already approved product decision.

### Haptics and sounds

Treat preview as a user-requested audition: it remains available with automatic haptics disabled, but must not enable automatic output. Explain hardware/system limitations only when preview fails or support is known to be absent. A successful API request cannot establish perceptibility. Verify normal/ringer/DND settings on a real device before attributing the reported failure to one cause.

Per-cue haptics need three states: Inherit, Off, and Custom. A global haptic Off always wins for automatic playback. Sequence cues inherit the main profile, sub-bells the sub profile. UI tap feedback and scheduled cue vibration are separate routes; success in one does not validate the other.

Selecting a sound should audition it once at the effective level. Loading a saved selection or opening the picker should be silent. A new preview cancels the previous one; timer alarms take priority. A zero level should show a brief useful explanation rather than claim the speaker failed.

Confirmed by the user: ordered mode plays A, B, C on successive bells, one sound per occurrence, then repeats the list. Keep the list visible in Advanced with ordering controls. Random can use a shuffle bag to avoid streaks. Preview must not consume the runtime sequence. Losing collisions, quiet hours, mute, calls, stale callbacks, and retries must not advance it. Persist cursor/bag and event identity across restore; use fresh state after deliberate restart/configuration switch. Playback hardware cannot provide perfect exactly-once proof across a process crash, so specify deduplication of accepted playback requests, not an impossible audible guarantee.

### Schedule and runtime switching

Show weekly Active and Quiet slots with type labels, enabled switches, days and times. Sort automatically; ordering should never determine which wins. Quiet wins over active, including absolute overrides. Example: Active 04:00–22:00 and Quiet 09:00–11:00 yields 04:00–09:00 and 11:00–22:00. A bell scheduled exactly at an active-to-quiet boundary (09:00 or 22:00 in this example) plays once, as requested, before subsequent bells are gated. This applies to the end of resolved active time, including when a weekly Quiet slot cuts it short. Independent runtime mute/call gates still apply. Program phase continues during quiet time; no queued bells play at 11:00. Resuming at 11:00 is different from the next actual bell, and the UI should not confuse them.

Empty effective schedules need “No active time” instead of a fictional future resume. An enabled schedule with only Quiet slots needs an explicit All day base or a visible validation message; do not infer an unstated schedule. Bounded runs continue to ignore Schedule under the existing decision, but their setup should state that briefly because quiet exclusions make this easier to misunderstand.

The running configuration dropdown should show the saved configuration name, with current step beneath it. Unsaved sessions need a meaningful label. Hidden presets remain in the library; hiding/deleting the source never stops its running snapshot. Visibility is library metadata, so it need not violate immutable program snapshots.

Switching restarts the selected program using its configured alignment, recomputes a bounded deadline, preserves timestamp mute and global settings, and clears cycle-count mute because the old cycle no longer exists. A Sequence cannot inherit an armed Cycle-only alarm. Selecting the already active item should close the menu without restarting. The menu should disclose “Switching starts this configuration” once and retain the existing unsaved-work safeguard where switching would discard edits. Rapid selections, Stop during preparation, capability failure, and native rejection must leave one coherent authoritative session.

## 5. Robustness and verification gaps

The native engine, JS preview, configuration normalization, imports, persisted session, and notification must agree on the same timeline. Adding timing fields only to the editor would create an app that looks right and rings wrong in the background.

Required engineering work includes:

1. Shared fixtures evaluated by TS and Kotlin for deduplicated offsets, collisions, weekly exclusions, terminal events and clock alignment.
2. Capability checks for every new semantic feature. An old runtime must not silently ignore Quiet slots or round one-off cues. Block affected Start/switch with an actionable message when the installed binary cannot honor them.
3. Import/export traversal of every sound in a list, per-cue haptic override, one-off time and visibility policy. Device sound references are not portable sound files; show unresolved references and preserve configured intent.
4. A single transaction boundary for replacing native sessions and restoring UI state after rejection. Verify storage failure, exact-alarm permission loss, process death, and reboot separately.
5. Explicit precedence for terminal completion, main boundary, deduplicated sub-bells, schedule quiet, timed mute, calls and alarm mode. Changing one must not reintroduce double output.
6. Output ownership for previews versus scheduled cues. Closing a sheet must cancel only its preview, never a real alarm. An async preview prepared before closing must not start afterward.
7. Device checks for locked screen, background/Doze, large text, TalkBack, orientation, keyboard, reduced motion and touch scrolling. Emulator success cannot validate physical vibration.

Baseline evidence from the preceding update remains: TypeScript passed; 112 JS tests passed; Android debug assembly passed; native tests 44/46 passed. This documentation review did not rerun those checks or claim emulator/physical-device coverage. The two native failures remain unresolved.

## 6. Additional product ideas, ranked

These are proposals, not additions to the implementation commitment.

| Priority | Idea | Everyday value | Boundaries and cost |
| --- | --- | --- | --- |
| Next | A small “Next” preview | Show the next few real events with local times before Start; catches surprising snap/schedule settings | Derive from the actual engine, show a short list, and distinguish suppressed cues |
| Next | Clear quiet-state explanation | “Quiet until 11:00”, “Muted for 8 min”, or “No active time”; reveal next audible cue separately | Use the existing gate state; do not claim Android volume/DND is known when it is not |
| Next | Curated starter configurations | Work/rest, study, a short morning sequence, movement reminders, and meal-preparation routines | Optional examples, editable after loading, no therapeutic promises or forced onboarding |
| Next | Inherit/Off vibration supports a tactile routine | A gentle cue can support places where audio is inappropriate | Explicitly decide whether zero audio volume should still permit haptics; do not redefine existing mute implicitly |
| Later | “Add 5 minutes” and “Next step” | Accommodate an interrupted activity or a transition that finishes early | Changes deadlines and cue cursors; offer Undo, define bounded-run effects, start with elapsed Sequences only |
| Later | Explicit pause/resume for a Sequence | Useful for an interruption during cooking or a household routine | Separate from quiet/mute, which currently let phase continue; requires a new persisted timing contract |
| Later | Optional low-light timer display | A quieter bedside or room display with a keep-screen-awake choice | Respect system brightness, avoid forcing maximum wakefulness; assess battery use and screen wear |
| Later | Favorites or routine groups | Organize a growing library into Morning, Work, Evening | Start with the requested visibility toggle; only add grouping/search when the library needs it |
| Later | A local recent-session log | Helps answer “Did I finish that routine?” without scores or pressure | Opt-in retention, local by default, no streaks; distinguish completed from interrupted sessions |
| Defer | Calendar-driven routines, per-preset schedules, automatic config switching | Useful for a structured day | Conflicts, permission ownership, timezone travel and surprise starts warrant a separate design |

The most useful near-term combination is saved routines + reliable clock alignment + quiet periods + a trustworthy next-event preview. This supports ordering a day while preserving the timer's restrained character.

## 7. Delivery order and review gates

Confirmed follow-up decisions: dependency upgrades are allowed to select the best-fitting drag library; ordered sounds advance across successive bells; and a bell exactly coinciding with the end of scheduled active time must play. Remaining proposed details are priority of explicit one-off bells when colliding with cadence bells, delivery grace for earlier delayed cues, and whether one/two-digit clock drafts mean minutes when committed. These are recorded with a proposed answer so implementation can proceed coherently after resolution. None should be disguised as an already implemented or user-approved rule.

1. Resolve baseline policy/test disagreement and implement shared input/editor primitives, title saving, snap truth, sound preview cancellation and tap-to-hide gestures.
2. Replace Sequence dragging; unify duplicate/delete, limits, keyboard and accessibility behavior. Validate the native gesture interaction before broad styling work.
3. Introduce the new timing/schedule model with migration, capability gates and engine parity tests. Add the one-off cues and weekly exclusions UI only against that shared model.
4. Implement configuration replacement as a transaction, then expose the running selector and library visibility metadata.
5. Add haptic overrides and multi-sound playback state, followed by physical-device preview diagnosis and background playback checks.
6. Finalize status text and notification cleanup against the completed timing model. Update contextual Help and release documentation, build locally, then perform device acceptance before publishing.

The batch is complete when every requested outcome in section 26 has evidence, both baseline test failures are resolved for documented reasons, and remaining physical-device limitations are stated explicitly. Additional ideas above do not block completion.
