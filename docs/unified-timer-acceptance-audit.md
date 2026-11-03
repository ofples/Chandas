# Unified timer — independent acceptance audit

## November 3 settings and sheet pass

Schedule is now an app-wide preference shared across timers; config snapshots, drafts and transfers exclude it, while runtime receives the current global policy. Alarm mode is stored on each timer program. Setup restores the schedule timeline and links it to the editor; the cue sheet opens expanded, shorter sound choices remain layered, and shared sheets animate open and close. Default haptic display resolves to the configured pattern/strength, or Off when global haptics are disabled. Focused settings content no longer has an extra padded card, and appearance uses the existing lightbulb icon.

Checks: TypeScript passes; the global schedule/timer adapter work reports 294 passing tests, and a focused rerun passed 32 tests across config storage, configuration transfer and unified timer files. Fresh Edge Playwright validation passed seven grouped checks: global visualizer and editor copy; settings close/reopen; effective default haptic profile; alarm mode persisted on the timer draft; expanded ending-cue sheet with source and volume controls; sound sheet close/reopen; zero page errors. The 844px sheet filled the viewport. The harness and result are in `C:/Users/pless/.codex/visualizations/2026/09/29/01a0eca8-b56d-76e3-a15a-15e81cdf6272/2026-11-03-settings-ui.cjs` and `2026-11-03-settings-ui-result.json`; inspected screenshot: `2026-11-03-sound-expanded.png`. `adb devices` showed no attached Android device, so native visual/gesture verification is unavailable. No build, deployment or publication was performed.

Authority: `unified-timer-goal-prompt-2026-10-31.md`. Parent review is independent of Luna's implementation coverage ledger. Evidence below concerns the actual normal application, not the former experimental entry.

## November 2 volume mixer refinement

Mixer channels now use regular-weight labels, separate muted percentages and quiet step headings without repeated numbered titles. Every setup volume control, including master, step ending cues, sub-bells, completion and alarm, has a right-side play button. Auditions use the shared sound-preview service at the effective master/channel gain and can cycle through multiple selected sounds without changing the program or runtime cursor. Closing the volume view stops preview playback. The interval alarm control contains only its toggle row; its redundant sound/duration navigation was removed while alarm defaults remain in Settings.

`2026-11-02-mixer/result.json` records six grouped browser checks: all seven configured mixer channels have previews; selected sounds and effective gains are correct; multiple auditions do not modify configuration state; editing a channel changes audition gain and dismissal stops playback; the alarm control has only its toggle; inline bell/default-alarm volume previews work; and the 320px mixer has no horizontal overflow. No page or console errors occurred. TypeScript, all 290 tests and web/Android Hermes exports pass. Expo's dependency check used its local map because its network endpoint was unavailable; no dependencies changed. Preview evidence is browser media instrumentation, not physical-speaker acceptance.

## November 2 focused controls, configuration saving and deeper gesture review

The latest user review replaces the accordion-style optional controls with smaller centered overlays. After/Before/Random are independent rail toggles; enabled summaries reopen their timing editor, with no duplicate inline on/off control. Volume is labeled simply Volume. Cue selection replaces its explanatory paragraph and its rail highlight tracks the open overlay, not whether any points are selected. Color opens its palette directly; optional vibration and watch-face controls keep their authored values. Timer-wide settings use the same focused control pattern. Settings keeps its menu visible under a smaller detail layer; sound and sound-choice layers are shorter than their parents. Plain header/handle taps toggle full/partial size, including the configuration header, and focused controls fit their content where possible. Expanded state survives content-size changes.

Save moved off the timer page into the current card at the top of Configurations. Save creates/updates immediately using the current name, Save a copy is immediate and uniquely named, and Available while running is a checked menu item. The separate naming sheet is removed, including unnamed Save & switch. The gallery-style SVG replaces the old icon. Sequence-wide actions precede the cards; Add step follows the last card.

Luna's second gesture review found callbacks waiting for a visual reset and a remaining same-turn translation reset. Reorder and swipe actions now commit on release. The dragged row retains its destination through React's data-order commit. Swipe reset is an independent 120 ms timing animation; the full exposed gap is colored. Distance/axis thresholds, cancellation, press suppression and deletion confirmation remain intact.

Evidence in `2026-11-02-next/`: `ui.json` covers focused control coexistence/deselection, immediate current-card saving, metadata menus, all Settings detail destinations, header tap snapping and control placement; `saving-flows.json` independently verifies nine create/update/copy/switch/storage-failure/visibility cases with no console/page errors; `runtime.json` verifies pause/resume identity, both steps' exact four expected audio play calls, completion and 320px/light/e-ink layouts. `gesture-evidence.json` records Luna's 12-case mouse/touch suite plus edge auto-scroll, reorder after duplicate/delete and rapid swipe-to-handle flow. Eight final landing frames remain at y=152; edge scrolling reaches 868px and moves index 2 to 10; rapid swipe-to-handle horizontal drift is 0px. Duplicate updated in 42ms and delete confirmation rendered in 12–14ms in the isolated browser. Cancel/short/diagonal drags do not act. Screenshots of current/saved cards, Cue selection, bell controls and step placement were reviewed.

Expo compatibility, TypeScript, all 290 tests and web/Android Hermes exports pass. These are isolated browser and bundle checks, not physical-device gesture/audio acceptance or an exhaustive proof of every possible input. No scheduler change or publication.

## November 2 gesture and navigation corrections

Configuration import, working-copy and Save as actions moved into the library heading's overflow menu. Stacked-card and vertical-overflow SVG icons replace font glyphs. Visible Back/Done and the redundant switch Cancel control were removed from the active editor; outside/drag/native dismissal still returns one layer. Secondary haptic/floating previews and rename-save use icons; Focus and permission destinations are tappable rows. Explicit save and destructive-confirmation choices remain labeled.

Reproduced the reported step drag failure with an immediate mouse movement: the old hold-delay logic treated it as scrolling. The dedicated handle now claims the drag immediately while the rest of each card supports scrolling/swiping. Drop settles at the target before changing layout, retaining its translation until React commits the order to avoid the single frame at the old index. Added distance-triggered left-delete/right-duplicate gestures to step and bell cards (80–120px according to width, X at least 1.4 times Y). Short, cancelled and vertical gestures do not act, and a swipe cannot also open the row editor. Delete uses the existing app confirmation; duplicate inserts immediately after the source. Sheet Modals have gesture roots so bell and sound row gestures receive events.

Browser evidence is in `2026-11-02/interaction.json` and `touch.json`: immediate mouse/touch reorder, cancelled reorder, sampled drop landing, short/vertical action rejection, step/bell duplicate/delete/cancel, nested-sheet gesture handling, menu-only library actions and navigation without visible Back/Done controls. Both reports have zero uncaught page errors; the interaction report also captures console errors. These use isolated browser storage and synthesized mouse/touch input, not a physical-device acceptance claim. Expo compatibility, TypeScript, 290 tests and web/Android Hermes exports pass. Screenshots of the configuration menu and bell list were inspected. No scheduler/native-module change or publication.

## November 1 follow-up consistency pass

Implemented the user's next review in the actual app. Page and step sheets share `UnifiedIntervalEditor`; the whole sub-bell summary opens its sheet while the toggle changes only enablement. Timer policy controls are no longer duplicated in Settings; completion sound is contextual to bounded runs beside Add step. Settings retains keyed scroll offsets and has one section heading. Full setup mixer, brighter action labels, inline step headings, configuration shortcut and multi-step timeline cards are present. Step/bell/configuration commands use dismissible overflow menus. Reused the original delayed ReorderHandle with animated insertion previews and edge scrolling, without changing persisted order until drop. Sound choices retain the cue layer behind a shorter partial sheet and provide Back. Web scrollbars are hidden. Complete repeating selections extend when duration grows; explicit custom selections remain intact.

Validation: Expo dependency check, TypeScript and all 290 tests across 24 files pass; web and Android Hermes exports pass. Browser artifacts: `2026-11-01-followup/ui.json` records six grouped flows (card/toggle ownership, Random off and cadence growth, full mixer, bounded completion/layered sounds, settings scroll and de-duplication, live drag/shared step menu, saved cards and disabled Save); it reports no uncaught or console errors. `runtime.json` verifies accepted-session pause/resume identity, both steps' four expected bell/end audio play calls, single completion and return to setup, plus 320px/light/e-ink views. Screenshots of the bell, live drag, sound layering, saved cards and compact/theme views were inspected. Sound-choice list key/row-height issues were corrected during this pass. Audio is browser instrumentation; physical sound, vibration and native gestures remain device acceptance work. No native/runtime engine changes or publication.

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
