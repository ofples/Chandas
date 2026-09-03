# Chandas Timer v2

## Product specification, implementation plan, and project log

| Field | Value |
| --- | --- |
| Document status | Approved direction; implementation not started |
| Product | Chandas Android interval timer |
| Scope | Timer v2 program model, advanced scheduling, audio, Focus/DND, presets, runtime controls, and help |
| Primary platform | Android |
| Specification version | 1.0 |
| Created | 2026-09-02 |
| Implementation rule | Deliver as one cohesive refactor; intermediate builds do not have to be usable |
| Build rule | Never run a local native build, Gradle task, Expo native run, prebuild, or export. Remote EAS only when explicitly requested. |

This document is the implementation authority for Timer v2. It is also an append-only project log. Product decisions are recorded with stable IDs so implementation notes, deviations, and test evidence can refer back to them without rewriting history.

---

## 1. Executive summary

Timer v2 turns Chandas from a single main/sub interval timer into a reusable program-based timer while preserving the app's quiet, minimal running experience.

Two program modes are supported:

1. **Pattern** — one repeating main interval with up to five independently configured sub-bell tracks. Each track exposes a grid of possible trigger offsets inside the main interval.
2. **Sequence** — up to twenty ordered intervals which play in sequence and repeat as a complete cycle.

Every audible cue has a stable sound selection and a relative volume. A master level scales the whole program. Timer sounds use Android's alarm audio usage. Focus is represented as the state of Chandas's own Android DND rule rather than inferred from a saved toggle.

Programs can be saved as immutable named presets. Loading a preset creates a working copy. Saving changes always creates another preset; it never edits or overwrites the source preset.

The configuration surface remains restrained: the main screen shows the current program summary and the essential Start action. Detailed track grids, sequences, sounds, mixer channels, presets, Focus status, and help live behind explicit sheets or editor routes.

---

## 2. Goals

### 2.1 Product goals

- Support sophisticated repeating interval arrangements without making the default timer intimidating.
- Make audible outcomes deterministic, including overlapping sub-bells, mute boundaries, alarms, active hours, and timezone changes.
- Let users build a personal library of timer programs without destructive preset editing.
- Make every hidden or gesture-driven control discoverable through tooltips and a complete Help surface.
- Treat Android as the source of truth for Chandas Focus state.
- Preserve all existing user configuration through a one-time schema migration.

### 2.2 Engineering goals

- Use one versioned program schema in TypeScript and an equivalent persisted model in Kotlin.
- Generalize timer math into deterministic, side-effect-free timeline engines on both sides of the native bridge.
- Keep native Android scheduling authoritative while the React Native layer renders from the same program and anchor.
- Persist enough native state to restore a running program after process death, reboot, package replacement, time changes, and timezone changes.
- Add explicit native events for timer cues, Focus state, control state, and sound-picker results.
- Cover the timeline and migration rules with lightweight TypeScript tests.

### 2.3 Non-goals

- iOS background delivery.
- Cloud sync or preset sharing.
- Editing a saved preset in place.
- Importing complete Android DND profiles or displaying unrelated DND modes.
- Playing multiple sounds simultaneously at an overlap.
- A full audio workstation: no automation curves, equalizer, pan, effects, or per-channel solo in v2.
- Pausing program phase outside active hours. Active hours gate output; they do not freeze time.
- A production audio pack. Five stable placeholder entries are sufficient until final assets are supplied.

---

## 3. Current baseline and known causes

The current app already contains most of the Android primitives required by v2:

- `AlarmManager` exact scheduling in `TimerScheduler.kt`.
- Persistent native timer configuration in `TimerStateStore.kt`.
- A local Expo module bridge in `ChandasTimerServiceModule.kt`.
- Android Focus rule ownership through `FocusModeController.kt` and `FocusConditionProviderService.kt`.
- Time, timezone, boot, and package-replacement restoration through `TimerRestoreReceiver.kt`.
- Native one-shot and repeating-alarm playback.
- A JS fallback and timestamp-derived countdown in `useTimer.ts`.

The relevant current limitations are:

- `TimerConfig` is a flat single-main/single-sub schema.
- Snapped phase is stored as an offset against Unix time, not explicitly against local wall time.
- Ordinary chimes use notification audio unless Chandas Focus is active.
- Foreground Focus refresh calls `sync()`, which writes the desired condition and can fight a manual Android override.
- Focus preference and actual rule activation are separate concepts but are represented by booleans that make the UI appear more certain than Android is.
- Running-screen flashes are inferred from countdown values jumping upward. Foreground resynchronization can therefore look like a newly fired bell.
- Iteration mute currently consumes and suppresses the main event that ends the muted iteration.
- The native scheduler can only choose between a single main event and a mathematically periodic sub event.

Timer v2 replaces these assumptions rather than layering special cases over them.

---

## 4. Locked product decisions

| ID | Decision |
| --- | --- |
| D-001 | Timer v2 is implemented as one cohesive refactor. Intermediate app states do not have to remain usable. |
| D-002 | Pattern remains the default mode and is the migration target for existing configurations. |
| D-003 | A Pattern contains one main interval and at most five sub-bell tracks. |
| D-004 | A Sequence contains 1–20 ordered steps and repeats indefinitely. |
| D-005 | Loading a Sequence does not start it. Tapping Start begins step 1 at its full duration. A restored running session resumes its persisted position. |
| D-006 | Pattern tracks and Sequence steps reorder by drag handle with haptics. Accessibility actions provide Move up and Move down. |
| D-007 | Superseded by D-028. The earlier cadence-first overlap rule is retained only for decision history. |
| D-008 | Main boundaries are not valid sub-track offsets, so a main gong never competes with a sub-bell. |
| D-009 | Saved presets are immutable snapshots. Load creates a working copy. Save As always creates a new preset. Delete is the only mutation of a saved preset. |
| D-010 | Presets contain program structure, program sounds, relative cue volumes, and Pattern snap settings. They exclude theme, active hours, Focus, master volume, runtime alarm state, mute state, and running position. |
| D-011 | Duplicate preset names are allowed. Created date/time and mode disambiguate them. |
| D-012 | Timer chimes always use Android alarm audio usage. The phone's Alarm volume remains system controlled. |
| D-013 | Master volume and cue volume are independent multipliers. Timed/global mute never destroys either value. |
| D-014 | A Mixer sheet exposes Master plus every cue channel. It does not include solo or automation. |
| D-015 | Five stable built-in sound IDs ship with placeholder assets. Android system sounds and persisted audio document URIs are also selectable. |
| D-016 | At an unavailable sound URI, Chandas uses the built-in fallback and marks the configured sound as unavailable; scheduling must not fail. |
| D-017 | Active hours use current device-local wall time and gate audio/Focus. Program phase continues silently outside active hours. No catch-up cues play. |
| D-018 | Clock-snapped Patterns realign to current local wall time after time, timezone, or DST-offset changes. Unsnapped Patterns and Sequences retain elapsed cadence. |
| D-019 | Chandas displays only its own Focus state. It does not surface unrelated DND modes. |
| D-020 | Read-only Focus refresh never republishes or reactivates a rule condition. Reconciliation is performed only for a genuine app/schedule transition. |
| D-021 | Focus uses a priority rule, explicitly permits alarms, and leaves unrelated notification policy fields unspecified/preserved. |
| D-022 | A manual Android snooze is displayed as Paused in Android and is not immediately overridden. Rule disable/deletion turns Focus automation off. |
| D-023 | Single-tapping Alarm while Off arms the next main event. Double-tapping Off or Once locks alarm behavior for every main event. Single-tapping an active state turns it Off. Double-tapping Locked turns it Off. |
| D-024 | Continuous alarm behavior is Pattern-main-only in v2. Sequence sounds are one-shot. |
| D-025 | Iteration mute suppresses events strictly inside the muted period. Its final main/cycle boundary remains audible and clears the mute. |
| D-026 | Visual flashes are driven only by actual timer-event notifications while the UI is active, never by countdown jumps. |
| D-027 | Long press is reserved for a tooltip. All controls also appear in the Help sheet. |
| D-028 | Overlapping Pattern selections are allowed and resolved entirely by track order. The highest enabled track containing that offset wins, regardless of cadence. Only the winner plays. Reordering therefore edits overlap priority directly. |
| D-029 | Existing quick-select chips and cycle/minute mute are baseline functionality and must remain available in Timer v2. Main duration keeps `10`, `15`, `30`, and custom; snap keeps `:00`, `:10`, `:15`, and custom. Mute keeps `1×`, `2×`, `3×`, and custom minutes. |
| D-030 | Pattern running uses an outer main-progress ring with inner sub-track progress rings. The center names the main countdown and only the next sub-bell. Collision-resolution explanations do not appear on the running screen. |
| D-031 | Chandas automatically suppresses its own audible cues during an active phone call. This is a transient runtime gate: it does not change Master/cue volume, consume timed mute, change alarm behavior, or replay missed cues after the call. The next eligible future cue resumes normally. |

---

## 5. Vocabulary

| Term | Meaning |
| --- | --- |
| Program | The current editable Pattern or Sequence configuration. |
| Working program | The auto-saved editable program currently shown in Config. It may have been loaded from a preset but is independent of it. |
| Preset | An immutable saved snapshot of a program. |
| Pattern cycle | One complete main interval. |
| Main boundary | The end of a Pattern cycle and beginning of the next. |
| Track | A Pattern sub-bell definition with cadence, selected offsets, sound, and volume. |
| Cadence | The minute spacing that defines the possible offsets for a Pattern track. Larger minutes mean a less frequent cadence. |
| Cue | A logical audible event. A collision can contain multiple candidate cues but produces one winning audible cue. |
| Sequence step | One duration in a Sequence. Its sound plays when that step ends. |
| Sequence cycle | One traversal of every Sequence step. |
| Anchor | The persisted reference used to locate the current cycle/step at any timestamp. |
| Snapped Pattern | A Pattern aligned to local wall-clock time using the configured minute offset. |
| Alarm Once | Repeat-until-dismissed behavior for the next Pattern main boundary only. |
| Alarm Locked | Repeat-until-dismissed behavior for every Pattern main boundary until disabled. |
| Focus automation | The user's request that Chandas activate its Android Focus rule while a running program is within active hours. |
| Focus actual state | The current state of Chandas's owned Android rule, as reported by Android. |

---

## 6. Information architecture

### 6.1 Configuration screen

The base configuration screen remains a single centered column with a fixed Start action. It shows:

1. Program header:
   - Current mode: Pattern or Sequence.
   - Optional source line: `Loaded from Morning practice`.
   - `Load` and `Save as` actions.
2. Mode selector.
3. Mode summary:
   - Pattern: main duration, legacy quick-duration chips, and a compact priority-ordered list of tracks.
   - Sequence: total cycle duration and ordered step summaries; the active step editor uses the same quick-choice pattern.
4. Mixer entry with current master percentage.
5. Snap settings for Pattern only, including the legacy `:00`, `:10`, `:15`, and custom quick choices.
6. Advanced settings containing active hours and Chandas Focus.
7. Start.

Structural track and step editing opens a focused editor. Frequently used duration and snap choices remain directly available as compact chips so Timer v2 does not add friction to existing workflows.

### 6.2 Editor surfaces

- Pattern editor: full-height route or sheet containing main cue and track rows.
- Track editor: cadence, sound, volume, and trigger grid.
- Sequence editor: reorderable step list and total cycle summary.
- Step editor: duration, label, sound, and volume.
- Preset library: grouped immutable snapshots and destructive Delete action.
- Save As sheet: name entry and read-only program summary.
- Sound library: Built in, Android sounds, and Device audio sources.
- Mixer: scrollable channel list.
- Focus details: actual Chandas rule state and Android settings actions.
- Help: complete control reference.

### 6.3 Running screen

The timer ring remains the dominant visual.

Pattern running state shows:

- Main countdown with an outer progress ring.
- One inner progress ring per enabled sub-track; ring order remains stable and follows track order.
- Only the next winning sub-cue countdown and sound/track label in text.
- No collision-resolution copy; overlap priority belongs in Pattern setup and Help.
- Existing restart/snap, alarm, Focus, and sound controls.

Sequence running state shows:

- Current step countdown.
- Step label.
- `Step n of m` and next step summary.
- Ring progress within the current step.
- Alarm control hidden because continuous alarm is Pattern-only.

The top-right Help button is always available. The bottom Start/Stop hierarchy remains unchanged.

---

## 7. Detailed interaction specifications

### 7.1 Mode selection

- Pattern and Sequence are presented as two segments, not a long picker.
- Switching mode swaps the working program to the last auto-saved working program for that mode.
- Switching does not delete either working program.
- If no working program exists for the selected mode, create its default.
- A running program cannot change mode. Stop is required first.

### 7.2 Pattern editor

The Pattern editor contains:

- Main cue row: duration, sound, and relative volume.
- Track rows: drag handle, cadence, count of selected triggers, sound name, volume, overlap count, and enabled toggle.
- Add track action disabled at five tracks.
- A compact timeline preview across one main cycle.

Track ordering is overlap priority. When two or more enabled tracks select the same offset, the highest track wins regardless of cadence. Drag reordering therefore changes both presentation order and collision behavior; the UI labels this relationship explicitly.

The main-duration control retains the existing quick choices `10`, `15`, and `30` minutes plus Custom. Track cadence and Sequence step duration editors use the same chip pattern with context-appropriate values plus Custom. Pattern snap retains `:00`, `:10`, `:15`, and Custom.

Disabling a track preserves all settings and selections but removes it from scheduling and collision calculations.

Changing the main duration:

- Retains track cadence.
- Drops selected offsets that are no longer strictly inside the main duration.
- Shows a confirmation when at least one selected offset would be removed.
- Recomputes overlap annotations.

### 7.3 Track editor and trigger grid

For main duration `M` and track cadence `C`, potential offsets are:

`C, 2C, 3C, ... kC`, where `0 < kC < M`.

The main boundary `M` is never present in the grid.

Grid controls:

- `Select all` selects every potential offset.
- `Clear` removes every selection.
- Tapping a cell toggles it.
- Dragging begins a paint session. The first newly touched cell establishes the target state; every newly entered cell receives that state.
- Re-entering a cell within the same gesture does not toggle it again.
- Disabled tracks remain editable but are visually labelled Off.

Collision display:

- A selected offset shared with another enabled track receives a small stacked/overlap mark.
- Winner cells use the accent color.
- Losing cells use an outlined accent and name the higher-priority winning track in accessible text.
- A summary above the grid states the number of overlaps and the precedence rule.

Example:

- Main: 30 minutes.
- Track A: every 2 minutes, selected at 2, 10, and 28.
- Track B: every 5 minutes, selected at 5, 10, and 25.
- Track B is ordered above Track A.
- At minute 10, Track B wins because it has higher list priority.

### 7.4 Sequence editor

- Supports 1–20 steps.
- Each row shows drag handle, ordinal, duration, label, sound, and volume.
- Add appends a default five-minute step.
- Duplicate inserts a copy immediately after its source with a new stable ID.
- Delete requires confirmation only when it would remove non-default edits; the final remaining step cannot be deleted.
- Dragging a handle lifts the row, slightly scales it, and dims its original slot.
- Haptics:
  - Medium impact on lift.
  - Selection tick when crossing a valid insertion boundary.
  - Light impact on drop.
- Accessible custom actions: Move up and Move down.

The header shows total cycle duration. Each step sound fires at the end of that step. The final step's sound marks the cycle boundary; step 1 then begins immediately.

### 7.5 Preset library

Preset records are immutable.

Save As flow:

1. Open Save As.
2. Enter a non-empty name of at most 80 Unicode characters.
3. Review mode and concise structure summary.
4. Save creates a new UUID and timestamp.
5. The working program records the new preset as its source for informational display only.

Duplicate names are permitted. The UI always displays mode, created date/time, and summary so duplicates remain distinguishable.

Load flow:

1. Open Load.
2. Browse all presets grouped by mode or filter to the current mode.
3. Tap a preset to inspect its full read-only summary.
4. Confirm Load.
5. Deep-copy it into the corresponding working program and switch mode if necessary.
6. Subsequent edits never mutate the preset.

Delete flow:

1. Open preset overflow action.
2. Confirm using the preset name and saved date.
3. Delete only the preset record.
4. If that preset is currently loaded, the working copy remains intact and its source becomes `Deleted preset` until next Save As/load.

### 7.6 Sound library

Every sound selection resolves to one of:

- Built-in sound ID.
- Android ringtone URI plus display metadata.
- Persisted document URI plus display metadata.

The Sound sheet has three sources:

1. Built in — five stable placeholder choices with preview.
2. Android sounds — launches the Android alarm/notification sound picker.
3. Device audio — launches the Android document picker filtered to `audio/*` and requests persistable read access.

Preview:

- Stops the previous preview before starting another.
- Uses alarm audio routing so preview loudness matches timer playback behavior.
- Applies master × channel relative volume.
- Never changes the system Alarm volume.

Unavailable URI behavior:

- Retain the original metadata so the user understands what disappeared.
- Mark it `Unavailable` in editors and the Mixer.
- Play the built-in fallback at runtime.
- Offer Replace; do not repeatedly launch a picker automatically.

### 7.7 Mixer

Pattern channels:

- Master.
- Main.
- One row for every track, including disabled tracks.

Sequence channels:

- Master.
- One row for every step.

Each cue row includes:

- Drag-independent cue identity/label.
- Sound name.
- Preview action.
- 0–100% relative volume slider.
- Current percentage using tabular numerals.

The Master row controls a global 0–100% scalar. It is not saved inside a preset. Setting Master to zero is a persistent master level, not a timed mute. Timed mute remains a separate runtime control and restores to the existing master level.

The running Sound & Mute control continues to expose the existing `1×`, `2×`, `3×`, and custom-minute choices. It may share a sheet with Master and channel levels, but these mute choices must not be buried behind an additional settings route or removed from the running workflow.

The system Alarm volume appears as a read-only explanatory footer, not as an app-controlled slider.

### 7.8 Alarm gesture and state machine

States:

- `off`
- `once`
- `locked`

Transitions:

| Current | Single tap | Double tap | Main alarm fires |
| --- | --- | --- | --- |
| Off | Once | Locked | No change |
| Once | Off | Locked | Off |
| Locked | Off | Off | Locked |

Implementation uses exclusive single/double gesture recognition. A single tap is committed only after the double-tap window expires, preventing a transient Once state during a double tap.

Visual state:

- Off: muted border and icon.
- Once: accent border/glow and `1` badge.
- Locked: accent-filled or stronger glow plus lock badge.

Haptics:

- Once: light/selection feedback.
- Locked: medium confirmation feedback.
- Off: soft feedback.

Long press opens the tooltip and never changes alarm state.

### 7.9 Mute behavior

Mute state is independent from volume state.

Pattern iteration mute:

- When armed for `N` iterations at time `t`, determine the next `N` Pattern main boundaries.
- Suppress every sub cue and intermediate main boundary strictly before the Nth ending boundary.
- Allow the Nth boundary to sound.
- Clear mute immediately before processing that final boundary.

Therefore, `Mute 1×` silences sub-bells until the next main gong, but the next main gong is heard.

Sequence iteration mute:

- `N×` means N complete Sequence cycles.
- Suppress step-end cues before the Nth cycle boundary.
- Allow the final step sound at the Nth cycle boundary, then clear mute.

Minute mute:

- Store an absolute end timestamp.
- Events with timestamps strictly before the end are muted.
- The first event at or after the end plays normally.

Configuration or timezone changes that invalidate a stored iteration boundary clear iteration mute and emit a control-state update; timestamp mute remains valid.

### 7.9.1 Call-aware automatic mute

- When Android reports an active call, Chandas suppresses normal one-shot cue audio immediately.
- This is separate from user mute. Master and individual cue-volume settings remain unchanged, and timed/iteration mute is neither created nor consumed.
- Missed cues are not replayed after a call. On call end, the scheduler re-evaluates from the current timestamp and resumes at the next eligible future cue.
- Continuous Alarm behavior remains governed by the user’s alarm choice and Android’s alarm/call policy; implementation must never attempt to alter call audio or device call volume.
- The running UI may show a quiet `Muted during call` status, but must not present it as a durable user setting.

### 7.10 Help and tooltips

- A `?` button appears in the running screen's top-right corner.
- It opens a scrollable Timer Controls sheet.
- Every icon control supports a long-press tooltip with label and concise behavior.
- Tooltips dismiss on tap elsewhere, another tooltip, app backgrounding, or a short timeout.
- Tooltips do not contain actions; the Help sheet contains actionable links where needed.

Help topics:

- Restart and Snap.
- Alarm Off/Once/Locked gestures.
- Focus states and Android DND access.
- Master volume, Mixer, and phone Alarm volume.
- Timed and iteration mute behavior.
- Pattern collision precedence.
- Sequence step/cycle semantics.
- Active hours and timezone behavior.

---

## 8. Data model

The following interfaces are normative shapes. Exact file separation may change, but names and semantics should remain recognizable.

```ts
type TimerMode = 'pattern' | 'sequence'

type BuiltInSoundId =
  | 'temple-gong'
  | 'clear-bell'
  | 'soft-bowl'
  | 'wood-block'
  | 'bright-chime'

type SoundRef =
  | { kind: 'builtin'; id: BuiltInSoundId }
  | {
      kind: 'android'
      uri: string
      title: string
      ringtoneType: 'alarm' | 'notification' | 'unknown'
    }
  | {
      kind: 'document'
      uri: string
      title: string
      mimeType?: string
    }

interface CueSettings {
  sound: SoundRef
  volume: number // normalized 0..1
}

interface PatternTrack extends CueSettings {
  id: string
  enabled: boolean
  cadenceMinutes: number
  selectedOffsetsMinutes: number[]
}

interface PatternProgram {
  schemaVersion: 2
  mode: 'pattern'
  mainMinutes: number
  mainCue: CueSettings
  tracks: PatternTrack[]
  alignment:
    | { kind: 'elapsed' }
    | { kind: 'local-clock'; offsetMinutes: number }
}

interface SequenceStep extends CueSettings {
  id: string
  durationMinutes: number
  label: string
}

interface SequenceProgram {
  schemaVersion: 2
  mode: 'sequence'
  steps: SequenceStep[]
}

type TimerProgram = PatternProgram | SequenceProgram

interface ProgramPreset {
  id: string
  name: string
  createdAt: number
  program: TimerProgram
}

interface WorkingProgramState {
  pattern: PatternProgram
  sequence: SequenceProgram
  selectedMode: TimerMode
  sourcePreset?: {
    id: string
    name: string
    createdAt: number
    deleted?: boolean
  }
}
```

Common/global settings remain separate:

```ts
interface AppTimerSettings {
  masterVolume: number
  notificationsEnabled: boolean
  activeHoursEnabled: boolean
  activeHoursStart: number
  activeHoursEnd: number
  activeHoursDays: number
  focusAutomationEnabled: boolean
  alarmDurationSeconds: number
}

type AlarmBehavior = 'off' | 'once' | 'locked'

interface NativeFocusState {
  policyAccess: boolean
  automationEnabled: boolean
  ruleExists: boolean
  ruleEnabled: boolean
  actual: 'inactive' | 'active' | 'unknown'
  reason:
    | 'off'
    | 'timer-stopped'
    | 'outside-active-hours'
    | 'active'
    | 'paused-by-android'
    | 'rule-disabled'
    | 'access-required'
    | 'unknown'
}
```

Validation:

- Minutes are positive integers.
- Main and step durations remain within 1–240 minutes unless a future decision changes the existing bound.
- Pattern cadence is 1 to `mainMinutes - 1`.
- Track count is 0–5.
- Sequence step count is 1–20.
- Offsets are unique within a track and satisfy `offset % cadence === 0` and `0 < offset < mainMinutes`.
- Volumes are finite and clamped to 0–1.
- Labels are trimmed and at most 60 Unicode characters.
- Preset names are trimmed, non-empty, and at most 80 Unicode characters.
- IDs are stable UUIDs and are never inferred from array index.

---

## 9. Persistence and migration

### 9.1 Proposed keys

| Key | Owner | Contents |
| --- | --- | --- |
| `chandas-working-programs-v2` | AsyncStorage | Both working programs, selected mode, informational preset source |
| `chandas-program-presets-v1` | AsyncStorage | Immutable preset array |
| `chandas-app-timer-settings-v2` | AsyncStorage | Master volume, active hours, Focus preference, notification/alarm settings |
| `chandas-session-v2` | AsyncStorage | JS-visible running-session summary |
| `chandas-native-state` | Android SharedPreferences | Authoritative restorable native running program and control state |

The implementation may use differently named keys but must keep v1 data intact until a successful v2 write completes.

### 9.2 Legacy migration

Given the existing flat configuration:

- Create a Pattern program.
- `mainMinutes = mainInterval`.
- Main sound = built-in `temple-gong`.
- Main relative volume = 1.
- If sub is enabled, create one enabled track:
  - cadence = `subInterval`.
  - selections = every valid multiple of cadence inside main.
  - sound = built-in `clear-bell`.
  - relative volume = 1.
- If sub is disabled, create the same track disabled so its settings are not lost.
- Existing `volume` becomes global `masterVolume`.
- Existing snap setting becomes Pattern alignment.
- Existing active-hours, Focus, notification, and alarm-duration values move to global settings.
- Existing continuous `alarmModeEnabled` does not become a persistent locked runtime state; default runtime alarm behavior is Off after migration.
- Create the default Sequence working program without selecting it.
- Do not create an automatic preset from legacy config.

Migration requirements:

- Idempotent.
- Parse defensively and clamp invalid values.
- Write v2 records before recording migration completion.
- Never delete the old keys during the initial Timer v2 release.
- On failure, fall back to v2 defaults and preserve old storage for diagnosis.

### 9.3 Native persistence

The Kotlin state store must persist the complete running program as a versioned JSON payload or an equivalent lossless representation. It must also persist:

- Program anchor and anchor kind.
- Selected mode.
- Next scheduled event identity and timestamp.
- Alarm behavior.
- Alarm-visible/ringing state.
- Timestamp mute or iteration-mute boundary identity.
- Focus automation state required for restoration.
- Resolved sound references and fallback IDs.

Native deserialization must reject unsupported future schema versions without crashing and clear only the invalid running session, not AsyncStorage presets.

---

## 10. Timeline and scheduling specification

### 10.1 Timeline engine output

Both TypeScript and Kotlin engines expose equivalent operations:

```ts
interface TimelineCueCandidate {
  cueId: string
  kind: 'pattern-main' | 'pattern-track' | 'sequence-step'
  sound: SoundRef
  volume: number
  cadenceMinutes?: number
  trackOrder?: number
}

interface ScheduledProgramEvent {
  at: number
  logicalId: string
  cycleIndex: number
  candidates: TimelineCueCandidate[]
  winner: TimelineCueCandidate
  collision: boolean
}

interface TimelinePosition {
  mode: TimerMode
  cycleIndex: number
  cycleProgress: number
  currentStepIndex?: number
  stepProgress?: number
  nextEvent: ScheduledProgramEvent
}
```

`logicalId` must be deterministic for the same program, anchor, cycle, and boundary. It is used to deduplicate receiver delivery and avoid replaying visual events.

### 10.2 Pattern elapsed alignment

- Start sets an epoch anchor at the moment Start is accepted.
- Cycle `n` begins at `anchor + n × mainDuration`.
- Track offsets are added to each cycle start.
- Main cue occurs at the cycle end.
- Restart Unsynced creates a new elapsed anchor at the restart moment.

### 10.3 Pattern local-clock alignment

- Treat the configured offset as a minute position in local civil time.
- Find the next local occurrence on the repeating main-duration lattice.
- Convert it to an epoch timestamp using the current system timezone rules.
- Re-evaluate after every event and after time/timezone/offset broadcasts.
- Do not represent this mode as a permanently fixed UTC phase.
- During ambiguous or skipped DST civil times, choose the first strictly future valid instant and enforce logical-event deduplication. Never emit a rapid catch-up sequence.

### 10.4 Sequence alignment

- Start anchor is the accepted Start timestamp.
- Cycle duration is the sum of step durations.
- Step-end offsets are cumulative step durations.
- The final step-end is the cycle boundary and carries only the final step's cue.
- A restored session derives current cycle and step from the persisted anchor and current time.
- There is no snap-to-clock behavior in Sequence v2.

### 10.5 Collision resolution

At a Pattern timestamp with multiple enabled track candidates:

1. Sort by current track order ascending.
2. The first candidate is the winner.
3. Preserve every candidate in the scheduled event for UI explanation and test evidence.
4. Play and notify only the winner.

The scheduler must not flatten selections in a way that loses the candidate list. Track order is the sole tie-breaker; cadence does not affect it.

### 10.6 Active-hours gate

Before scheduling or firing:

- Determine active status using current local timezone, selected day mask, and cross-midnight rules.
- If inactive, schedule `ACTIVE_START` at the next local active start.
- On `ACTIVE_START`, do not play anything. Re-evaluate program position and schedule the first future cue.
- If an event arrives after active hours closed, suppress it and schedule the next active start.
- Never replay events skipped while inactive.

### 10.7 Event delivery order

For a valid fired event:

1. Validate it matches the persisted next logical event.
2. Clear persisted next-event identity.
3. Re-evaluate active hours.
4. Resolve/advance mute state.
5. Consume Alarm Once if the event is a Pattern main boundary.
6. Post any configured notification.
7. Schedule the next event before starting playback.
8. Emit an in-process timer-event signal with timestamp, winner, collision, and whether sound was suppressed.
9. Play one-shot or start continuous alarm if allowed.

Scheduling the next event before playback prevents a slow/missing audio URI from breaking the timer.

---

## 11. Android audio architecture

### 11.1 Audio routing

- Every one-shot cue uses `AudioAttributes.USAGE_ALARM` and sonification content type.
- Continuous alarms continue to request exclusive transient audio focus and use the alarm usage.
- App relative volume is applied with `MediaPlayer.setVolume` or the chosen equivalent.
- Chandas never changes the system Alarm stream volume.

### 11.2 Sound resolver

Create a single native resolver accepting `SoundRef` and fallback built-in ID.

- Built in: resolve to `res/raw` resource descriptor.
- Android sound: open the content URI.
- Document: open through `ContentResolver` using persisted permission.
- Failure: record availability false, resolve fallback, and continue.

All players must close descriptors, release on completion/error, and protect completion callbacks from multiple invocation.

### 11.3 Built-in placeholders

Stable IDs and intended character:

| ID | Display name | Intended character | Initial asset |
| --- | --- | --- | --- |
| `temple-gong` | Temple gong | Low, sustained main boundary | Existing gong placeholder |
| `clear-bell` | Clear bell | Neutral sub cue | Existing bell placeholder |
| `soft-bowl` | Soft bowl | Gentle, rounded | Placeholder duplicate permitted |
| `wood-block` | Wood block | Short, dry marker | Placeholder duplicate permitted |
| `bright-chime` | Bright chime | Higher, distinct marker | Placeholder duplicate permitted |

The IDs must not change when production audio replaces placeholders.

---

## 12. Focus/DND architecture

### 12.1 State separation

Focus comprises three separate facts:

1. Automation preference: should Chandas request its rule during a valid running window?
2. Requested condition: does the current timer/active-hours state call for activation?
3. Actual Android rule state: is the owned rule active, inactive, disabled, missing, or unknown?

No UI may call Focus Active based solely on facts 1 or 2.

### 12.2 Rule policy

- Use `INTERRUPTION_FILTER_PRIORITY`.
- Explicitly allow alarm-category audio.
- Leave unrelated categories/effects unset when creating the policy.
- Do not replace a user-modified policy during routine activation refresh.
- For APIs that retain previous ZenPolicy when update policy is null, update only metadata that genuinely changed.
- Allow manual invocation where supported.

### 12.3 Refresh versus reconcile

Read-only refresh:

- Query access, rule existence, enabled state, and actual activation.
- Derive a UI reason.
- Emit state.
- Never publish a condition.

Reconcile:

- Runs on Start, Stop, Focus preference change, active-hours boundary, time/timezone change, and program restoration.
- Publishes only when the desired condition genuinely transitions.
- Records last requested condition.

### 12.4 Android overrides

- Rule activated manually: reflect Active when Android reports it.
- Rule deactivated/snoozed manually: reflect Paused in Android; do not republish True until the requested condition has first transitioned False and later True.
- Rule disabled: set automation preference false and emit Rule disabled.
- Rule removed: clear stored rule ID, set automation preference false, and recreate only after the user explicitly enables automation again.
- Policy access revoked: report DND access required and do not claim activation.

Only the Chandas-owned rule is presented. Other active system rules are neither named nor displayed.

### 12.5 Native event

```ts
addListener(
  'onFocusStateChanged',
  listener: (state: NativeFocusState) => void,
): EventSubscription
```

App startup and foregrounding perform the read-only query, then rely on events while mounted.

---

## 13. Native bridge surface

The existing module should evolve toward the following conceptual surface:

```ts
interface NativeRunningProgram {
  schemaVersion: 2
  program: TimerProgram
  anchor: {
    kind: 'elapsed' | 'local-clock'
    epochMs: number
  }
  settings: AppTimerSettings
}

interface NativeTimerState {
  active: boolean
  ringing: boolean
  program?: TimerProgram
  anchor?: NativeRunningProgram['anchor']
  nextEvent?: ScheduledProgramEvent
  alarmBehavior: AlarmBehavior
  controls: NativeControlState
  focus: NativeFocusState
}

start(config: NativeRunningProgram): void
update(patch: NativeProgramPatch): void
stop(): void
getState(): NativeTimerState
setAlarmBehavior(value: AlarmBehavior): void
muteForIterations(count: number): void
muteForMinutes(minutes: number): void
clearMute(): void
getFocusState(): NativeFocusState
setFocusAutomationEnabled(enabled: boolean): void
openNotificationPolicySettings(): void
pickAndroidSound(): Promise<SoundRef | null>
pickAudioDocument(): Promise<SoundRef | null>
previewSound(sound: SoundRef, volume: number): Promise<void>
stopSoundPreview(): void
```

Events:

- `onTimerEventFired`
- `onAlarmStateChanged`
- `onControlStateChanged`
- `onFocusStateChanged`
- Optional `onSoundAvailabilityChanged`

Large structured records may cross as JSON strings if Expo Record nesting becomes brittle, but validation must occur on both sides.

---

## 14. React Native architecture and file plan

Suggested new or replaced files:

```text
src/
  types/
    timer-program.ts
    native-timer.ts
  lib/
    timeline.ts
    collision-resolution.ts
    program-validation.ts
    config-migration.ts
    preset-storage.ts
    working-program-storage.ts
  hooks/
    use-timer.ts
    use-program-library.ts
    use-sound-picker.ts
  components/
    mode-selector.tsx
    program-header.tsx
    pattern-summary.tsx
    pattern-editor.tsx
    pattern-track-row.tsx
    trigger-grid.tsx
    sequence-summary.tsx
    sequence-editor.tsx
    sequence-step-row.tsx
    drag-handle.tsx
    preset-library-sheet.tsx
    save-preset-sheet.tsx
    sound-picker-sheet.tsx
    mixer-sheet.tsx
    focus-status.tsx
    timer-help-sheet.tsx
    control-tooltip.tsx
  screens/
    config-screen.tsx
    running-screen.tsx
```

Native additions/refactors:

```text
modules/chandas-timer-service/android/src/main/java/.../
  ProgramConfig.kt
  ProgramJson.kt
  ProgramTimeline.kt
  PatternTimeline.kt
  SequenceTimeline.kt
  CollisionResolver.kt
  SoundRef.kt
  TimerSoundResolver.kt
  TimerEventRegistry.kt
  FocusState.kt
```

Existing `TimerScheduler`, `TimerStateStore`, `FocusModeController`, `TimerSoundPlayer`, `TimerRestoreReceiver`, module bridge, and notifications are refactored to consume these types.

File naming in new TypeScript files should be kebab-case. Existing files can be renamed as part of the cohesive refactor if imports are updated atomically.

---

## 15. Visual and motion specification

### 15.1 Visual thesis

> A quiet instrument panel: near-black surfaces, precise mono numerals, and a single violet rhythm signal.

Retain the existing tokens:

- Background `#0b0c10`.
- Surface `#16171e`.
- Elevated surface `#1e1f28`.
- Accent `#7c6ff7`.
- Primary text `#e8e8f0`.
- Muted text `#5a5a72`.

Use cards only when the surface itself is interactive, such as a reorderable step or a preset snapshot. Ordinary sections rely on spacing and dividers.

### 15.2 Typography

- JetBrains Mono Light for timer numerals.
- JetBrains Mono Regular for compact timing metadata.
- Platform system sans-serif for labels and controls.
- Section labels remain uppercase, 11px-equivalent, and generously tracked.
- Numeric values use tabular numerals.

### 15.3 Motion

- Sheets rise with a short eased transform and fade backdrop.
- Mode content crossfades with a small vertical shift.
- Dragged rows lift 2–4px, scale approximately 1.015, and cast one restrained shadow.
- Timer cue flashes are event-driven and use the existing single/three-pulse vocabulary.
- Overlap winner changes briefly illuminate the winning grid cell after reordering.
- Respect reduced-motion settings by removing scale/translation while retaining opacity/state changes.

### 15.4 Haptics

- Drag lift: medium.
- Reorder boundary: selection.
- Drop: light.
- Alarm Once: selection/light.
- Alarm Locked: medium.
- Alarm Off: soft/light.
- Destructive preset delete confirmation: warning notification feedback after confirmation, not before.

---

## 16. Error and edge-state requirements

- Exact-alarm access unavailable: block Start and direct to Android settings as today; do not silently promise exact timing.
- Notification permission denied: continue only according to existing Android foreground/alarm constraints and show the required status; do not crash.
- DND policy access missing: timer runs, Focus reports Access required, sounds still follow the alarm stream and system policy.
- Selected sound unavailable: fallback sound plays; editor shows Replace.
- Empty preset library: explain Save As in one sentence and show no decorative empty-state art.
- Maximum tracks/steps: disable Add with an accessible explanation.
- Corrupt preset: omit it from Load, keep the raw record for diagnostic logging if practical, and do not fail the whole library.
- Program edited while running: only explicitly live-editable values—master/channel volume, mute, alarm state, Focus preference—update immediately. Structural edits require Stop.
- Time change moves an event into the past: schedule the next strictly future logical event without catch-up.
- Process starts from a stale event PendingIntent: reject it using persisted logical ID/timestamp matching.
- Equal sound URI titles: identity remains URI/ID, not display title.

---

## 17. Accessibility requirements

- Minimum 44×44 logical-point touch targets, even when visual controls are 36px circles.
- Every icon has label, state, and hint.
- Alarm labels explicitly announce Off, next main only, or every main.
- Trigger cells announce minute offset, selected state, collision state, and winner.
- Drag rows expose adjustable/move actions; reordering is never gesture-only.
- Preset summaries are readable as one logical accessibility element with separate Load/Delete actions.
- Sliders announce channel name and percentage.
- Focus status never relies on color or border alone.
- Overlap winners use text/icon in addition to accent fill.
- Help content is scrollable, focus-trapped while presented, and returns focus to the Help button on close.
- Reduced motion is honored.

---

## 18. Performance and limits

- Pattern grids may contain up to 239 cells per track. Render only the expanded track editor, not every track's complete grid on the base screen.
- Memoize collision results by program revision.
- Avoid per-frame timeline object allocation in the running UI; update display on a bounded interval or animation frame only where required for the ring.
- Do not bridge countdown updates. Bridge structural/control changes and actual events only.
- Schedule one next Android event at a time, as in the current architecture.
- Stop/release audio previews on sheet close, app background, and component unmount.
- Preset payloads are small enough for AsyncStorage; no database is required in v2.

---

## 19. Test plan

### 19.1 TypeScript unit tests

Timeline fixtures:

- Pattern 30 minutes, cadence 2, selected 2 and 28.
- Pattern collision: cadence 2 and 5 both selected at 10; cadence 5 wins.
- Equal-cadence collision changes winner after reorder.
- Disabled track does not participate.
- Main boundary is never a track offset.
- Sequence 5/25/2 produces boundaries at 5, 30, and 32 minutes and repeats.
- Restored Sequence locates the correct step and progress.
- Next event is always strictly future.

Active-hours fixtures:

- Same-day window.
- Cross-midnight window with day-mask ownership.
- Timezone change into and out of active hours.
- UTC+05:30 snapped Pattern alignment.
- DST forward gap and backward overlap do not cause catch-up storms or duplicate logical delivery.

Control fixtures:

- Pattern mute 1× permits next main boundary.
- Pattern mute 3× suppresses interior boundaries and permits final boundary.
- Sequence mute 1× permits final step/cycle boundary.
- Minute mute boundary equality plays.
- Alarm gesture transition table.

Storage fixtures:

- Valid legacy migration.
- Disabled legacy sub interval.
- Corrupt/partial legacy config.
- Migration idempotency.
- Preset load returns a deep copy.
- Save As never overwrites an existing ID.
- Deleting a loaded preset preserves working program.

### 19.2 Static verification

- `npx tsc --noEmit`.
- Lint, if a lint command is added/configured.
- Focused unit-test command.
- `git diff --check`.
- Search for lingering flat-config field assumptions.
- Validate app/plugin manifests by inspection without running prebuild.

### 19.3 Native tests to add but not run locally

- Kotlin timeline fixtures matching TypeScript fixtures.
- JSON round-trip tests.
- Collision resolver tests.
- Focus-state derivation tests by API branch.
- Sound fallback resolver tests where Android test facilities permit.

### 19.4 On-device verification required later

- Android 15+ manual Chandas rule activate, snooze, disable, delete, and access revoke.
- Older supported Android Focus behavior.
- Timezone change while running, including a half-hour timezone.
- Screen off and app process death across Pattern/Sequence cues.
- Reboot restore with built-in, ringtone URI, and document URI sounds.
- Alarm-stream volume zero and DND policies that allow/block alarms.
- Drag reorder performance and haptics.
- TalkBack trigger-grid and reorder actions.
- Full-screen continuous alarm OEM behavior.

No native build or device behavior is considered verified by TypeScript/static checks.

---

## 20. Definition of done

Timer v2 is implementation-complete when:

- Existing configuration migrates to a behaviorally equivalent Pattern.
- Pattern and Sequence editors enforce their limits and validation.
- Pattern overlaps resolve exactly per D-028 and are explained in the editor and Help, not on the running timer.
- Presets are immutable and all Save As/Load/Delete edge cases work.
- Drag reordering has handles, animation, haptics, and accessible alternatives.
- Built-in, Android, and document sound references persist and resolve with fallback.
- Mixer levels affect native playback with master × cue scaling.
- Pattern and Sequence schedules restore from native state.
- Active hours and timezone behavior match D-017/D-018.
- Focus reports Android truth and does not fight manual snoozing.
- Alarm Off/Once/Locked gestures and persistence behave exactly as specified.
- Iteration mute preserves the final boundary.
- Foregrounding without a fresh native event does not flash the timer circle.
- Help and long-press tooltips cover every running control.
- TypeScript and lightweight tests pass.
- The final handoff names all native behavior that still requires EAS/on-device verification.

---

## 21. Implementation work order

Although delivered in one go, work should proceed in dependency order:

1. Add v2 types, validation, migration, storage, and immutable preset operations.
2. Build TypeScript Pattern/Sequence timeline and collision fixtures.
3. Port the model/timeline to Kotlin and replace flat native persistence.
4. Generalize native scheduling and add actual timer-event IPC.
5. Refactor Focus into read/reconcile state paths and state events.
6. Add alarm audio routing, sound references, native pickers, preview, and fallback.
7. Replace the configuration UI with mode summaries and full editors.
8. Add drag/haptics/accessibility behavior.
9. Add preset, sound, Mixer, Focus, Help, and tooltip sheets.
10. Adapt Running for Pattern/Sequence, alarm gestures, new mute boundaries, and event-driven flash.
11. Run static/unit verification, audit the diff, and update this log.

The app does not need to run between these internal steps. The final result must be internally consistent.

---

## 22. HTML mockup mapping

The standalone prototype lives in `mockups/timer-v2/` and intentionally contains only presentation-level interactions. It demonstrates:

- Pattern configuration.
- Preset Load and Save As.
- Pattern tracks and collision grid.
- Sequence step ordering and drag handles.
- Sound library sources.
- Mixer.
- Running Pattern and Sequence states.
- Alarm Once and Locked visuals.
- Chandas Focus states.
- Help/tooltips.

It does not implement a timer, persistent storage, real drag-and-drop, Android pickers, native audio, DND, or exact alarms. Prototype navigation and sheet opening exist only to inspect the proposed flow.

---

## 23. Decision log

Do not edit old entries to reflect new conclusions. Add a superseding entry and reference the original ID.

| Date | ID | Status | Decision / rationale |
| --- | --- | --- | --- |
| 2026-09-02 | D-001–D-027 | Accepted | Initial Timer v2 decisions consolidated from product discussion. |
| 2026-09-02 | D-007 | Accepted | Allow overlaps. Larger cadence duration wins; track order resolves equal cadence. This gives deliberate precedence without simultaneous audio. |
| 2026-09-02 | D-009 | Accepted | Presets are immutable snapshots. The working copy is the only editable representation. |
| 2026-09-02 | D-014 | Accepted | Add a restrained Mixer because one master plus up to twenty cue levels otherwise becomes difficult to understand. |
| 2026-09-02 | D-019 | Accepted | Do not display unrelated Android DND modes. Chandas reports only its owned Focus rule. |
| 2026-09-02 | D-023 | Accepted | Alarm defaults to Once on single tap; double tap locks it for every Pattern main boundary. |
| 2026-09-02 | D-028 | Accepted | Track order, not cadence, determines every Pattern overlap winner. Supersedes D-007 while retaining its decision-history entry. |
| 2026-09-02 | D-029 | Accepted | Preserve legacy quick duration/snap choices and running cycle/minute mute; Timer v2 must not regress existing controls. |
| 2026-09-02 | D-030 | Accepted | Replace running collision copy with nested main/sub progress rings and show text only for the main countdown and next sub-bell. |
| 2026-09-03 | D-031 | Accepted | Automatically suppress Chandas cue playback during active calls without modifying user volume/mute state or replaying missed cues. |

### Decision-entry template

```md
| YYYY-MM-DD | D-### | Proposed / Accepted / Superseded | Decision and rationale. Supersedes D-### if applicable. |
```

---

## 24. Implementation log

This section is append-only. Every implementation session should record scope, material changes, verification, and unresolved risk.

### 2026-09-02 — Specification and mockup

**Status:** Complete.

**Scope:** Consolidate Timer v2 behavior into an implementation authority and create a standalone HTML prototype for all new flows.

**Artifacts:**

- `docs/timer-v2-spec-and-log.md`
- `mockups/timer-v2/index.html`
- `mockups/timer-v2/styles.css`
- `mockups/timer-v2/mockup.js`
- `mockups/timer-v2/README.md`

**Implementation changes:** None. Product/specification and mockup only.

**Verification:**

- `node --check mockups/timer-v2/mockup.js` completed successfully.
- `git diff --check` completed successfully.
- Static cross-reference check found 10 unique mock screens, 40 internal navigation targets, no missing screen target, and no duplicate screen ID.
- CSS delimiter check reported balanced braces.
- A browser/screenshot pass was attempted, but no connected browser surface was available in this environment. Visual behavior therefore remains to be opened and inspected manually from `mockups/timer-v2/index.html`.

**Known gaps:** The prototype cannot validate React Native gestures, Android DND, audio routing, native sound pickers, exact scheduling, device persistence, or final browser rendering on this machine.

### 2026-09-02 — Browser QA and review revisions

**Status:** Complete.

**Scope:** Inspect all ten mockup screens in the connected browser at desktop and compact mobile sizes, exercise the representative interactions, and incorporate product-review feedback without regressing existing Timer controls.

**Decisions referenced:** D-006, D-008, D-025, D-028–D-030.

**Files changed:**

- `docs/timer-v2-spec-and-log.md`
- `mockups/timer-v2/index.html`
- `mockups/timer-v2/styles.css`
- `mockups/timer-v2/mockup.js`
- `mockups/timer-v2/README.md`

**Behavior and presentation revised:**

- Restored quick main-duration, snap-offset, and Sequence-step duration choices.
- Added the existing `1×`, `2×`, `3×`, and custom-minute mute choices to the running Sound & Mute path, with explicit final-boundary behavior.
- Made Pattern track order the sole overlap-priority rule and reflected it in summaries, the trigger grid, Help, and the scheduling specification.
- Replaced the running Pattern collision note and ambiguous `Main boundary at 09:30` copy with nested main/sub progress rings and one next-sub-bell line.
- Removed unwired overflow dots from Sequence rows; drag handles remain the ordering affordance.
- Made trigger-grid cell count, Clear, Select all, and drag-paint state functional in the prototype.

**Verification:**

- Inspected every screen at a desktop viewport and at `390 × 844` mobile size.
- Re-inspected the changed Pattern, trigger-grid, Sequence, Mixer, and running Pattern surfaces at both sizes.
- Alarm prototype exercised through Off → Once → Locked → Off.
- Trigger grid exercised at 3 → 4 → 14 → 0 selected cells; the summary stayed synchronized.
- Save As dialog, navigation, sheets, filters, and quick-choice selection were exercised.
- Browser console reported no errors or warnings after the final reload.
- `node --check mockups/timer-v2/mockup.js` completed successfully.

**Known gaps:** Browser QA validates the HTML flow only. React Native row reordering/haptics, nested-ring runtime progress, scheduling, Android audio/DND behavior, persistence, and native picker flows still require implementation and device-level verification.

### 2026-09-03 — V2 domain, timeline, and migration foundation

**Status:** Complete.

**Scope:** Establish the versioned Timer v2 program model, deterministic TypeScript timeline engine, and safe AsyncStorage migration path from the existing flat timer configuration.

**Decisions referenced:** D-007 (superseded), D-008, D-009–D-013, D-028–D-031.

**Files changed:**

- `src/types.ts`
- `src/lib/timerV2.ts`
- `src/lib/timeline.ts`
- `src/lib/storage.ts`

**Behavior implemented:**

- Added V2 Pattern/Sequence, cue/sound, preset, working-program, and global-settings types.
- Added defensive normalization, bounds validation, UUID-shaped IDs, default programs, and one-way legacy migration.
- Added a pure timeline engine which retains all collision candidates and selects the highest ordered enabled Pattern track as its winner.
- Added Sequence boundary calculation, deterministic logical event IDs, progress snapshots, and V2 split-record persistence.
- Preserved every legacy storage key; migration writes the V2 records before recording completion.
- Recorded D-031 automatic call-aware audio suppression for the upcoming Android/runtime slice.

**Verification:**

- `npx tsc --noEmit` completed successfully.
- Compiled pure-domain check verified migration offsets/volume, top-track overlap priority, and Sequence next-step resolution.

**Known gaps:** The app still renders and runs against the legacy flat configuration. Runtime playback, native Kotlin parity, and V2 UI wiring are subsequent slices.

### 2026-09-03 — Runtime audio-gate semantics

**Status:** Complete.

**Scope:** Make the v2 mute, Alarm Once, and automatic-call-mute decisions pure and deterministic before integrating them into the JS and Android runtimes.

**Decisions referenced:** D-013, D-023–D-025, D-031.

**Files changed:**

- `src/lib/runtimeV2.ts`

**Behavior implemented:**

- Iteration mute persists an ending logical-event identity and epoch rather than decrementing at each main event.
- The selected ending main/cycle cue is audible and atomically clears iteration mute.
- Timestamp mute respects boundary equality: the first event at or after its end is eligible to play.
- Automatic call mute is a transient audio gate. It does not modify user volume, consume timed/iteration mute, or consume Alarm Once.
- Alarm Once is consumed only for an eligible Pattern main event outside call suppression.

**Verification:**

- `npx tsc --noEmit` completed successfully.
- Compiled pure-domain checks covered final-boundary iteration mute, timestamp mute, and call suppression preserving mute/alarm state.

**Known gaps:** The existing `useTimer` and Kotlin scheduler do not consume this engine yet. Their migration is the next runtime-integration slice.

### 2026-09-03 — Program editor operations

**Status:** Complete.

**Scope:** Add the immutable operations consumed by the V2 editor before rendering its flows.

**Files changed:**

- `src/lib/programActions.ts`

**Behavior implemented:**

- Pattern tracks support adding/removing (up to five), cadence changes, clear/select/toggle grid offsets, and deterministic reordering.
- Main-duration changes retain only valid in-range cues; normalization validates final cadence/offset relationships.
- Sequence steps support adding/removing (never zero), editing and deterministic reordering.
- Saving creates an immutable snapshot; loading copies a snapshot into working state; later edits never change the saved item; deletion only removes the saved snapshot.

**Verification:**

- `npx tsc --noEmit` completed successfully.

### 2026-09-03 — V2 JavaScript runtime and session

**Status:** Complete for the JavaScript/web fallback; Android exact-alarm parity remains a native slice.

**Files changed:**

- `src/hooks/useTimerV2.ts`
- `src/lib/storage.ts`
- `src/lib/soundLibrary.ts`

**Behavior implemented:**

- Pattern and Sequence programs run from an absolute anchor and share the same deterministic timeline as the editor.
- The fallback persists/restores the V2 program, anchor, mute boundary and alarm behavior; stopping removes only the V2 session.
- Playback volume is master × cue volume. The five built-in library identities are already persistent, with deliberately reusable bundled placeholder audio pending final sound assets.
- The alarm button is one-shot by default; a second tap within 400ms locks it on. Mute choices preserve stored volume and make the final selected cycle boundary audible.
- Active-hours resume re-evaluates only future events and never catches up skipped cues.

**Verification:**

- `npx tsc --noEmit` completed successfully.

**Known gaps:** The JS runtime cannot authoritatively observe Android call state and is foreground-only. The native exact-alarm implementation must consume the same V2 session and add call-state suppression.

### 2026-09-03 — V2 application surfaces

**Status:** Complete for the React Native UI.

**Files changed:**

- `App.tsx`
- `src/screens/TimerV2ConfigScreen.tsx`
- `src/screens/TimerV2RunningScreen.tsx`

**Behavior implemented:**

- The application now boots from V2 state, migrates legacy data automatically, restores a V2 session, and renders V2 configuration/running surfaces.
- Pattern mode exposes five ordered sub-bell tracks with quick duration/cadence choices, selected-cue grids, per-cue sound/volume controls and visible collision priority.
- Sequence mode provides a repeatable, labelled step list with cue/volume choices, durable order controls and safe add/remove behavior.
- The running screen uses nested rings for enabled Pattern tracks, surfaces only the next cue in the centre, avoids the old foreground flash heuristic, and retains cycle/time mute controls in its mixer.
- Help, immutable save/load/delete configuration flow, active-hours settings, Focus/DND controls, and one-tap/quick-double-tap alarm semantics are available in the V2 UI.

**Verification:**

- `npx tsc --noEmit` completed successfully.

**Known gaps:** Reorder controls are currently accessible move-earlier/move-later controls rather than a true continuous drag gesture; device sound selection, Android exact alarms, DND reconciliation and call-state observation are the remaining native integration slice.

### 2026-09-03 — Android V2 exact-alarm scheduler

**Status:** Implemented; requires device/native-build verification.

**Files changed:**

- `modules/chandas-timer-service/android/src/main/java/expo/modules/chandastimerservice/TimerV2Timeline.kt`
- `modules/chandas-timer-service/android/src/main/java/expo/modules/chandastimerservice/TimerScheduler.kt`
- `modules/chandas-timer-service/android/src/main/java/expo/modules/chandastimerservice/TimerStateStore.kt`
- `modules/chandas-timer-service/android/src/main/java/expo/modules/chandastimerservice/CallState.kt`
- Android module bridge/manifest and `app.json`
- `src/hooks/useTimerV2.ts`, `src/native/ChandasTimerService.ts`

**Behavior implemented:**

- Android parses the persisted V2 program and mirrors JS Pattern/Sequence event selection, including ordered-track collision precedence, cue volume and a single future exact-alarm target.
- The V2 hook uses the Android scheduler when available; JS retains the web/foreground fallback only.
- Normal Android timer cues are automatically gated during an active call when the user grants `READ_PHONE_STATE`; missed cues are not replayed and no mute/alarm state is consumed.
- Native timed mute and V2 cycle mute retain the requested logical end boundary, so that boundary is audible and clears mute. Alarm Once now also remains armed if a cue is muted.
- Local-clock Pattern anchors are recomputed in the Android restore path after boot, wall-clock and timezone broadcasts.

**Verification:**

- `npx tsc --noEmit` completed successfully after the bridge/hook changes.
- Native compilation was deliberately not run: repository policy forbids local native builds.

**Known gaps:** The Android system picker for user-owned notification/alarm/document sounds and a continuous drag reorder gesture remain to be added. V2 Android code needs a remote/device test pass before release.

### 2026-09-03 — Android device sound picker

**Status:** Implemented; requires device/native-build verification.

**Files changed:**

- `ChandasTimerServiceModule.kt`, `TimerSoundPlayer.kt`, `TimerScheduler.kt`
- `src/native/ChandasTimerService.ts`
- `src/screens/TimerV2ConfigScreen.tsx`

**Behavior implemented:**

- The per-cue sound sheet opens Android’s system ringtone picker for alarm/notification sounds.
- Selected content URIs and titles are stored in the V2 `SoundRef` and are played directly by the native one-shot player at the cue’s effective volume.
- Built-in library identities continue to map to bundled placeholder sounds until the final five distinct assets are supplied.

**Verification:**

- `npx tsc --noEmit` completed successfully.
- The native picker/playback path is static-reviewed only; local native builds are prohibited by repository policy.

### Implementation-entry template

```md
### YYYY-MM-DD — Short title

**Status:** Complete / Partial / Blocked

**Scope:**

**Decisions referenced:** D-###

**Files changed:**

**Behavior implemented:**

**Migration impact:**

**Verification run:**

**Results:**

**Native/on-device verification still required:**

**Risks or follow-ups:**
```

---

## 25. Change log

| Specification version | Date | Summary |
| --- | --- | --- |
| 1.0 | 2026-09-02 | Initial detailed specification, implementation architecture, acceptance criteria, and append-only log structure. |
