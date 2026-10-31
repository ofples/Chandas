# Unified timer architecture and migration plan

Status: Slice 2 implementation baseline. The canonical schema and pure conversion boundary are being implemented; storage, UI, session adoption, and native scheduling remain later slices.

## Goals and constraints

The application currently has two authored program shapes (`PatternProgram` and `SequenceProgram`) and a shared running-session engine. The intended product has one or more ordered steps; each step owns its end cue, optional alarm behavior, and zero or more sub-bell tracks. The whole ordered step list is one round. This plan makes that shape canonical while preserving the current running face and its immediate controls. It does not start a timer as a side effect of editing or migrate the experimental key `chandas.experimental-unified-setup.v1` into production.

Preserve these invariants:

- TypeScript and Kotlin validate and schedule the same versioned JSON program.
- The accepted session snapshot, not the editable draft, is authoritative while running. Android native state is authoritative on Android; the persisted JS session is authoritative on web/non-native fallback.
- An editor change cannot silently change an active session. Start snapshots a draft; explicit running controls (pause, skip, snap/restart, alarm, mute) alter the session only through their existing runtime transitions.
- Sub-bells are audible independently from their watch-face visibility. Hidden-only events still participate in sound, mute, alarm, and countdown semantics as they do now.
- Existing presets, old working Pattern and Sequence copies, legacy keys, sound references, and active sessions remain recoverable until verified migration succeeds.
- A native binary must explicitly advertise support for the unified program schema and semantics before JS sends the new schema to it.

## Proposed canonical data contract

Use a tagged, self-contained `UnifiedTimerProgram` JSON object. Proposed names and field meanings below are normative for Slice 2 review; bounds and exact optionality should be shared constants/fixtures, not re-invented independently.

```ts
type CueSettings = {
  sound: SoundRef
  volume: number                 // 0..1, multiplied by app master and Android Alarm stream
  sounds?: SoundRef[]            // stable ordered cue choices; first mirrors `sound`
  soundMode?: 'single' | 'sequence' | 'random'
  hapticOverride?: 'off' | { pattern: 'single'|'double'|'triple'; strength: 'gentle'|'balanced'|'strong' }
}

type SubBellTrack = CueSettings & {
  id: string                     // stable across edit/reorder and migration
  label: string
  enabled: boolean
  color?: SubBellColorId
  showOnWatchFace: boolean       // presentation only; never gates audio
  cadenceSeconds: number
  repeatEnabled: boolean
  selectedOffsetsSeconds: number[]
  randomRepeat?: { minSeconds: number; maxSeconds: number }
  afterStartSeconds?: number
  beforeEndSeconds?: number
}

type TimerStep = {
  id: string                     // stable identity, not array position
  label: string
  durationSeconds: number        // exact integer seconds, canonical unit
  endCue: CueSettings
  endAlarmEnabled: boolean     // dismissible step-end alarm; sound/volume use global alarm settings
  subBellsEnabled: boolean       // keeps configured tracks when the layer is disabled
  subBellTracks: SubBellTrack[]  // each track is step-relative
}

type UnifiedTimerProgram = {
  schemaVersion: 4
  mode: 'unified'
  steps: TimerStep[]             // 1..20, repeat as one ordered round
  alignment: { kind: 'elapsed' } | { kind: 'local-clock'; offsetMinutes: number }
  completionCue: CueSettings | null
  runPolicy: { kind: 'continuous'|'cycles'|'duration'; cycleCount: number; durationSeconds: number }
}
```

Notes for the contract:

1. Store durations in seconds as the sole authoritative value. Existing minute fields are derived display/legacy-adapter values; normalization must not round an exact-second value. Keep the exact cue duration bound of 1–14,400 seconds per step/cadence, with up to 20 steps.
2. Keep all four sub-bell sources independent and composable: selected cadence occurrences (only while `repeatEnabled`), deterministic random gaps, one after-start offset, and one before-end offset. Preserve authored selected/point offsets during normalization even if a step is shortened; schedule generation alone filters nonpositive and `>= step.durationSeconds` offsets. Form a set union, remove duplicate times per track, and sort ascending. Each resulting offset is a candidate; coincidences across tracks form one event with all candidates preserved.
3. At one step-relative instant, preserve current precedence: the step-end cue/alarm owns its boundary (end offsets are excluded, so this is defensive); among sub-bells, largest configured cadence wins, then original configured track order. Cadence priority is zero only when `repeatEnabled === false`; a random or point cue on a track that also repeats retains that track's cadence priority. Retain every candidate's metadata for visibility/haptics arbitration, but dispatch exactly one winning audible cue. Completion at terminal instant replaces the natural boundary only when an explicit completion cue exists; otherwise the natural event completes the run. A terminal instant between events emits a synthetic completion candidate using the existing fallback rule.
4. Whole-round alignment applies to the sum of every step, never to an individual step. Determine the active step from the session's round anchor and cumulative durations; derive that step's relative event offsets from the resulting step-start instant, while preserving the same deterministic round/seed inputs across restore. Scan the active step only per display tick, rather than materializing all tracks for every step. Preserve `effectiveAvailabilityForProgram` as the schedule resolver, including its current bounded-run behavior; do not broaden Active/Quiet behavior while changing the program shape. The schedule gates audible/Focus effects while phase progresses; skipped events are not replayed. `endAlarmEnabled` is a persisted step preference for a dismissible step-end alarm; the alarm uses global alarm settings. Alarm Once/Locked remains consumable live-session state and retains its current one-step behavior. Do not extend that override to all multi-step boundaries without a later explicit runtime decision.
5. Capability metadata should be separate from product JSON and match the existing `getCapabilities()` naming: `contractVersion`, `programSchemaMin`, `programSchemaMax`, plus `supportsUnifiedSteps`, `supportsStepSubBells`, exact-seconds, random parity, and active-session-reconciliation support. Do not infer support from a package version. Alarm Once/Locked are consumable live-session state, not per-step persisted preferences; `endAlarmEnabled` represents only the authored step-end alarm. Preserve `PatternProgram.labelIsCustom` when converting a Pattern.

### State and persistence contracts

Propose production `TimerV3State` (storage envelope schema 3) with distinct saved snapshots and drafts:

```ts
type SavedTimerConfig = {
  id: string; name: string; createdAt: number; updatedAt: number
  program: UnifiedTimerProgram
  settings: AppTimerSettings
  showInRunningSelector: boolean
}
type TimerDraft = {
  id: string                    // stable config ID, or reserved `draft:unnamed`
  baseConfigId?: string         // null for unnamed/new draft
  name: string
  program: UnifiedTimerProgram
  settings: AppTimerSettings
  updatedAt: number
  dirty: boolean                // derived by snapshot comparison where possible
}
type TimerV3State = {
  schemaVersion: 3
  selectedConfigId: string | null
  configs: SavedTimerConfig[]
  drafts: Record<string, TimerDraft>
  legacyRecoveries: Array<{ id: string; sourceMode: 'pattern'|'sequence'; draft: TimerDraft }>
  devicePreferences: { theme: string; accent: string; ... }
  soundLibrary: SoundRef[]      // shared device-local library, union from all references/imports
}
```

Preserve the current `ProgramPreset.settings` snapshot semantics exactly: each saved configuration captures its timer settings, including availability, haptics, alarm, volume, notification/countdown, Focus preference and call-mute preferences. The working draft carries the settings copy edited with that configuration; Save updates both program and captured settings. Do not maintain a second competing global copy of these timer settings. Theme/accent/e-ink, overlay appearance, and device/native capabilities remain app/device preferences as they are today. Running config selector visibility is card metadata. Imported sounds remain one shared library and importing a sound never edits the current draft.

Persist each saved snapshot and its draft separately (or in one versioned envelope with a recoverable write protocol). A draft is initialized from its saved snapshot on selection. Save atomically replaces the selected snapshot and marks that draft clean. Save as copies the current draft into a new saved card without destroying the prior config's draft; selection and draft creation follow the explicit switch policy. Duplicate creates a new card from the selected saved snapshot and must not activate it behind the user's back. For a dirty switch, `Save & switch` persists then moves; `Keep draft & switch` durably keeps the outgoing draft; `Discard & switch` deletes/reset only the outgoing draft; Cancel/dismiss changes nothing. Returning to a kept draft restores it. Preserve unnamed drafts across process restart.

Use an ordered write queue or single serialized envelope transaction. Bootstrap reads and validates all relevant records before accepting edits or writing defaults. Write new records, verify write result, then write migration marker. Do not mark migration complete if any authoritative record fails. Retain legacy keys as read-only recovery data through at least one release/migration window. On malformed or future-version records, surface recoverable state and preserve bytes; do not silently reset over them.

### Authoritative live session

Implemented as `UnifiedTimerSession` in `src/lib/unified-session.ts` (session schema 3): `sessionId`, `schemaVersion`, frozen `UnifiedTimerProgram`, frozen effective `AppTimerSettings`, phase/anchor, `startedAt`, `pausedAt`, fixed `endsAt` when duration bounded, random seed/algorithm version, alarm state and dismissal state, mute-until and mute-through logical boundary/count, sound sequence cursors/random-previous keyed by stable cue ID, native generation, and optional source saved-config identity. Keep session persistence separate from `TimerV3State` and saved drafts. Persist before acknowledging structural state changes; serialize save/clear so Stop cannot be overtaken.

Unified event identity includes the phase anchor, round, stable step identity and step-relative boundary/offset. Cue identities use UTF-16 length-prefixed step/track IDs, identically in TypeScript and Kotlin, so repeated track IDs in different steps remain independent. Session identity and native generation are separate reconciliation fields. Track order never becomes cue identity. Existing legacy sessions retain their original Pattern/Sequence adapter and logical/cursor keys until stopped, rather than attempting a potentially ambiguous automatic rewrite. The old-session reader preserves accepted track order and cue lists, seed, pause, mute and long playback keys; its tests compare the next event as well as persisted state. Malformed/future sessions remain protected for recovery.

For Pattern migration, map the old `main` cue to one step's end cue and each PatternTrack to that step. For Sequence migration, map each old step cue and `alarmEnabled` to one unified step; attach no tracks. To preserve IDs for migrated events, derive deterministic IDs for generated unified steps/tracks from old identities and namespace, and persist the mapping in the upgraded session envelope. New user-created IDs use stable generated values.

## Migration and rollout sequence

1. **Inventory and fixture baseline.** Capture representative V1 flat config, V2 working Pattern and Sequence (including unsaved copies for both modes), each preset and its settings, imported sound references, legacy session, V2 session, native active state, alarms, mute and sound cursors. Tests assert deep preserved values and native/TS schedule parity. Record raw fixtures as test data only; never read live device data.
2. **Pure adapters first.** Add total, idempotent `legacy -> v2 -> unified` adapters and inverse export/legacy read adapters only where a downgrade/export contract requires them. Convert the selected legacy working copy into the selected unified draft and store the other mode's converted copy in explicit recoverable `legacyRecoveries` until the user opens it as a new configuration; never overwrite either old payload. Keep ids and order, avoid rebuilding random seeds, and union sound library. Running Pattern -> one unified step; Sequence -> ordered unified steps. Translate V1 flat config using the existing `migrateLegacyConfig` result as the compatibility semantics, then map that Pattern/Sequence to the new shape.
3. **Write new production records safely.** Use a new disjoint key namespace such as `chandas-timer-unified-state-v3` and `chandas-timer-unified-session-v3`; never reuse `setup-prototype-*`. Bootstrap old records plus new records, validate with schema version, write and read-back the new envelope, then set a versioned migration marker. Keep old V2 and V1 data untouched and exportable until migration verification and rollback window pass. Re-run after interruption; if the new envelope validates, it wins and no conversion repeats.
4. **Capability gated binary rollout.** Increase `NativeTimerContract.CONTRACT_VERSION` and `PROGRAM_SCHEMA_MAX` only together with Kotlin unified validation/scheduling. Keep the native parser able to accept legacy schema 2/3 while existing sessions can still be active. New JS queries capabilities; if native cannot accept schema 4, it must not send schema 4 or claim native scheduling. Recommended behavior: keep an existing native schema-2/3 run attached and expose only compatible running actions; block starting a new unified session with a clear “update app to run this timer” message rather than falling back to JS timing that competes with native. For a current installed binary that reports no capability API, treat it as legacy. Do not clear a native session merely because JS does not understand its new schema.
5. **Retain accepted legacy sessions.** Existing schema-2/3 JS/native sessions stay on the original runtime adapter until explicitly stopped. A matching native generation is authoritative for timing and transport while JS is away. Unknown native active programs are never stopped/cleared merely because the new JS cannot read them; incomplete legacy records surface recovery. New explicit starts use the canonical frozen session record and capability-gated engine. No automatic legacy event-ID conversion is performed.
6. **Cut over editor/configuration, then runtime surfaces.** Land unified model and bridge parity first; adapt new setup/editor and saved/draft state second; adapt JS/native scheduler and restored session third; then add per-step sub-bell, alarm and notification/overlay presentation. Keep `TimerV2RunningScreen` and its ring/direct-control layout as primary visual source, changing adapters/data inputs only. Remove mode-specific config duplication only after tests/browser walkthroughs prove parity.
7. **Retain rollback path.** Before removing V2 code/keys, document a rollback that can read unified records or leave them intact while the app returns to old schema. Downgrade must never treat one generated unified step as a real Pattern if it contains unsupported semantics. Preserve one-way migration copies until a later explicit cleanup slice and user-data safety review.

## Production integration map and file ownership proposal

| Area | Existing files | Planned responsibility |
|---|---|---|
| Domain and validation | `src/types.ts`, `src/lib/unified-timer.ts`, `src/lib/timerV2.ts` | Schema 4 canonical types, validation, pure normalizers, limits and legacy adapters. Old program types remain only for import and accepted legacy sessions. |
| Timeline and runtime | `src/lib/unified-timeline.ts`, `src/lib/timeline.ts`, `src/lib/runtimeV2.ts`, `src/hooks/useTimerV2.ts` | Unified step boundary generation, sub-bell candidates, whole-round progress/skip, semantic IDs, alarm/mute/cue-state continuity. Maintain JS/native parity. |
| Persistence | `src/lib/unified-storage.ts`, `src/lib/unified-session.ts`, app hydration in `App.tsx` | Versioned state/session records and idempotent migration; preserve separate draft/snapshot/session; never read the retired prototype key. |
| Native bridge | `modules/chandas-timer-service/src/*`, `NativeTimerServiceModule.kt`, `NativeTimerContract.kt` | Typed capability surface and schema negotiation; compatibility must be explicit. |
| Native scheduler/state | `TimerV2Timeline.kt`, `TimerStateStore.kt`, `TimerScheduler.kt`, receivers, notification/display adapters | Match TS step-relative events, deterministic random, semantic IDs, alarm/mute persistence, active-session upgrades. Existing AlarmManager, Focus, notification, audio ownership stays native. |
| Setup surface | `src/screens/UnifiedTimerConfigScreen.tsx`, `src/components/timer-v2/*`, config/preset/sound sheets | Production editor provides unified step editing, durable configuration drafts and horizontal labelled capability row; reuses DurationSelector, ClockSnapSelector, Toggle, SoundPickerSheet, ScheduleConfig, haptics, theme and icons. |
| Running face | `src/screens/TimerV2RunningScreen.tsx`, `src/components/timer-v2/*`, floating overlay | Preserve watchface and direct controls; adapt next cue, step label/rings, previous/next, end alarm, mixer and external-panel handoff. |
| App flow and permissions | `App.tsx`, `src/lib/permissions*`, native module | Hydration/capability gates and session reconciliation only. Do not create an alternate timer start path. |
| Retired experiment | Historical `src/experimental/` prototype and launcher | Scaffold, launcher and root-entry flag are removed after production acceptance. The isolated historical storage key remains untouched and is never imported. |
| Documentation/tests | `docs/*`, `src/lib/__tests__/*`, module `src/test/*` | Unified setup guide, migration/runbook and coverage ledger describe current behavior; paired TS/Kotlin fixtures verify semantic rules and parity boundaries. |

## Verification plan for implementation slices

- Pure TypeScript: schema validation/bounds; adapters for V1/V2 and idempotence; unknown/future records preserved; draft Save/Save as/Keep/Discard/Cancel and restart restoration; shared sound library across configs; list reorder keeps IDs; exact-duration totals.
- Timeline fixture table mirrored in Kotlin: each sub-bell source alone and in combinations; selected cadence disabled; repeated cadence; after/before/cadence/random coincidences; offsets at 0, at duration, and end; multiple tracks with precedence/tie order; hidden track audible but absent from presentation; disabled layer retains configuration; per-step reset of offsets; full round cycle and exact terminal collision/replacement.
- Random parity: fixed algorithm/version, seed, round index, stable track ID, range bounds, no infinite loop, schedule same after pause/resume/process death and in TS/Kotlin. Include vectors in one shared JSON fixture consumed on both sides.
- Session tests: pause/restore, accepted Start timestamp vs snapped anchor, fixed duration end across wall-clock change, legacy logical-ID conversion, mute by time and iteration, alarm once/locked and dismissal, sound sequence/random cursor continuity, stop racing write, native generation reconciliation, invalid/unsupported native schema.
- Android/native: validate schema 4 and reject malformed arrays/ranges/unknown unsupported versions; old schema active run remains intact; capability response correct; compile Kotlin unit tests; local Android build/emulator event trace for step-relative cues, alarms, notifications, Focus and call mute. Physical audio/background/e-ink cases remain a separate acceptance gate.
- React Native Web: complete journeys for single and multiple steps, every enabled capability retained while other chips are opened, configuration dirty-switch choices, rename/duplicate/import/export/delete, preserved draft after relaunch, horizontal chip scroll, keyboard-safe duration/custom editor, sheet snap/dismiss, themes/e-ink/reduced motion/accessibility, running visual/direct control regression. Web evidence does not establish native audio/background/permission correctness.

## Unresolved decisions, defaults and risks

| Decision | Suggested default | Risk / resolution needed |
|---|---|---|
| Alarm Once/Locked on a multi-step program | Preserve current runtime behavior for a one-step former Pattern; do not apply the consumable override to multiple step ends by default. Persisted per-step alarm is a boolean `endAlarmEnabled` using global alarm sound/level. | Existing Alarm Once/Locked is Pattern-main-only. Decide any multi-step extension only as a later explicit runtime change. |
| Run-policy cycle meaning after unifying Pattern and Sequence | Count full ordered rounds for every program, including a one-step former Pattern. | Existing Pattern count boundaries and Sequence cycle boundaries differ in naming but both count a full cycle; preserve their exact terminal timestamp. |
| Completion cue fallback | Preserve present: explicit terminal cue replaces colliding event; absent terminal cue lets natural cue complete, or uses last/main cue at a synthetic terminal. | Confirm whether fallback should remain audible if all selected cue sounds are unavailable. |
| Unsupported native schema during old-binary OTA | Leave native run untouched, display detected legacy capability, allow stop/recovery, prevent a new unified run. | JS cannot safely schedule a second authoritative clock. Native capability getter must tolerate older module exports. |
| Saved setting scope | Preserve full captured timer settings per saved config, including notification/countdown/call-mute preferences; keep theme/accent/e-ink/overlay appearance/device capabilities global. | Current settings appear both at working-state level and in each preset. Editor must visibly load/save the selected card's snapshot. |
| Legacy active sessions across schema cutover | Upgrade only with a capable native runtime and exact event/identity mapping; otherwise finish under the legacy schema. | Dropping IDs could cause duplicate alarms/cues or erase mute commitments. Test before rollout. |
| Sub-bell limit per each of 20 steps | Preserve current max 5 tracks per step and 20 steps unless coordinated native payload/size review supports change. | Aggregate candidate load can rise 20x relative to a single Pattern. Validate worst-case payload and scheduler scan cost. |
| Legacy migration cleanup | Retain old raw records indefinitely during first rollout; cleanup is a separately reviewed future task. | Storage growth is preferable to destructive/irreversible loss during a major schema change. |

