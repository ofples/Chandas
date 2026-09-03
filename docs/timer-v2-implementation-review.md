# Timer v2 implementation review and completion brief

Status: implementation incomplete; remediation required before release testing  
Reviewed: 2026-09-03  
Scope: specification, HTML mockup, React Native application, Android native module, persistence, scheduling, audio, Focus/DND, accessibility, and permitted static verification

## 1. Executive assessment

Timer v2 has a useful domain foundation: its TypeScript timeline model, track-order collision rule, active-hours gate, iteration-mute semantics, immutable preset working-copy model, and one-event-at-a-time native scheduling are directionally sound. The current implementation is nevertheless not complete against `docs/timer-v2-spec-and-log.md` or the approved HTML mockup.

The largest risks are behavioral rather than cosmetic:

1. Ordinary timer cues do not consistently use Android alarm audio usage, so DND can silence them.
2. A Sequence cycle boundary can incorrectly start the continuous alarm.
3. Native and React runtime state can diverge after process death, missed events, or external Android changes.
4. Focus uses an alarm-only rule rather than the specified priority policy, and it does not reliably reflect manual Android activation, snoozing, disabling, or deletion.
5. Exact-alarm failure silently degrades to inexact delivery even though the UI promises precise timing.
6. Alarm Once is consumed without ringing in the JavaScript fallback.
7. The sound editor applies patches against stale state and can undo a preceding sound or volume change.

The UI adopts the mockup's visual vocabulary, but many approved flows are still placeholders or simplified versions: the dedicated trigger editor, drag-paint selection, true drag reordering, per-channel mixer, complete sound library, structured Focus states, progressive rings, complete preset browser, Help, long-press tooltips, custom quick choices, and accessibility behavior.

## 2. Review method and verification

The review covered:

- All specification decisions and definition-of-done clauses.
- All ten HTML mockup screens at desktop and mobile viewport sizes.
- React state, persistence, timeline, runtime gating, configuration, and running screens.
- The Expo module bridge, Android manifest and config plugin, alarm scheduler, persistence, receivers, audio players, continuous-alarm service, call-state logic, Focus condition provider, and Focus rule controller.
- Current Android documentation for exact alarms, audio attributes/focus, automatic DND rules, Android 15 user-managed modes, call-state APIs, full-screen intents, persisted document URIs, and timezone-offset broadcasts.
- Current Expo documentation for module functions/events/lifecycle, activity-result contracts, autolinking, and Continuous Native Generation.

Permitted checks completed successfully:

- `npx tsc --noEmit`
- Expo prebuild configuration resolution
- Expo local-module autolinking resolution
- Installed dependency-tree inspection

No Gradle, native compile, local Expo export, Android Studio build, or local EAS build was run, per repository policy. `expo-doctor` could not be fetched in the restricted offline command environment. There is currently no lint or unit-test script in `package.json`.

## 3. Release blockers

### R-01 — Alarm audio routing violates D-012

**Evidence**

- `FocusModeController.shouldUseAlarmAudio` returns true only when Chandas Focus is enabled and active.
- `TimerScheduler` passes that conditional result to both legacy and v2 one-shot playback.

**Impact**

Normal timer sounds can be routed as notification events and silenced by DND. This defeats the decision that bells should always use the phone's Alarm stream and that Focus is optional automation rather than a prerequisite for reliable sound.

**Required result**

- Every one-shot timer cue uses `AudioAttributes.USAGE_ALARM` and sonification content type.
- Continuous alarms use alarm usage as well.
- Chandas never changes the system Alarm volume.
- Focus controls only the Chandas-owned DND rule and has no bearing on audio routing.

### R-02 — Sequence final steps can invoke continuous Alarm

**Evidence**

- `TimerV2Timeline.nextSequence` marks the last step as `mainBoundary`.
- `TimerScheduler.handleV2Triggered` treats every `mainBoundary` as eligible for Once or Locked alarm behavior.
- The running Sequence UI displays the Alarm control.

**Impact**

Sequence mode can loop the continuous alarm at every completed set and consume Alarm Once, directly contradicting D-024.

**Required result**

- Model `patternMainBoundary` and `sequenceCycleBoundary` as different event facts.
- Alarm Once/Locked is evaluated only for a Pattern main event.
- Sequence always plays the final step's selected one-shot cue.
- Sequence UI never displays an Alarm control.

### R-03 — Native and React runtime state can enter limbo

**Evidence**

- App restoration trusts the AsyncStorage session without reconciling native `getState()`.
- Native state can remain active when the JavaScript session is missing; the reverse is also possible.
- `useTimerV2` subscribes only to alarm-state changes.
- Native mute and Alarm Once consumption are not reflected back into React state.
- Alarm visibility is not queried synchronously on v2 mount/foreground.
- Unexpected alarm-service destruction clears `ringing` but can leave `alarmVisible` stale and emits no state event.

**Impact**

The UI can show stopped while alarms continue, show stale mute/alarm controls, fail to show a ringing alarm after cold start, or claim Focus/timer state that Android no longer has.

**Required result**

- Native state is authoritative for a running Android timer.
- One versioned `NativeTimerState` contains the program, anchor, next logical event, alarm state, complete mute state, Focus state, and sound availability needed for restoration.
- Startup/foreground subscribes first, queries immediately, reconciles UI/session, and queries again if necessary to close listener races.
- Native emits `onTimerEventFired`, `onAlarmStateChanged`, `onControlStateChanged`, and `onFocusStateChanged` with typed, validated payloads.
- Alarm-service cleanup leaves persisted state and notifications internally consistent.

### R-04 — Focus/DND policy and reconciliation violate D-020–D-022

**Evidence**

- The owned rule uses `INTERRUPTION_FILTER_ALARMS`, which applies a fixed alarm-only policy, rather than `INTERRUPTION_FILTER_PRIORITY` with an alarm allowance.
- Existing rules are overwritten during routine activation.
- Read-only refresh currently performs state publication/reconciliation.
- Android automatic-rule status broadcasts are not handled.
- Pre-Android-15 `isActive` can report active based only on requested/enabled state.
- Android 15 user-managed-rule behavior and manual snooze state are not modeled.

**Impact**

Chandas may erase user policy choices, fight or misreport a manual Android override, fail to mirror activation/deactivation, or display Focus Active when it is not actually active.

**Required result**

- Keep automation preference, requested condition, and actual Android rule state separate.
- Build a priority rule that explicitly allows alarms and leaves unrelated policy/effects unset.
- Never rewrite a user-modified policy during routine refresh or activation.
- Implement a genuinely read-only Focus query.
- Handle activated, deactivated/snoozed, enabled, disabled, removed, missing, and policy-access states.
- Respect Android 15 user-managed rules and the false-then-true transition required after manual snoozing.
- Present only Chandas Focus, never unrelated DND modes.

### R-05 — Exact timing silently degrades

**Evidence**

- The scheduler uses `setAlarmClock` for every cue.
- When exact access is unavailable or throws, it silently uses `setAndAllowWhileIdle`.
- Start does not validate and surface exact-alarm capability before entering the running UI.

**Impact**

Android may deliver a cue many minutes late while Chandas continues to promise an exact interval. Frequent `setAlarmClock` use also gives every sub-bell highly visible alarm-clock semantics and unnecessary battery priority.

**Required result**

- Check exact-alarm capability before accepting Start.
- Block Start with a calm, actionable settings explanation when exact timing is unavailable.
- Use `setExactAndAllowWhileIdle` for precise timer events.
- Use `setAlarmClock` only if a genuine user-facing alarm-clock event specifically warrants it.
- Validate `USE_EXACT_ALARM` eligibility and Play policy during release preparation.

### R-06 — JavaScript fallback breaks Alarm Once

**Evidence**

`useTimerV2.playEvent` asks the gate to consume runtime state and then decides whether to start a continuous alarm from the post-consumption alarm value. Once becomes Off before the decision is made.

**Impact**

Alarm Once silently becomes a one-shot gong in web/JS fallback while still disarming itself.

**Required result**

The runtime gate returns an explicit playback disposition, including whether to start the continuous alarm, while independently returning next persisted control state.

### R-07 — Sound-sheet edits are applied against stale data

**Evidence**

The sheet captures the cue object when opened. Every sound or volume patch spreads that original object instead of the latest draft.

**Impact**

Changing sound and then volume can restore the previous sound, and the sheet can display stale selection and percentage values.

**Required result**

Use a sheet-local draft or identify the cue and resolve its current state on every update. Preview and commit must always use the latest draft.

## 4. High-priority correctness and resilience gaps

### R-08 — PendingIntent validation lacks logical identity

Only timestamp and broad event type are persisted and checked. Persist and include program generation plus logical event ID in every PendingIntent. Reject any broadcast that does not match generation, logical ID, type, and timestamp.

### R-09 — Native JSON is not a validated versioned boundary

Native parsing switches on `mode` but does not reject future schema versions or comprehensively validate program limits, duration arithmetic, selected offsets, cue references, or malformed fields. JavaScript sound normalization similarly accepts any object with a `kind` property.

Add shared invariants and mirrored validators. Unsupported/corrupt native sessions should clear only the invalid running session and retain presets.

### R-10 — Clock-snapped DST realignment is incomplete

The manifest handles manual time and timezone changes but not seasonal offset changes. API 37 provides `ACTION_TIMEZONE_OFFSET_CHANGED`; older versions need a transition-aware fallback. Schedule a silent realignment sentinel at the next timezone-rule transition where necessary, then choose the first strictly future valid civil-time occurrence and deduplicate logical events.

### R-11 — Call auto-mute fails open without a clear state

The event-time call gate correctly preserves mute and Alarm Once state, but it uses deprecated `TelephonyManager.callState`, requests permission in the timing-critical Start path, and silently disables call awareness if permission is denied.

Use the current aggregate call API where available, keep a compatible fallback, expose availability clearly, and request permission through a deliberate setup/education flow before Start. Starting the timer must not visually succeed before permission and native scheduling settle.

### R-12 — Continuous-alarm audio focus and cue fidelity need correction

The alarm service ignores the audio-focus request result and all focus-loss events. It uses exclusive transient focus even though Android identifies ordinary transient focus as the typical alarm choice. It also loops a fixed raw sound at master volume instead of the selected Pattern main sound at `master × cue` volume.

Honor the focus grant result and loss callbacks, select the appropriate transient focus mode, and pass a resolved main cue plus effective volume into the service.

### R-13 — Sound sources and fallbacks are incomplete

There is no persisted audio-document picker, preview API, availability marker, or Replace flow. Implement `ACTION_OPEN_DOCUMENT` with persisted URI permission, a single native sound resolver, preview cancellation, descriptor cleanup, fallback metadata, and a non-failing built-in fallback.

### R-14 — Settings persistence can race

UI changes trigger fire-and-forget multi-key AsyncStorage writes. Rapid slider/key changes can finish out of order and leave mixed records. Use one serialized/debounced writer with a monotonic revision or one atomic versioned state record. Keep runtime native state separate from immutable preset/configuration storage.

### R-15 — Preset provenance is stale after deletion or mode changes

Deleting the loaded source preset does not update the working copy's provenance. Changing modes can retain an unrelated source label. Preserve the working program but mark the source as deleted, or clear provenance when it no longer describes the active working copy.

## 5. Mockup and interaction completion gaps

### Pattern editor

- Restore exact baseline quick choices: main `10`, `15`, `30`, Custom; snap `:00`, `:10`, `:15`, Custom.
- Support up to five sub tracks.
- Move detailed offset editing behind the dedicated trigger editor.
- Support tap and drag-paint selection, Clear all, Select all, collision markers, and winner explanations.
- Reordering is the sole overlap priority control.
- Give every track independent sound and relative volume.

### Sequence editor

- Support 1–20 steps with clear current total duration.
- Use true drag-and-drop with a visible lifted row, stable handles, short motion, and haptic boundary feedback.
- Provide accessible Move up/Move down actions.
- Give each step independent duration, sound, volume, and preview.

### Running timer

- Pattern: outer main-progress ring plus independently progressing inner sub-track rings.
- Center: main countdown plus only the next sub-bell; no overlap explanation or redundant legend.
- Sequence: current step name/index, next step, and cycle progress; no Alarm control.
- Restore restart, snap, Focus, Alarm, mixer/mute, Help, and required baseline controls without clutter.
- Drive flashes only from a fresh native timer-event signal while the UI is active.
- Use exclusive single/double recognition for Alarm and reserve long press for its tooltip.

### Mixer and mute

- Show Master and every cue channel with preview and percentage.
- Explain effective volume as Master × cue × system Alarm volume.
- Preserve cycle mute `1×`, `2×`, `3×`, plus custom minutes.
- Keep mute state independent of all volume values.
- Clearly show active mute and allow one-action clearing.

### Presets

- Group/filter by mode and show name, mode, creation time, and concise structure.
- Load creates a working copy; Save As always creates a new snapshot.
- Confirm destructive deletion without making routine loading cumbersome.
- Keep long lists scrollable and preserve duplicate names.

### Sounds

- Present Built in, Android, and Device sources progressively.
- Provide five stable built-in IDs even while assets are placeholders.
- Preview without committing, stop preview on sheet close/change, and fall back safely.
- Mark unavailable sources and offer Replace.

### Focus and help

- Present Active, Ready, Paused in Android, Rule disabled, and DND access required states in plain language.
- Provide Edit in Android/access-settings actions only when useful.
- Add a Help button on the running screen and complete, scrollable Help content.
- Add long-press tooltips to every running control without changing the control action.

## 6. Accessibility and polish requirements

- Maintain at least 44×44 logical-point hit targets.
- Give every icon a role, state, label, and hint.
- Announce trigger offset, selection, collision, and winner.
- Give reorder rows adjustable/move accessibility actions.
- Label every mixer slider by cue and percentage.
- Trap modal focus where supported and return focus to the invoking control.
- Never rely only on color for Focus, mute, alarm, or collision state.
- Respect reduced-motion settings.
- Use Reanimated for short transform/opacity/layout transitions; avoid decorative delay.
- Use intentional haptics for selection, alarm state, and reorder boundaries.
- Keep advanced controls behind clear disclosure so the default Pattern setup remains quiet and obvious.

## 7. Target architecture

### Domain layer

Use pure, platform-independent modules for:

- Versioned program and runtime types.
- Normalization and validation.
- Timeline position and next-event calculation.
- Collision resolution.
- Active-hours and civil-time alignment.
- Runtime gating and control-state transitions.
- Preset working-copy operations.

Both JavaScript and Kotlin implementations must share fixtures that prove equivalent outputs for the same serialized inputs.

### Android runtime authority

Use one cohesive native runtime comprising:

- A versioned, lossless running-session store.
- An exact one-event scheduler with generation/logical-ID validation.
- A receiver that validates, advances controls, schedules next, emits event, then plays.
- A single sound resolver/player.
- A continuous-alarm foreground service with correct focus and cleanup.
- A Focus repository/controller separating query from reconcile.
- Broadcast/lifecycle reconciliation for boot, package replacement, time, timezone, offset, exact-alarm access, policy access, and automatic-rule status.

### Typed Expo bridge

Expose complete asynchronous mutations and synchronous/read-only snapshots where appropriate. Declare all events and remove listeners on module destruction. Use modern registered activity-result contracts for Android sound and document picking. Validate structured data on both sides of the bridge.

### React application state

- Treat saved working programs/settings/presets as configuration state.
- Treat native state as authoritative runtime state on Android.
- Derive the running UI from one reconciled runtime snapshot and native events.
- Serialize persistence writes and report recoverable failures without disrupting timer use.
- Keep sheets/editors in local draft state and commit intentional changes only.

### UI component boundaries

Prefer small, explicit components for program summary, trigger editor, reorderable list, cue editor, sound library, mixer, Focus status, timer visualization, runtime controls, Help, and tooltips. Components should accept domain values and callbacks rather than reaching into native or persistence services directly.

## 8. Required automated coverage

### Pure TypeScript tests

- Pattern and Sequence event generation.
- Track-order collision changes after every reorder.
- Local-clock/elapsed anchoring.
- DST gap and overlap fixtures.
- Active-hours day and cross-midnight behavior.
- Alarm Off/Once/Locked transition table.
- Pattern and Sequence iteration mute boundaries.
- Call and master-volume gates preserving unrelated controls.
- Normalization, future schemas, corruption, and sound fallbacks.
- Immutable preset save/load/delete/provenance behavior.

### Kotlin tests

- The same timeline fixture corpus as TypeScript.
- PendingIntent generation/logical-ID rejection.
- Persistence round trips and corrupt/future schema handling.
- Event delivery order.
- Audio disposition for Pattern/Sequence and mute/alarm combinations.
- Focus state reducer for every Android status.
- Alarm-service cleanup paths.

### Component/interaction tests

- Sound-sheet draft changes do not overwrite one another.
- Trigger tap and drag painting.
- Reorder plus accessibility alternatives.
- Alarm single/double/long-press exclusivity.
- Mode-specific running controls.
- Mixer channel updates and mute preservation.
- Preset scrolling, duplicate names, load/save/delete.
- Native foreground reconciliation without false flashes.

## 9. Device verification matrix

After static and unit checks pass, use an explicitly requested EAS development build and test on physical Android devices/API levels covering at least Android 12, 13, 14, 15, and the current target. Exercise:

- Screen on/off, app foreground/background/killed, reboot, package update.
- Doze and battery saver.
- DND off/on and different existing user policies.
- Focus manual activation, snooze, disable, deletion, and access revocation.
- Exact-alarm and full-screen-intent access states.
- Incoming, ringing, active, held, and ended calls, including a non-cellular managed call where possible.
- Alarm/notification/document sounds, revoked URI access, moved/deleted files, and long audio.
- Timezone changes, manual clock changes, DST gap/overlap, and active-hours crossings.
- TalkBack, large text, reduced motion, small screens, and landscape where supported.

## 10. Completion gate

The work is complete only when every definition-of-done item in the specification is demonstrably satisfied, all new tests pass, TypeScript and Expo static checks pass, the mockup flows are represented faithfully at phone and larger widths, no known P0/P1 review findings remain, and every item that still needs an EAS/device confirmation is listed explicitly in the handoff.

