# Timer state, transport, and power — fix specification

Status: implemented in a local Android QA build; Supernote battery, e-ink flicker, audio, and long-running physical-device acceptance remain pending. Evidence and limits are in `timer-state-and-performance-implementation-2026-09-28.md`. This supersedes the pause/clock-rejoin and running Playback-sheet behavior in `timer-control-batch-2026-09-27.md`. It also makes the existing performance requirements in `floating-timer-overlay-spec-2026-09-26.md` release gates.

## 1. Purpose and observed problems

The running screen, Android scheduler, floating timer, and status notification must show and control one session without overwriting each other. With the floating timer enabled, the user has observed a one-second flicker, a running-screen Volume control that stops working after minimising and reopening the app, and other state inconsistencies. The timer also caused substantial battery drain on a Supernote e-ink device. These are observed symptoms, not yet verified root causes.

Current code gives several concrete leads:

- `App.tsx` subscribes to every floating-overlay snapshot. The countdown service emits one every second. Each snapshot can rebuild the working program and settings from native state and clear `sourcePreset`, even when only time changed. A local volume edit can race with its debounced native update.
- `useTimerV2.ts` refreshes the entire running display every 250 ms. The floating React surface also ticks every second, while the native countdown service sends a full snapshot and rebuilds the notification every second. Some work is duplicated even when no visible value changes.
- `FloatingTimerOverlay.kt` destroys and recreates its React surface on expand/collapse and cue expansion, despite the existing overlay spec requiring a stable surface. Determine separately whether ordinary ticks also cause a remount or full visual invalidation.
- Clock-aligned pause currently retains the alignment and schedules a later clock rejoin. The requested behavior is to leave clock alignment when paused.
- Random cue offsets currently depend on the time anchor and cycle index. Moving the anchor on resume may change already-realized offsets within the current cycle. Adjacent cycles can also happen to produce identical patterns by chance.

Do not treat these leads as a complete diagnosis. Profile the actual app and Supernote before attributing all drain or flicker to one path.

## 2. One session and reliable state reconciliation

1. The native scheduler owns the accepted live timeline and runtime controls: anchor, remaining time, pause, alarm, mute, current step, and scheduled cues. The React app owns the user's working configuration and pending edits. The floating timer issues commands against the native session; a clock tick is display data, not a configuration change.
2. Reconcile program/settings after an accepted external control command, Activity recreation, or process restore. Do not rebuild the app's working configuration from each periodic overlay snapshot. Periodic snapshots may update display-only fields.
3. Add a session identity and monotonic state revision, or an equivalent explicit transaction protocol, so stale native reads and delayed async preparations cannot overwrite a newer UI edit or a newer session. Reconcile only fields changed by the accepted command. Clear the saved-preset association only when the working program actually changes.
4. Volume and per-cue mixer edits must remain responsive and survive background/foreground transitions, floating-timer actions, and process recovery. Native volume should converge to the latest accepted edit without a one-second snapshot reverting the slider or sound level. Failed native edits must report failure and leave one coherent state.
5. Start, stop, snap, pause, skip, alarm, mute, preset switch, and completion must each have one acceptance point. Rejected commands leave the prior session and UI intact. An old callback cannot resurrect a stopped or replaced session.
6. The floating timer's enabled/disabled state must not change timer correctness. Disabling it stops its service, snapshot subscriptions, display ticks, and overlay surface when no other feature needs them.

## 3. Pause, alignment, and controls

### Pause and snap

- Pausing a clock-aligned Cycle immediately changes the live working program to elapsed alignment and freezes the exact remaining interval and bounded-run time. It does not sound or replay a cue, reset the current cycle, or move an alarm/mute commitment. The selected clock offset disappears from the running UI, floating timer, and status presentation. The saved preset is unchanged.
- Resuming through Play continues that elapsed cycle from the frozen position. It never silently rejoins the wall clock. Remove or bypass the existing `timerV2ClockRejoinAt` behavior for this path.
- Selecting a clock offset while paused performs one accepted transaction: select the offset, reanchor to that clock rhythm using existing Snap semantics, and unpause. On rejection the timer remains paused and unsnapped. Selecting a clock offset while running retains the existing explicit reanchor behavior.
- Apply the same alignment rule to an aligned Sequence if its Clock control is available, so the two modes do not display contradictory alignment states. Preserve established bounded-run semantics when an explicit Snap reanchors the run; pause by itself never consumes bounded time.
- Commands from the running screen and floating timer must produce identical results. Pause and skip remain unavailable while an alarm rings; dismiss the alarm first.

### Running-screen layout

- Remove the Playback bottom sheet. Place a centred transport strip directly below the watchface. A Cycle shows one Pause/Play button that acts on the first tap. A Sequence shows Previous, Pause/Play, Next, with Pause/Play central. Keep reset, clock, alarm, Focus, sound, and Stop in their existing utility area where practical.
- The strip hides when the user hides controls and reappears without shifting the watchface. Keep bounded-run progress and status readable. Use the shared transport icons and button styling; the floating timer retains its watchface-orbit controls.
- Label and disable buttons accurately for first/last bounded steps, ringing alarms, busy transactions, and completion. Never open a modal for a single transport action. Provide accessible 48 dp targets and selected/disabled announcements. Do not add gesture-only transport.

## 4. Flicker and visual stability

Identify whether the reported flicker affects the collapsed floating pill, expanded watchface, Android promoted status pill, or more than one. Record a short screen capture and native/React lifecycle counters before changing the rendering path.

- Ordinary countdown changes must not recreate the overlay window or React surface, remount the watchface, replay an entering animation, reset its state, or flash its background. Expand/collapse and cue attention should resize/update one surface where Android permits; if a platform constraint prevents that, document it and prove the transition has no visible blank frame.
- Keep stable session/configuration objects across ticks. Update only the visible countdown text and ring progress at a cadence justified by what is on screen. An unchanged string should not trigger a notification or visual update.
- Inspect `NotificationManager.notify` frequency and whether Android animates the promoted status chip on each replacement. Preserve the required compact countdown, but use platform presentation primitives or a narrower update path if full replacement causes flicker.
- E-ink mode must avoid fades, continuous ring animation, full-surface invalidation, shadows, and unnecessary intermediate frames. A second changing should update its text/ring pixels without causing the whole widget to visibly blink.

## 5. Bounded Sequence end gong

- Expose an **End gong** toggle in Sequence setup whenever run policy is Cycles or Duration; hide it for Continuous. Reuse the existing `completionCue` model and sound/volume controls rather than add another competing setting. Rename or clarify the current “Custom final gong” wording.
- Off: the last step's configured cue remains the terminal sound when the run ends exactly at that boundary. On: the configured end gong sounds once at the run's terminal instant instead of the last-step cue. A Duration that ends within a step uses the end gong when enabled. This is one terminal audio event, avoiding two sounds colliding. Terminal alarm precedence remains as currently specified in the timer-control contract.
- Show the end gong in the event preview and sound mixer, save it with presets, and restore it across app/process restart. Existing saved `completionCue` values remain enabled. Continuous sequences ignore a retained value until a bounded policy is selected again.
- Confirm final event, mute, quiet-hours boundary, per-step alarm, and Stop behavior in JS and native timeline fixtures.

## 6. Random sub-bells per cycle instance

- A random range produces a new realized schedule for each cycle instance. Once a cycle begins, its realized offsets remain stable through pause/resume, backgrounding, process death, and repeated UI/native queries. The next cycle gets a newly derived schedule.
- Separate an immutable session random seed from the movable time anchor. Derive each cycle's offsets from session seed, track ID, and absolute cycle instance index using the same algorithm and test vectors in TypeScript and Kotlin. Persist enough information for native restore and web fallback. Do not use `Math.random()` independently in the UI and scheduler.
- When the range permits multiple patterns, avoid replaying an identical entire schedule on adjacent cycles where practical; a single-value range or a very short cycle may unavoidably repeat and should not loop or invent invalid times. Keep minimum gap, interior-only offsets, deduplication, collision priority, and exact terminal boundaries.
- The configuration visualizer is labelled as a representative example. The running watchface and upcoming-event preview show the current realized cycle. Include tests spanning at least several cycles, pause/resume, clock reanchor, and recovery.

## 7. In-depth performance and battery investigation

### Baseline before optimisation

Measure the current release and the candidate build under comparable conditions. On the Supernote, record model/firmware, theme, brightness/front light, Wi-Fi, battery level, screen state, session program, notification and floating-timer settings, and test duration. Compare at least: idle app; running without floating timer; collapsed floating timer; expanded floating timer; screen off; and running foreground with e-ink theme. A short warm-up and a long enough observation window to see battery movement are necessary. Report percentage/hour or mAh/hour when available, plus uncertainty; do not claim device battery improvement from emulator results.

### Trace and attribute work

- Count React commits for the main screen and overlay, component remounts, render durations, timer callbacks, timeline calculations, JSON parsing, native bridge events, notification rebuilds, WindowManager updates, React-surface start/stop, foreground-service starts, and wake-lock hold time. Compare with the overlay disabled.
- Use React Profiler or a lightweight temporary render counter, Android Studio/Perfetto CPU and wake traces, and `dumpsys batterystats`/service and wake-lock inspection as appropriate. Remove diagnostic logging/instrumentation from release code unless it is low-cost and intentionally retained.
- Audit `useTimerV2`'s 250 ms full-display refresh, `ChandasCountdownService`'s one-second full snapshot and notification render, overlay's separate one-second state query, `timerV2DisplayFor`/timeline scans, random-offset generation, `useMemo` dependencies on fresh snapshot objects, progress-ring animation, audio preparation, and Expo keep-awake lifecycle. Look for duplicate foreground/background clocks and work continuing with the screen off, overlay hidden, or timer stopped.
- Attribute any cost to CPU, Android wakeups, display refresh, networking, audio, or the e-ink driver as evidence allows. The exact-alarm schedule must remain accurate; reduce presentation work independently of bell delivery.

### Optimisation and acceptance

- Prefer one authoritative time base and local absolute-time display math. Native-to-JS bridge events occur for structural/control changes and actual cue events, not every second. Visible countdowns refresh on second boundaries; hidden surfaces do no display work. Do not poll a full native state when a monotonic local clock and an occasional structural event suffice.
- Avoid repeated full program parsing, random schedule generation, and React tree reconstruction on each tick. Memoize by stable program/session revision, cache realized cycle data, and keep collapsed overlay rendering small. Deactivate display wakefulness when the app is backgrounded if the native scheduler can continue safely.
- Avoid full notification updates when compact text is unchanged, and do not hold a foreground presentation service solely for a disabled feature. Keep the app responsive on low-power e-ink hardware and respect reduced motion.
- Compare the same measurements after changes. Report before/after rates and traces, remaining hotspots, and the practical limits of any measurement. Do not mark the battery issue solved solely because tests pass or a single short run looks better. If Supernote access is unavailable to the implementation agent, provide a precise manual measurement protocol and clearly mark device battery acceptance pending.

## 8. Verification and delivery

1. Add focused tests for stale snapshot rejection, edit-versus-tick races, preset identity, pause-unsnap, resume, re-snap from pause, rejected commands, bounded deadlines, terminal end gong, and random-cycle stability/variation. Include shared TypeScript/Kotlin timing fixtures. Avoid large screenshot automation before behavior is stable.
2. Run Expo dependency check, TypeScript, unit tests, targeted Kotlin tests/compile, and a local Android build. Use the emulator to check transport layout, minimising/reopening, volume editing with floating timer enabled, overlay transitions, pause/snap, and at least two realized random cycles.
3. Perform or document pending physical-device checks: Supernote flicker and battery, screen-off behavior, long-running background timing, real cue audio, and OEM status-chip rendering. A controlled manual test is preferable to expensive brittle automation.
4. Update the older timer and overlay specs to point to the accepted new behavior, and update help text where the controls move. Record before/after performance evidence and unresolved risks in the implementation report.
5. Native changes require a new native build/runtime. A local QA APK is appropriate. Do not publish an OTA, submit to Google Play, or claim Supernote battery acceptance without the relevant device evidence unless the user separately requests those release actions.
