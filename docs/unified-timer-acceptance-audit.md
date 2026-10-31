# Unified timer — independent acceptance audit

Authority: `unified-timer-goal-prompt-2026-10-31.md`. This audit belongs to the parent reviewer; implementation coverage is tracked separately in Luna's coverage ledger.

## Starting evidence — 2026-10-31

The current normal application still uses `PatternProgram | SequenceProgram` (program schema 3), two working programs and a mode selector. Sequence steps have end cues but no sub-bell tracks. Both timeline implementations dispatch separate Pattern and Sequence event generators; only Pattern currently generates sub-bell events. The unified setup remains behind `EXPO_PUBLIC_SETUP_PROTOTYPE=1`. Prototype checks therefore do not prove application integration or timing parity.

Baseline rerun: all 143 existing Vitest tests passed. JDK 21 and Android SDK 36 are available; `android/gradlew.bat :chandas-timer-service:testDebugUnitTest --console=plain` passed. This is legacy runtime evidence, not schema-4 acceptance.

Independent model acceptance cases live in `src/lib/__tests__/unified-timer-acceptance.test.ts`. They check caller/source isolation, retained dormant offsets, future/malformed recovery, persistent sound references, cue-only migration and both working copies/settings snapshots. `fixtures/timer-unified-timeline.json` contains hand-computed multi-step timing vectors for the next implementation slice; the independent TS/Kotlin timing cases now pass, while production runtime integration remains unproven.

## Integration findings to carry forward

- Schema-4 cue identity includes the step and track IDs using UTF-16 length prefixes, so delimiter-containing IDs and repeated track IDs remain distinct. Natural event IDs also contain the phase anchor. Legacy restore must explicitly translate old cue cursor and iteration-mute keys or keep the old session adapter.
- The old JS session reader filters cue cursor keys to 120 characters (`storage.ts`, `sanitizeSoundState`). A valid unified cue key may exceed this with two 200-character authored IDs. The unified session reader must accept the full validated key range and test cursor preservation after restart; copying the old sanitizer would lose playback position.
- Final-step skip must compare the round boundary with the run deadline. Checking only whether the *next cue* completes the run fails when an interior sub-bell precedes the final boundary.
- String limits for step labels and sound titles must count Unicode code points like the existing `normalizeLabel`, while length-prefixed identities use UTF-16 units identically in JS and Kotlin.

## Reviewed timing-helper slice

Parent review and rerun: TypeScript check passed; 221 Vitest cases across 16 files passed; Android module compilation/unit test task passed, with 65 tests and zero failures in the XML reports. Independent TS timing acceptance includes 25 cases. Kotlin consumes the same authored timing fixture, 28 invalid-field mutations and frozen random vectors, including Unicode IDs, three rounds and a shifted phase anchor with a fixed seed. Review fixed phase-anchor identity, skipping preceding steps' track generation, bounded final-step skipping, Unicode character limits and negative-anchor run-end overflow.

`unified-timeline.ts` and `UnifiedTimerTimeline.kt` are additive pure helpers. Production scheduler/state/bridge/overlay callers still use the legacy runtime. Native capabilities still advertise schema 3. No app-wide timing or UI integration is claimed by these tests. The next slices must connect these helpers to actual scheduling/session persistence and the unified editor.

## Required proof

Native facade integration: `TimerV2Timeline` now delegates schema-4 programs to the unified helper, adapting candidates to the existing scheduler's main/sub-bell/step-alarm contracts. Four acceptance tests exercise this exact facade, including hidden collision winners, visible countdowns, step alarms, whole-round transport, clock alignment and notification context. Android compilation and all 69 unit tests passed after this change, and Luna independently reviewed the adapter. Capability negotiation remains schema 3; persisted sessions, overlay parsing and application starts still require integration before schema 4 can be advertised.

| Requirement | Required authoritative evidence | Status |
| --- | --- | --- |
| Normal application uses one coherent step model | Default entry, canonical types, store and editor wiring; browser Start journey | Pending |
| Cycle and Sequence conversion | Migration fixtures preserving all intervals, settings, sounds, tracks and source metadata | Pure adapters verified; production migration pending |
| Recovery of both legacy working programs | Explicit recovery/library destination for unselected legacy edits; idempotence tests | Both copies preserved by pure adapter; production destination pending |
| Durable migration | Versioned records, interrupted-write/retry behavior, retained legacy source and storage-error tests | Pending |
| Old running sessions | Preserve anchor/start/end/pause, next event, random seed, mute, alarm flags and sound cursors through restore | Pending |
| Per-step sub-bells execute | Matching TS/Kotlin vectors for multiple steps/rounds with cadence, selected occurrences, random gaps and independent point cues | Shared TS/Kotlin helper vectors pass; live scheduler integration pending |
| Stable identity and collision behavior | Event/cue identity fixtures including old-session iteration mute, ordered/random sound cursors, coincident cues and step transitions | Pending |
| Session transport and bounds | Pause/resume, silent previous/next, clock snap, step/round restart, exact duration and round count; exactly one terminal cue | Pending |
| Quiet hours, Focus and calls | Active-minus-Quiet windows, overnight boundaries, closing bell and late delivery; permission/call/Focus gates | Pending |
| Sounds and vibration | Shared imported library, multi-sound modes/order, cue/master levels, mute, unavailable sounds and haptic inheritance/overrides | Pending |
| Saved configurations and drafts | Save/update/save-as/rename/duplicate/delete/import/export; durable keep/discard/save switching and cancellation without lost edits | Pending |
| Draft/session separation | Editing or switching a draft cannot replace the native session without an explicit accepted runtime operation | Pending |
| Shared editing interaction | Actual main sheets and secondary editors use drag/expand/collapse, labelled horizontal actions, retained enabled fields and keyboard-safe dismissal | Pending |
| Running watchface/direct controls preserved | Running screen source review and browser/emulator journey including sub-bells inside the current step | Pending |
| Notifications and floating overlay | Visible-only countdowns; hidden-only cues stay hidden; sub-bell/current-step presentation; foreground host handoff | Pending |
| Native version compatibility | New capability/schema gates and explicit rejection on unsupported binaries, with matching validator tests | Pending |
| Presentation/accessibility | Light/dark/e-ink, compact viewport, exact seconds retained, safe areas, keyboard, accessible alternatives and reduced motion | Pending |
| Cleanup and help | Default flow is integrated; obsolete prototype/dual-mode scaffolding retired or documented as explicit legacy adapters; help/migration/release docs updated | Pending |
| Final verification | TypeScript, relevant unit suites, native Kotlin tests/build, RN Web journeys and requirement-by-requirement ledger reconciliation | Pending |

## Review rules

- A passing prototype test is evidence only for that prototype behavior. Production wiring, native scheduling and migration each need their own proof.
- Preserve relevant stable event and cue identities across restored sessions, or test an explicit transactional conversion. Matching durations alone is insufficient: iteration mute, cue delivery and sound ordering depend on identity.
- Native state remains authoritative for a running timer. Saved snapshots, editable drafts, transient mute/transport state and device-wide preferences have explicit ownership.
- Browser checks are the primary interaction surface. Native changes still require targeted compilation/tests and practical emulator checks; physical audio, long background behavior, battery and e-ink limits must be stated accurately.
- Do not mark this audit or the active goal complete while any required implementation row is pending or relies only on intent. Physical-only acceptance may remain explicitly documented where hardware is unavailable.
