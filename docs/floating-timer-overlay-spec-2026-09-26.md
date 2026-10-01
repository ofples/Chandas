# Chandas floating timer overlay — implementation specification

Date: 2026-09-26  
Status: Approved product direction; implementation pending  
Platform: Android only for this version

## 1. Summary

Add an optional always-on-top Chandas timer for an active run. Its resting state is a very small countdown pill using the same compact text as the promoted notification/status pill. Tapping it expands into the same circular Chandas watchface used by the running screen, with small controls arranged beneath and around it like watch buttons.

The expanded view includes Reset, clock alignment, Alarm, Sound/mute and Stop. It does not include Chandas Focus. It collapses automatically after a short period without interaction and can be dragged to either screen edge.

This is a user-enabled Android system integration. Chandas must explain and request Android's **Display over other apps** special access before showing it. The timer continues normally when access is absent, denied or revoked.

## 2. Product decisions

| Area | Decision |
| --- | --- |
| Default | Off. Chandas never requests overlay access until the user enables Floating timer. |
| Collapsed view | Compact pill, for example `9:12 · 15m`, `1:23 · Work`, or `43s`. |
| Expanded view | Circular Chandas watchface with controls around its lower arc. No enclosing card or rectangular visible background. |
| Shared UI | The running screen and overlay render the same React watchface and control-button components. A separate native imitation is not acceptable. |
| Controls | Reset, clock alignment, Alarm, Sound/mute and Stop. Focus is intentionally omitted. |
| Alarm visibility | Visible for Cycle runs whenever the native alarm feature is supported, even when Advanced mode is hidden. Hidden in Sequence mode. |
| App foreground | Hide the system overlay while the Chandas activity is visible. The ordinary running screen remains the authoritative in-app surface. |
| Timer inactive | Remove the overlay immediately when the timer stops or completes. |
| Alarm ringing | Hide the overlay while the dedicated alarm experience is visible. Restore it after dismissal only if the underlying timer is still active. |
| Persistence | Enabled preference and position are device preferences. They are not part of saved timer configurations or configuration transfer. |
| iOS | No overlay. The setting is absent. |

## 3. Goals

- Let the user see the meaningful countdown while using another app.
- Give fast access to the most useful running controls without reopening Chandas.
- Preserve the visual and behavioral identity of the running watchface.
- Keep the overlay physically small and non-disruptive.
- Remain correct through backgrounding, screen rotation, process recreation, permission revocation and timer reconfiguration.
- Keep timing and cue delivery owned by the existing native scheduler. The overlay is presentation and control only.

## 4. Non-goals

- Replacing the notification or promoted status text.
- Showing setup/configuration editors inside the overlay.
- Showing Chandas Focus controls.
- Displaying arbitrary messages, advertising or non-timer content over other apps.
- Forcing the overlay over the lock screen. The existing alarm and notification paths continue to own lock-screen presentation.
- Keeping the overlay alive when no timer is active.

## 5. User interface

### 5.1 Collapsed state

The collapsed overlay is `124 × 40dp`, excluding the `48dp` high transparent touch target. Horizontal padding is `8dp`.

- Opaque Chandas surface with a subtle border and shadow.
- Fully rounded pill shape.
- Accent activity dot followed by compact status text.
- Minimum effective touch target: `48dp` high.
- One line only; no configuration name.
- Tapping expands the overlay.
- Dragging moves it without expanding.
- Long-pressing provides the accessibility action and shortcut to open Chandas.

Compact text must match the existing notification/status contract:

- Bounded Cycle with different next and terminal targets: `9:12 · 15m`.
- Cycle when the next target is also the final target: `43s` or `0:43`, using the existing compact formatter's canonical result.
- Sequence: countdown first and the first four displayed characters of the current step second, for example `1:23 · Work`.
- Quiet schedule: concise `Quiet` presentation with the next meaningful resume/countdown when one exists.
- Below one minute: seconds.
- One minute through 59:59: `m:ss`.
- Long durations: compact minutes according to the current native formatter.

Spacing around `·` may vary by typography, but the semantic output must stay identical across the notification and overlay.

### 5.2 Expanded state

The expanded cluster is approximately `344 × 418dp` in the initial implementation:

- `220dp` circular watchface.
- Same ring layers, event colors, progress, countdown typography and center information as the running screen.
- Five `48dp` circular control targets following the lower arc.
- No scrim, card, toolbar or full-screen touch layer.
- Transparent pixels remain visually transparent. Touches outside the overlay window bounds go to the underlying app.

The watchface displays, where applicable:

- Current configuration or Sequence step label.
- Main/current-step countdown.
- Next bell or next step.
- End of bounded run.
- Quiet or runtime-mute status.
- The same progress and cue rings as the running screen.

Tapping the watchface collapses the overlay. A pan beyond the platform touch-slop drags it instead; a drag must never also collapse it.

### 5.3 Control layout

Left to right around the lower arc:

1. Reset interval.
2. Clock alignment.
3. Alarm, centered at the bottom for Cycle runs.
4. Sound/mute.
5. Stop, using the warm/destructive tone.

If Alarm is absent in Sequence mode, retain visual balance by centering the remaining four controls around the arc. Do not leave an unexplained empty alarm slot.

### 5.4 Auto-collapse

- Collapse five seconds after the most recent interaction.
- Restart the timer after a tap, drag, control action or accessibility focus change.
- Pause auto-collapse while a pointer is down or a drag is active.
- Keep a pending Stop confirmation expanded until it resolves or times out.
- With TalkBack enabled, extend the timeout to at least 15 seconds and do not collapse while accessibility focus is inside the overlay.
- Returning Chandas to the foreground removes the system overlay rather than merely collapsing it.

### 5.5 Positioning

- The whole overlay is draggable from the pill or watchface.
- Snap to the nearest horizontal screen edge on release.
- Preserve an `edge + normalized vertical position`, separately for portrait and landscape screen shapes.
- Clamp against current display cutouts, status/navigation bars and gesture insets.
- Re-clamp after rotation, display-size changes, font-scale changes and multi-window changes.
- Expanding grows inward from the current edge so controls do not open off-screen.

## 6. Control behavior

All control mutations use the same serialized native timer transaction path as the main running screen. A second overlay React root must not maintain an independent timer session.

### 6.1 Reset

- Reuse the running screen's `Reset interval` action and semantics.
- For a clock-aligned Cycle, reset also removes the current clock alignment, matching the existing running-screen tooltip and behavior.
- Update the watchface immediately from the accepted native snapshot.
- If the native action fails, retain the current state and show a short inline failure label; do not optimistically invent a new anchor.

### 6.2 Clock alignment

- Active styling is derived only from the actual persisted program alignment.
- A tap while aligned removes alignment and resets using the shared action.
- A tap while unaligned applies the last valid clock phase used for that Cycle duration; fall back to `:00` when no valid previous phase exists.
- A long press opens Chandas directly to the existing clock-alignment selector for choosing another phase.
- Never display `:00` as selected unless native state confirms that alignment.

### 6.3 Alarm

- Reuse the current single/double-tap behavior and `alarmBehaviorAfterGesture` semantics.
- One tap from Off arms the next main gong and shows badge `1`.
- A double tap from Off locks the alarm for successive main gongs and shows badge `∞`.
- A tap when armed clears it according to the existing behavior.
- Native control state is authoritative. The badge must reflect `off`, `once` or `locked` after restoration and after a cue consumes Alarm once.
- Hide Alarm in Sequence mode.

### 6.4 Sound/mute

The floating button is a fast runtime-mute control rather than a second mixer:

- When audible, tap to mute one full Cycle/Sequence iteration using the existing iteration-mute model.
- When runtime-muted, tap to clear the mute.
- Active/muted styling comes from the actual runtime mute state.
- Long press opens Chandas to the running mixer for volume, per-cue levels and custom mute duration.
- Master volume `0%`, call muting and schedule Quiet remain distinct states. The button must not claim it can clear those conditions.
- After the action, show a brief label such as `Muted for 1 cycle` or `Mute cleared`.

### 6.5 Stop

- First tap changes the control to a guarded `Tap again to stop` state for three seconds.
- Second tap in that window stops the timer through the existing verified stop path.
- A tap elsewhere cancels the pending Stop state.
- TalkBack exposes a clearly labeled `Stop timer` action and announces the confirmation requirement.
- Once native state reports inactive, remove the overlay. If stop verification fails, restore the control and show a short error rather than hiding the timer.

## 7. Shared React component architecture

### 7.1 Required extraction

Refactor `TimerV2RunningScreen.tsx` so both surfaces consume shared, pure components:

```text
src/components/timer-v2/running/
  TimerWatchface.tsx
  TimerWatchfaceRing.tsx
  TimerControlButton.tsx
  TimerWatchfaceModel.ts
  FloatingTimerOverlay.tsx
```

The exact filenames may change, but these boundaries are required:

- `TimerWatchface` owns the circular visual, ring rendering and center content.
- `TimerControlButton` owns target size, active state, badge, press feedback, tooltip/accessibility semantics and icon placement.
- `TimerWatchfaceModel` is a pure presentation model derived from program, absolute timestamps, schedule/mute state and `now`.
- Full-screen and floating layouts supply size and arrangement; they do not fork watchface markup.

### 7.2 Component contract

The shared watchface should accept a presentation contract similar to:

```ts
interface TimerWatchfaceProps {
  model: TimerWatchfaceModel
  size: number
  eventPulse: number
  controlsVisible: boolean
  presentation: 'running-screen' | 'floating-overlay'
  onPress?: () => void
  onLongPress?: () => void
}
```

`presentation` may adjust scale, truncation and optional copy. It must not select different timing semantics, progress values or event rings.

The existing running screen must use the extracted component before the overlay is added. This establishes one real source of truth and provides a visual regression checkpoint.

### 7.3 State ownership

- The overlay React surface receives one authoritative native timer snapshot.
- It derives display values locally from absolute timestamps and ticks on displayed-second boundaries.
- It does not run a second `useTimerV2` scheduler, schedule alarms, prepare audio or persist a parallel session.
- Native timer events refresh the snapshot immediately; the one-second display tick does not cross the React/native bridge.
- All overlay commands go through native atomic control functions and then reconcile from the resulting snapshot.

## 8. Android overlay architecture

### 8.1 Permission and window type

Add `android.permission.SYSTEM_ALERT_WINDOW` to the checked-in module manifest and Expo configuration. Android requires explicit user approval through `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`; effective access is read with `Settings.canDrawOverlays(context)`.

Use `WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY` on API 26 and later. Use:

- `FLAG_NOT_FOCUSABLE`, so the overlay does not take keyboard or navigation-key focus.
- `FLAG_NOT_TOUCH_MODAL`, so touches outside its bounds continue to the underlying app.
- A translucent pixel format and a window sized only to the current pill or expanded cluster.
- No full-screen transparent host window.

Android may reposition, resize or hide application overlays to reduce clutter. Position state must therefore tolerate a native clamp or visibility change rather than assuming exact coordinates.

Official references:

- [SYSTEM_ALERT_WINDOW](https://developer.android.com/reference/android/Manifest.permission#SYSTEM_ALERT_WINDOW)
- [Settings.canDrawOverlays](https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context))
- [TYPE_APPLICATION_OVERLAY](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY)
- [Foreground-service background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)

### 8.2 React surface

The overlay window hosts a second React Native surface registered as `ChandasFloatingTimer`. The native service attaches that surface to the application React host and `WindowManager`.

Requirements:

- Reuse the application's embedded JS bundle and React host. Do not ship a second bundle.
- Mount `FloatingTimerOverlay` as its root and pass only bootstrap properties such as initial snapshot, appearance and density/insets.
- Subscribe to the existing timer-module events after mount.
- Unmount and release the surface when the timer stops, the setting is disabled or access is revoked.
- If the activity is absent but the service process remains, initialize or reuse the application React host and mount the same component.
- If Android recreates the process, reload persisted native timer state before making the overlay visible. Do not briefly show a default or stale timer.
- If the React surface cannot initialize, retain timing/notification behavior and log/report the overlay failure. Do not replace the approved design with a permanently separate native watchface.

An implementation spike must prove service-owned React-surface mounting and cleanup on the project's exact Expo/React Native architecture before the full UI work proceeds. The spike is complete only when the shared watchface renders over another app after the Chandas activity has been removed from recents while the timer service remains valid.

### 8.3 Presentation service

Generalize the existing `ChandasCountdownService` into the single owner of continuous running presentation rather than adding competing foreground services.

- It runs when either promoted/live notification countdown or floating overlay presentation requires it.
- It may run below API 36 when Floating timer is active; the existing live-countdown API gate remains specific to promoted notifications.
- It continues to use the existing running notification ID so Android receives one coherent foreground-service notification.
- Overlay enablement does not change AlarmManager ownership of bell delivery.
- Do not create a second notification solely for the overlay.
- Android foreground-service rules still apply. If a required presentation service cannot legally start from the current background state, show the notification fallback and attach the overlay at the next permitted foreground/user interaction.

Because Android 15 and later only grant the overlay-related foreground-service background-start exemption while an overlay is currently visible, the implementation must not depend on that exemption to bootstrap a previously invisible overlay.

## 9. Native module contract

Increment the native timer contract version and advertise:

```ts
supportsFloatingTimerOverlay: true
```

Add typed bridge methods with Android no-op/unsupported behavior represented explicitly:

```ts
getFloatingTimerOverlayState(): FloatingTimerOverlayState
openFloatingTimerOverlaySettings(): void
setFloatingTimerOverlayEnabled(enabled: boolean): void
showFloatingTimerOverlayPreview(): boolean
setFloatingTimerOverlayPosition(position: FloatingTimerPosition): void
performFloatingTimerAction(action: FloatingTimerAction): FloatingTimerActionResult
```

Suggested types:

```ts
interface FloatingTimerOverlayState {
  supported: boolean
  requested: boolean
  permissionGranted: boolean
  effective: boolean
  visible: boolean
  expanded: boolean
  position: FloatingTimerPosition
  lastError?: 'permission' | 'service-start' | 'react-surface' | 'window-manager'
}

type FloatingTimerAction =
  | { type: 'restart-unsynced' }
  | { type: 'toggle-clock-alignment'; fallbackOffsetSeconds: number }
  | { type: 'alarm-gesture'; gesture: 'single' | 'double' }
  | { type: 'mute-one-iteration' }
  | { type: 'clear-mute' }
  | { type: 'stop' }
```

Emit `onFloatingTimerOverlayStateChanged` when permission, requested/effective state, visibility, expansion or native errors change. Continue using existing timer/control events for countdown and control state.

`requested` and `permissionGranted` remain separate. Revoking permission must make `effective` false without silently erasing the user's preference.

## 10. Persistence and display data

Persist in native device preferences:

- `floatingTimerRequested`.
- Portrait edge and normalized vertical position.
- Landscape edge and normalized vertical position.
- Last valid clock phase by compatible Cycle duration, with bounded storage.

Do not add these fields to `AppTimerSettings`, `ProgramPreset`, configuration descriptions or configuration-transfer files. They describe this Android device, not a timer configuration.

The persisted native running configuration must expose enough presentation data for the overlay root to reconstruct `TimerWatchfaceModel`, including:

- Program and schema version.
- Anchor, start and optional end timestamp.
- Current/next logical event state.
- Runtime mute state.
- Alarm behavior.
- Schedule/Quiet state.
- Configuration display name, when loaded from a named configuration.
- Accent/theme choice required to match the running screen.

Apply existing string and serialized-presentation size limits. Treat loaded names and labels as text; never inject them as markup.

## 11. Settings and permission flow

Add `Floating timer` to **System integrations** on Android when the native capability exists.

Suggested copy:

- Title: `Floating timer`
- Disabled detail: `Show the running countdown over other apps.`
- Enabled/effective detail: `Shows while Chandas is in the background.`
- Enabled but missing access: `Allow display over other apps to use it.`

First enable flow:

1. Show a Chandas explanation stating that the timer appears above other apps only during an active run and can be turned off here at any time.
2. Continue to `ACTION_MANAGE_OVERLAY_PERMISSION` for the Chandas package.
3. On app resume, call `Settings.canDrawOverlays` again.
4. If granted, keep `requested = true` and offer a short preview.
5. If denied, keep the timer unaffected and show the setup action. Do not repeatedly reopen Settings.

Also provide `Preview floating timer` while no timer is running. Preview uses fixed demonstration content, lasts no more than ten seconds and cannot perform timer controls. It exists to let the user position and understand the feature.

Disabling the setting removes any live or preview overlay immediately. Uninstall/reinstall and Android's permission controls remain authoritative.

## 12. Lifecycle state machine

Effective visibility is the conjunction of:

```text
supported
AND requested
AND permission granted
AND timer active
AND Chandas activity not visible
AND alarm UI not currently owning presentation
```

Transitions:

| Event | Required result |
| --- | --- |
| Timer starts while Chandas is foreground | Do not duplicate the running screen. Prepare state; show after backgrounding. |
| Chandas backgrounds | Attach/show collapsed overlay. |
| User expands | Resize the WindowManager window, preserve anchor edge and start collapse timer. |
| User returns to Chandas | Remove overlay window and retain position/preferences. |
| Timer configuration switches | Reconcile the same overlay to the accepted native snapshot; no disappear/reappear flash. |
| Quiet begins | Keep overlay visible and update quiet/next-audible presentation. |
| Alarm starts ringing | Hide overlay before showing alarm presentation. |
| Alarm dismissed, timer remains active | Restore collapsed overlay when Chandas is backgrounded. |
| Timer stops/completes | Unmount React surface and remove window. |
| Permission revoked | Remove window immediately; keep timer running and emit missing-access state. |
| Process recreated | Load native session, initialize React host, restore a clamped collapsed overlay when permitted. |
| Screen turns off | Stop visual ticks; leave scheduler untouched. Recompute from absolute time on screen-on. |
| Device reboot | Timer restoration remains authoritative. Restore overlay only when Android permits presentation startup; otherwise retain notification fallback. |

## 13. Accessibility and usability

- Every visual control has at least a `48 × 48dp` target.
- Expose role, selected state, badge meaning and action result through TalkBack.
- Traversal order follows Reset, Clock, Alarm, Sound, Stop, then watchface/open-app actions.
- Do not rely on color alone for aligned, alarm or muted state.
- Respect reduced motion. Expansion and button appearance may fade/scale briefly but must not use continuous decorative motion.
- Respect font scale without increasing the outer pill until compact text would otherwise clip. Truncate labels before countdowns.
- Provide accessibility actions for `Expand`, `Collapse`, `Move`, `Open Chandas` and the timer controls.
- Haptics follow the existing app-feedback setting and must not impersonate cue haptics.
- The overlay must never cover the whole display or silently consume touches outside its visible cluster.

## 14. Performance and robustness

Follow-up: `timer-state-and-performance-spec-2026-09-28.md` makes the no-per-second-bridge-event and stable-React-surface requirements below acceptance gates and adds measured Supernote battery verification.

- Align display refreshes to second boundaries.
- Use absolute timestamps; never decrement a stored counter.
- Do not send a native bridge event every second.
- Suspend React display ticks when the screen is off, overlay hidden or surface unmounted.
- Keep the collapsed React tree minimal.
- Avoid remounting the React surface for collapse/expand; resize the same window/surface.
- Serialize WindowManager add/update/remove calls on the main thread and make them idempotent.
- Catch `SecurityException`, `BadTokenException` and permission races. A failed overlay operation must never stop or reschedule the timer.
- Remove views and React roots in every service-destroy path to avoid leaked-window errors.
- Record only coarse failure categories; do not log configuration names or user-selected labels unnecessarily.

## 15. Compatibility and release impact

- This requires a new Android native binary and runtime fingerprint. It cannot ship as an OTA-only feature.
- Older binaries must not render the setting because `supportsFloatingTimerOverlay` is absent.
- Existing configurations and timer sessions remain readable without migration.
- Development and production package IDs request overlay access independently, allowing both builds to remain installed.
- Validate the generated production manifest and Play Console permission/declaration prompts before store submission. Google Play evaluates new sensitive/high-risk permission declarations during release review when applicable; prepare clear reviewer instructions and a short demonstration of the user-enabled timer use case.
- No new network, account or personal-data access is introduced.

## 16. Verification plan

Keep automated coverage focused on deterministic state and formatting. Reserve OEM appearance, permission, process and gesture behavior for emulator/device verification.

### 16.1 Automated checks

- Shared `TimerWatchfaceModel` unit tests for Cycle, Sequence, Quiet, mute, completion and bounded/unbounded runs.
- Golden compact-text fixtures executed against both TypeScript and Kotlin formatters.
- Reducer/state-machine tests for requested/permission/effective/visible state.
- Action tests proving reset, alignment, alarm, mute and stop call the native transaction once and reconcile accepted state.
- Position normalization and safe-bound clamping tests.
- Existing `TimerV2RunningScreen` tests updated to prove it uses the extracted watchface without behavior regression.
- Native unit tests for preference migration, permission loss and idempotent service decisions where Android-free seams permit it.
- TypeScript, Vitest, native module tests and targeted Android debug/release compilation.

Do not build a large screenshot automation suite before physical behavior is stable.

### 16.2 Required Android manual matrix

- Pixel/AOSP emulator on the lowest supported API and current target API.
- At least one connected physical phone, including its OEM overlay-permission surface.
- Fresh install: feature off and no permission prompt.
- Enable, deny, enable again, grant, revoke in Android Settings while running.
- Preview with no timer; confirm controls cannot mutate anything.
- Cycle continuous/bounded and Sequence bounded/continuous.
- Countdown transitions through `1:00 → 59s` and a combined target becoming a single countdown.
- Sequence step names shorter and longer than four characters.
- Quiet schedule, timed mute, iteration mute, call mute and master volume 0%.
- Reset while aligned and unaligned; rapid repeated taps.
- Alarm once, alarm locked, consumption at a main cue and alarm dismissal.
- Sound quick mute and clear; long-press open to mixer.
- Stop confirmation, cancellation, successful stop and simulated verification failure.
- Drag from each screen edge, rotate underlying apps, change display/font size, use gesture navigation and cutout/inset devices.
- Expand over a scrollable app and confirm only the overlay bounds intercept touch.
- Five-second collapse, interaction timer restart and TalkBack timeout/focus behavior.
- Background, remove Chandas from recents, screen off/on, process kill/recreation and device reboot with a restorable active run.
- Permission or React-surface failure leaves exact alarms, cues and notification behavior intact.
- Confirm no leaked-window, foreground-service or background-start exceptions in logcat.

## 17. Implementation order

1. Extract the shared watchface, ring and control button; verify the ordinary running screen is unchanged.
2. Add shared presentation model and cross-language compact-format fixtures.
3. Prove a minimal service-owned React surface in `TYPE_APPLICATION_OVERLAY` across activity removal and process/service lifecycle.
4. Add capability, permission/status bridge, native device preferences and System integrations UI.
5. Implement collapsed pill, dragging, safe positioning and preview mode.
6. Add the expanded circular layout and collapse behavior.
7. Add native atomic control actions and their UI states.
8. Generalize the presentation service without changing AlarmManager timing ownership.
9. Complete lifecycle recovery, accessibility and failure handling.
10. Run focused automated gates, then the emulator/device matrix.
11. Build development and production binaries. Update Play reviewer documentation before the next AAB submission.

## 18. Definition of done

- The same React watchface and button primitives render in the running screen and system overlay.
- The approved collapsed pill and circular expanded layout match Chandas styling in light and dark themes.
- Reset, alignment, Alarm, quick mute and guarded Stop operate on the one native timer session.
- Focus never appears in the overlay.
- Permission denial/revocation and overlay failures cannot affect timer timing or delivery.
- The overlay hides in Chandas, during alarm presentation and after Stop/completion.
- Drag position and opt-in preference survive process recreation without entering saved configurations.
- No stale countdown, false alignment, incorrect alarm badge or duplicate timer session appears during backgrounding or configuration switching.
- Accessibility and physical-device checks pass on the required Android matrix.
- A new Android build is produced and its generated manifest, runtime fingerprint and Play release requirements are verified before distribution.

## 19. Implementation record — 2026-09-26

**Status:** Implemented and locally verified on an Android 16 Pixel emulator. Physical phone and OEM permission checks remain manual release checks.

### 19.1 Delivered architecture

- `TimerWatchface` and `TimerControlButton` are shared React components used by both the normal running screen and the floating surface.
- The expanded controls are opaque 48 dp circular buttons on one concentric lower orbit around the watchface. Active state is expressed by the button fill and border; no badge overlaps its icon. Long-pressing clock alignment or sound opens the matching running-screen panel.
- The watchface ring reaches the edge of its circular shell. A normal tap returns to Chandas’ running screen; a cue-triggered expansion instead dismisses on tap.
- The collapsed pill shows time to the next bell followed by a compact current-cycle remainder, for example `05:32 • 14m`. At the main bell it collapses to the single end-of-cycle countdown.
- Each delivered visible timer cue expands the background overlay for five seconds, pulses the ring, and then returns to the pill. Hidden-only cues retain the current widget size without a visual pulse. At a collision, any visible cue permits acknowledgement even if a hidden cue wins audio priority. This behavior is native-driven so it works while the app Activity is backgrounded.
- Floating timer appearance is a device setting in System integrations with System, Dark and Light choices. It overrides only the overlay’s React surface. A deliberately undiscoverable long press on either app appearance toggle enables the global monochrome e-ink theme; that mode overrides the widget choice so both surfaces stay visually consistent. A normal appearance tap exits e-ink mode.
- E-ink mode uses a pure white canvas, black primary text and borders, opaque neutral gray secondary tones, and distinct gray shades for cue rings and marks. The app and floating timer suppress decorative gradients, shadows, opacity fades, flashing, and animated transitions; countdown values and ring progress update directly. Selected controls use solid black with white labels, while inactive controls remain outlined. This is a display theme, not an Android hardware refresh-policy setting.
- The expanded e-ink watchface uses its timer ring as the circle edge; its background shell has no additional border. The compact pill retains its outline and uses no press-opacity fade.
- `ChandasFloatingTimer` is registered as a second React surface in the embedded application bundle. `FloatingTimerOverlay` mounts that surface in one `TYPE_APPLICATION_OVERLAY` window owned by the generalized `ChandasCountdownService`.
- The overlay resumes the existing React host with no Activity while its service window is visible, then balances that lifecycle when the background surface closes. Reinitializing the native module is idempotent, so a retained stopped Activity cannot incorrectly hide the overlay.
- The native persisted timer, control state, absolute timestamps, scheduler and service remain authoritative. Overlay actions execute through synchronized native transactions and the foreground app reconciles accepted changes when it resumes.
- Opt-in state and portrait/landscape edge positions are device-global preferences. They do not enter saved configurations or transfer payloads.
- The native contract is version 12 and capability-gates the System integrations UI. Android manifests include `SYSTEM_ALERT_WINDOW`; development and production package IDs keep independent grants.

### 19.2 Intentional implementation adjustment

The 2026-09-28 follow-up removes per-second native snapshots. The overlay derives its visible countdown from the accepted native timestamp and a local second-boundary display tick; native sends structural, control, and cue changes. The presentation service only refreshes the promoted notification when its compact text changes. When the display switches off, the floating React surface is removed until the display returns. The overlay does not schedule cues or create its own timer.

The 2026-10-01 follow-up moves the initial synchronous native snapshot read into the React state initializer, avoiding another native query on each countdown render. Native cue presentation now checks watchface visibility without altering sound, haptics, cue priority, or timing.

### 19.3 Verification evidence

- 2026-10-01 follow-up: TypeScript, all 135 Vitest tests, Android module compilation, and all 56 native unit tests passed locally. Visibility coverage includes hidden-only events, a hidden collision winner with a visible candidate, and a hidden cue at run completion. No device or emulator was connected; pill size, e-ink perimeter and five-second auto-collapse remain pending visual acceptance. This pass creates no remote builds or updates.
- `npm run release:check`: dependency validation, TypeScript and 125 Vitest tests passed.
- `:chandas-timer-service:compileDebugKotlin` and `:chandas-timer-service:testDebugUnitTest` passed.
- Expo Android prebuild completed; merged manifests contain `SYSTEM_ALERT_WINDOW` and the countdown service for `com.yukti.chandas.dev` and `com.yukti.chandas`.
- Local `:app:assembleDebug` and `:app:assembleRelease` completed.
- Pixel 9 API 37 emulator: production install, permission grant, timer start, Activity backgrounding, service persistence, collapsed pill rendering, tap expansion, shared circular watchface rendering and five-second collapse were exercised. The final concentric-orbit, appearance override and cue-expansion checks are included in the next verification pass. No fatal exception appeared in the focused logcat review.
- The live cue countdown updates in place; its fade key excludes the per-second text so the inner label does not flash on every native snapshot.

### 19.4 Remaining manual release checks

- Run the permission deny, revoke and regrant flow on a physical phone and at least one non-AOSP OEM.
- Check drag and edge persistence in portrait and landscape, cutouts, font/display scaling, gesture navigation and TalkBack.
- Exercise every control with Cycle and Sequence sessions, including Stop confirmation, alarm modes, mute state and foreground reconciliation.
- Verify screen off/on, removal from recents, process recreation and reboot restoration on hardware.
- Review the Play Console declaration and reviewer copy before store submission. Publication remains a separate action.
