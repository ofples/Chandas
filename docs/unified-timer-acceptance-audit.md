# Unified timer — independent acceptance audit

Authority: `unified-timer-goal-prompt-2026-10-31.md`. Parent review is independent of Luna's implementation coverage ledger. Evidence below concerns the actual normal application, not the former experimental entry.

## November 1 UI review revision

The user rejected the prior presentation despite its functional checks. [The November 1 interaction revision](timer-setup-interaction-2026-11-01.md) supersedes the previous setup layout and visible sheet-toolbar requirements. The scheduler and accepted-session ownership are unchanged.

The revised actual app uses a direct working timer, duration-based/inline configuration name, original main-duration presets and sound disclosure, contextual horizontal controls, three-dot broad settings, compact draggable step cards and layered step/bell editors. Generic visible Done/Expand/Collapse controls were removed; backdrop, drag and accessibility/native dismissal remain. Defaults, cue overrides and library-only auditions are kept distinct.

Current local check: Expo compatibility and TypeScript pass; 289 tests across 24 files pass. New tests cover durable unsaved startup, automatic/custom naming metadata, V1 working-copy migration, and all-selected/custom cadence changes without losing dormant points. No native scheduler changes were made in this revision. Browser artifacts are under the earlier artifact directory's `2026-11-01-redesign/` folder:

| Journey | Result |
| --- | --- |
| `core.json` | 7 checks: direct unsaved timer; automatic/custom name; sound selection/backdrop; retained run/clock values; step cards and editor; drag/reload. |
| `nested.json` | 6 checks: inline bell editing/cadence; repeat-off retention; combined timing modes; sound → bell → list → main; library auditions isolated; explicit first Save and reload. |
| `drag.json`, `edges.json` | 4 + 4 checks: non-overlapping whole-card drag; persisted order; three-step insertion; local haptic feedback; name buffering; drag dismissal; multi → single transition. |
| `lifecycle.json` | 6 checks: current-draft Save as; Save/Keep/Discard/Cancel; separate named drafts; rename/duplicate/delete; visibility/import/export; all broad setting destinations. |
| `runtime.json` | 3 checks: actual Start/pause/resume; both steps' timed interior/end cues and single completion; compact viewport and light/e-ink controls. |

Parent review inspected phone screenshots of the main page, cards, drag, step modal, bell modal, sub-bell list and settings. It fixed missing Save as, incorrect fixed-row geometry and white Sortable background, endpoint swapping instead of insertion, redundant bell naming/controls, misleading disabled-layer markers, cadence edits that left stale repeat points, name-transition edges and cue/default feedback. Browser audio evidence remains play-call instrumentation, not physical speaker/vibration acceptance. Device acceptance limits below still apply.

## October 31 implementation and review

The normal App bootstraps schema-3 configuration storage and edits schema-4 unified programs. A timer has ordered steps with full sub-bells and whole-round repetition. A frozen accepted run is separate from saved configurations and durable drafts. Existing legacy runtime adapters remain only for old accepted sessions; configuration migration does not rewrite an active session's cue identity.

Reviewed slices: strict canonical model, recoverable legacy conversion, shared TS/Kotlin timing fixtures, durable configuration commands/storage, production editor/shared draggable sheet, JS/native scheduler facades, native contract 14/capability negotiation, accepted-session persistence, App/runtime/overlay integration. The parent independently checked source and ran focused/full checks and browser journeys.

Review fixes included UTF-16 cue namespace parity; Unicode label limits; dormant offsets; random-seed stability; final-step skips and following-step labels independent of intervening bells; one-step alarm gates; hidden-cue presentation independent of audibility; race-safe draft persistence; failed Save & switch; active-session source metadata; native-authoritative restore; protected future records; long playback cursor keys; preserving accepted legacy track order/cue lists; and confirmation stacking above the picker. Browser audio testing found and fixed ExpoAudio's unhandled expected AbortError when replacing pending web playback.

## Current evidence

Final `npm run release:check` passes: Expo dependency compatibility, TypeScript, and 285 tests across 23 files. Eight prototype tests were removed with the retired scaffold; production acceptance tests remain. Focused tests cover strict malformed schemas, hand-computed TS/Kotlin timing vectors, deterministic random sequences across rounds/anchors and Unicode IDs, migration/retry/write races, every draft transition, future-record protection, capability gates and session identity/cursor preservation. After dependency alignment and Android prebuild, the native module suite passed 72 tests with zero failures/errors/skips and the x86_64 debug APK built successfully. Production web export and Android Hermes export both pass. Final browser journeys were rerun against the updated normal entry.

Browser evidence uses the normal React Native Web App at localhost:8092 in fresh isolated Edge contexts, synthetic storage/audio instrumentation and no user clipboard or live device data. Artifacts are outside the repository at `C:/Users/pless/.codex/visualizations/2026/09/29/01a0eca8-b56d-76e3-a15a-15e81cdf6272`:

| Actual browser journey | Result artifact |
| --- | --- |
| Cancel/Keep/reload, Save/update, single-to-multistep, dismiss/reopen, actual Start/interior cue, pause/resume, previous/next, Stop, saved/draft/run separation | `unified-app-journey.json` — 9 flows pass |
| Injected quota failure on Save & switch; two steps/two rounds; independently ordered sounds for same authored track ID; exactly one terminal cue; session clear and saved snapshot unchanged | `unified-app-failure-audio.json` — 5 flows pass; exact 8 expected play calls, no page errors |
| Injected slow storage with rapid name/duration/alarm edits | `check-unified-rapid-edits.cjs` — pass after race correction |
| Drag partial/full/dismiss, pinned header, horizontal rail, simultaneous enabled fields/reload, 320px width, light/e-ink | `unified-app-layout.json` — 6 flows pass; screenshots visually inspected |
| Identical clipboard/file export, unavailable imported URI warning, dirty-draft preservation, future import rejection, paused session reload and next ordered sound | `unified-app-transfer-restore.json` — 4 flows pass |
| Discard, rename another card while dirty, visibility, duplicate without activation, delete cancel/confirm, restart | `unified-app-library.json` — 7 flows pass |
| Old paused session exact program/seed/long cursors; incomplete V1 recovery; future configuration bootstrap protection | `unified-app-legacy-recovery.json` — 3 flows pass |
| Session quota failure refuses Start; edits during asynchronous Start remain draft-only | `unified-app-start-safety.json` — 2 flows pass |
| Runtime configuration switching preserves setup selection/drafts; Stop returns to the previous draft | `unified-app-running-switch.json` — 2 flows pass |
| Shared main/secondary gestures; sound selection; running mixer/iteration mute; collapse and drag-dismiss | `unified-app-secondary-sheets.json` — 3 flows pass; sound/mixer screenshots visually inspected |

## Requirement disposition

| Requirement | Evidence / disposition |
| --- | --- |
| Coherent normal step model and per-step bells | Normal App/editor wiring; browser Start; shared TS/Kotlin fixtures and native scheduler facade tests. |
| Legacy configurations/presets/both drafts/settings/sounds | Pure adapter and durable migration suites; raw legacy keys retained, marker advisory, readback verified, no experimental record promotion. |
| Old accepted running sessions | Original legacy runtime retained; session tests compare next event, exact accepted track order, cue lists, seed, pause, mute and long cursors; actual legacy restore browser journey. Incomplete V1/future records require recovery rather than false resume. |
| Boundaries/collisions/randomness | Shared independent expected timing/invalid-field/random vectors, facades, run bounds and silent skip tests. |
| Runtime transport and frozen snapshots | Actual browser Start/pause/resume/prev/next/Stop/reload/terminal journey; session storage/race tests; same-generation native-authoritative restore. |
| Quiet windows, Focus, calls and late delivery | Existing shared gates retained; actual running snapshot owns runtime edits, native DND state refreshed independently. Gate/timing suites and native compile tests. Physical call/DND/background acceptance remains below. |
| Sounds/vibration/alarms | Full editor destinations and shared library; independent ordered playback across steps/rounds; URI warning and cursor reload; native cue/alarm gates. Browser play-call evidence is not physical audio/vibration proof. |
| Configuration lifecycle and durable drafts | Reducer/storage suites plus actual browser save-as/update, save/keep/discard/cancel, rename/duplicate/delete/visibility/import/export and failure/slow-write journeys. |
| Shared editing interaction | Production main and secondary sheets share `use-sheet-snap`; sound picker, mixer, help and other existing secondary editors retain their controls/help/feedback and gain drag, explicit expand/collapse/close. Browser sound/mixer/main gestures, pinned title/actions, horizontal rails, retained fields, 320px/themes/dismissal pass. Confirmation portal stacking fixed and exercised. |
| Watchface and immediate controls | Original layout retained; actual two-step browser transport and final-step screenshot inspected; canonical ring and mixer data adapted. |
| Notifications and floating overlay | Existing authoritative native service retained, schema-4 facade and overlay action helper tests, hidden/visible event vectors and source review. Final-binary overlay/handoff was not demonstrated on emulator; native helper/facade evidence is distinct from device acceptance. |
| Unsupported native versions | Pure min/max/feature capability tests; Start refuses incompatible binary; unknown native active timer never cleared by JS restore. |
| Cleanup/help/release notes | Prototype/root flag/launcher and obsolete dual-mode setup screen removed; unified setup guide and running help updated; migration/binary/rollback instructions added to RELEASES.md. |
| Final verification | Required local checks, debug APK, production web/Android exports and browser journeys pass. All 61 inventory rows have evidence/limits in the coverage ledger. Working changes are recorded in local commits. |

## Emulator observations and evidence limits

Luna used only the new task-owned AVD `codex-unified-timer-qa` on serial `emulator-5560`. Earlier local binary observations covered actual schema-4 setup, Start, previous/next, pause/resume, JS-process kill/reopen with the native session still active, and Stop. The setup capture `unified-timer-native-setup.png` was inspected by the parent; it predates the automatic step-label wording fix. Timed native point-bell delivery and floating-overlay gestures were not directly demonstrated. Final APK reinstallation was attempted only as a bounded follow-up: targeted ADB shell became unresponsive, so no server reset, final install or further device mutation occurred. Final native compile/unit results and Android Hermes bundle therefore do not claim final-binary emulator acceptance. Existing emulators 5554/5556 and physical devices were untouched.

The final browser journey has no uncaught page errors. React Native Web emits an upstream warning about `collapsable=false` forwarded by its ScrollView; it does not affect the tested flows. The nested-button running wrapper was corrected for web. During dependency refresh, a Windows fallback watcher storm from generated native build files temporarily prevented dev bundling; `metro.config.js` now excludes generated native roots/build caches, after which browser journeys and production exports pass.


No iOS build is possible on this Windows host. Emulator/local build evidence does not establish physical speaker or imported-file playback, vibration strength, live cellular-call interruption, DND behavior on every OEM, long background/Doze/battery reliability, or physical e-ink performance. These remain device acceptance checks. No OTA/store publishing, deployment, remote push or live-device data reset is authorized or performed.
