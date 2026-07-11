# SlotTimer — PWA → Expo (React Native) migration

**Goal:** Turn the current Vite PWA into a native Expo/React Native **Android** app that
stays alive in the background via a **proper foreground service** — no more silent
background-music keep-alive hack — so the timer is rock-solid with the screen off and the
app can be **fully muted**. All features preserved; UI looks the same.

**Scope decision:** **Android-first.** iOS is deferred (see "iOS, later"). Leaving Expo Go
behind is accepted — this needs a **development build** (`expo-dev-client` + EAS).

---

## Why a foreground service (not scheduled notifications) on Android

The tick times are pure math (`snapLogic.ts` — a function of `phase`, `mainMs`, `subMs`),
so the schedule is fully known at Start. But scheduled-notification delivery on Android has
real gaps in exactly this app's scenario (long, screen-off sessions):

- The pre-scheduled window is finite (~64) and **can't be replenished if the app is killed**.
- Doze + OEM task-killers cancel alarms on swipe-away.
- Exact alarms need `SCHEDULE_EXACT_ALARM`, which Play restricts to alarm/clock apps.
- Notification-sound volume is **system-controlled** → the in-app volume slider wouldn't work.

A **`mediaPlayback` foreground service** fixes all of it: it keeps a real process alive
through Doze, resists being killed (ongoing notification), replenishes forever, plays the
**real gong via native audio at the user's chosen volume**, and needs **no exact-alarm
permission**. This is the OS-blessed primitive for "ongoing task the user started and can
see" — which is exactly what a running interval timer is.

**Mental model:** the current service worker (`sw.ts`) becomes a real Android foreground
service — same `{mainMs, phase}`-driven scheduling it already does, but as a resident
service that also plays audio and updates an ongoing notification.

---

## Architecture

```
┌─ JS / React Native (UI thread) ──────────────────────────────┐
│  snapLogic.ts (unchanged) → ring + MM:SS countdown (RAF loop)
│  Config/session/theme  → AsyncStorage
│  Start/Update/Stop     → calls SlotTimerService (native module)
└──────────────────────────────────────────────────────────────┘
            │ start(config) / update(partial) / stop()
            ▼
┌─ SlotTimerFgService (Kotlin, Expo Modules API) ───────────────┐
│  mediaPlayback foreground service + ongoing notification
│  TimerMath.kt — snapLogic ported verbatim → schedules next tick
│  Plays gong/bell (MediaPlayer) at each tick @ in-app volume
│  Optional looping bg music (MediaPlayer)
│  Updates notification "Next gong at HH:MM" each minute
└────────────────────────────────────────────────────────────────┘
```

**Sound ownership:** the native service owns *all* gong/bell/bg-music playback while a
session is running (started the moment the user taps Start, not only once backgrounded —
matching how a real workout-timer foreground service behaves), so there's no
visible/hidden double-sound coordination like today. Full mute = volume 0 → service plays
nothing, notification still updates.

**No tick-event IPC needed.** `snapLogic`/`TimerMath` live in **both** JS (for the
per-frame ring/countdown) and Kotlin (for the service's sound + notification scheduling),
each computed independently from the same `(mainMs, subMs, phase)` and `Date.now()`/
`System.currentTimeMillis()`. Because the schedule is pure math with no shared mutable
state, the two sides can never drift and never need to exchange tick events to stay in
sync — only `start`/`update`/`stop` cross the JS↔native bridge.

**JS-side fallback:** `src/hooks/useTimer.ts` calls the native service via
`src/native/SlotTimerService.ts` (`requireOptionalNativeModule`) when it's linked. If it
isn't (mid-development, or a future iOS build), the hook falls back to playing
gong/bell/bg-music itself via `expo-audio` in the foreground only — accurate while the app
is open, with no background guarantee. This is what makes Phases 0–2 independently
testable before Phase 3's native module exists.

---

## Feature inventory → native mapping

| Area | Feature | Native mapping |
|---|---|---|
| **Timer math** | `snapLogic.ts` (`nextTick`/`nextSubTick`/`lastMainTick`/`mainProgress`/`formatCountdown`) | **Copy verbatim** to JS; **port to Kotlin** for the service |
| **Config** | Main interval (10/15/30 + custom 1–240) | RN pill chips + bottom-sheet picker |
| | Sub interval (5/10/15 + custom < main) + on/off toggle | same |
| | Snap-to-clock toggle + offset (:00/:10/:15 + custom 0–59) | same |
| | Gong/bell volume slider | `@react-native-community/slider` |
| | Notifications on/off toggle | toggles the ongoing-notification importance / heads-up |
| | Dark/light theme toggle | theme context + `StyleSheet`; `data-theme` → theme object |
| | Version label + double-tap force-update | **Drop** (SW-specific); show app version, updates via EAS Update |
| **Running** | SVG progress ring + pulse-on-gong | `react-native-svg` + `react-native-reanimated` |
| | Main + sub countdown (MM:SS, ♪), JetBrains Mono | `<Text>` + `expo-font` |
| | Gong/bell volume popup | RN slider popover |
| | Bg track picker (Ocean / 432hz / Lofi) | RN popover → tells service which track |
| | Bg volume popup | RN slider popover |
| | **PiP mini-player** (`usePip`, `documentPictureInPicture`) | **Drop** — desktop-web-only API; no mobile-native equivalent |
| | Stop button | stops the foreground service |
| | **New:** Restart/snap button | not in the legacy web app — see below |
| **Audio** | gong.mp3 / bell.mp3 on ticks | native SoundPool/ExoPlayer in service, at in-app volume |
| | 3 bg tracks, loop, live volume/track switch | ExoPlayer in service — now **fully optional & mutable** |
| **Persistence** | config / session (phase,mainMs,subMs) / theme | `@react-native-async-storage/async-storage` |
| **Background** | silent-audio keepalive + wake lock + SW `setTimeout` | **Replaced** by the foreground service |

**New beyond the legacy app:** a contextual button on the running screen next to the
Stop button. When the session is snapped to the clock it reads "Restart (unsync)" — tapping
it sets `snapEnabled = false` and re-anchors the phase to `now % mainMs` (a fresh full-length
interval starting immediately). When it isn't snapped, it reads "Snap to clock" — tapping it
sets `snapEnabled = true` and re-anchors the phase to `snapOffset * 60_000` (the configured
clock alignment), taking effect immediately. Implemented as `useTimer`'s `resyncPhase(newPhase)`
— a lightweight re-anchor (updates the session, JS display, and pushes `{ phase }` to the
native service via `update()`) that doesn't tear down keep-awake, players, or permissions the
way a full `stop()`/`start()` would.

**Dropped (with rationale):** PiP mini-player (desktop-web API), service worker +
`vite-plugin-pwa` + Workbox (replaced by native service + EAS Update), version
double-tap-force-update.

---

## Dependencies

- `expo` SDK 57, `expo-dev-client` (Expo Go is left behind — required for the custom native module)
- Local Expo module **`modules/slot-timer-service`** (Kotlin) — `SlotTimerFgService` (the
  foreground service) + `SlotTimerServiceModule` (the JS bridge); autolinked automatically
  since it lives under `modules/` — verified via `npx expo-modules-autolinking resolve --platform android`
  and `npx expo prebuild --platform android` (see Verification below)
- `expo-audio` — JS-side fallback playback when the native module isn't linked
- `expo-notifications` — requests `POST_NOTIFICATIONS` before starting the service
- `react-native-svg` — progress ring
- `react-native-reanimated` — installed for future animation polish (current pulse uses core `Animated`)
- `@react-native-async-storage/async-storage` — persistence
- `@react-native-community/slider` — volume sliders
- `react-native-safe-area-context` — safe-area insets (replaces CSS `env(safe-area-inset-*)`)
- `@expo-google-fonts/jetbrains-mono` + `expo-font` — JetBrains Mono (300/400)
- `expo-keep-awake` — screen-on while running

**`app.json` / manifest:** `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
`POST_NOTIFICATIONS`, `WAKE_LOCK` (top-level, via `app.json:expo.android.permissions`); the
module's own `AndroidManifest.xml` declares `<service android:foregroundServiceType="mediaPlayback">`,
merged into the app manifest by the Android Gradle Plugin at build time; portrait; icons/
splash from existing PNGs; notification channel (`slottimer-running`, `IMPORTANCE_LOW` —
silent, since the service plays the gong itself rather than relying on notification sound).

---

## Phases (worklist)

### Phase 0 — Scaffold ✅
- [x] Expo SDK 57 TS app scaffolded at repo root; legacy PWA preserved under `legacy-web/`
- [x] Install deps (above)
- [x] Copy `src/lib/snapLogic.ts` and `src/types.ts` **unchanged**
- [x] Bundle audio assets (gong/bell/bg1-3) under `assets/sounds/` for native playback
- [ ] Bare dev build boots on an Android device/emulator — **needs a real device/emulator**, see Verification

### Phase 1 — Design system + Config screen ✅
- [x] Theme tokens (`legacy-web/src/App.css:1-30`) → `src/theme/tokens.ts` + `ThemeContext`; dark/light toggle
- [x] `ConfigScreen`, `IntervalPicker`, `SnapConfig`, `CustomMinutePicker` as RN
      (chips = `Pressable`, custom `Toggle`, bottom-sheet `Modal` picker), faithful to current look
- [x] Gong/bell volume slider + notifications toggle
- [x] Config persisted to AsyncStorage
- [ ] Verify parity vs. running web config screen — needs a device/simulator

### Phase 2 — Running screen + foreground UI ✅
- [x] `RunningScreen`: SVG ring (`react-native-svg`), pulse (`Animated`), countdown text (JetBrains Mono)
- [x] Volume / track / bg-volume popovers
- [x] `expo-keep-awake` while running
- [x] Session persistence + auto-resume from AsyncStorage (async bootstrap in `App.tsx`)
- [x] JS timer drives ring/countdown from `snapLogic` (visual only, always JS-side)
- [ ] Verify parity vs. running web running-screen — needs a device/simulator

### Phase 3 — `SlotTimerService` foreground service (the payoff) ✅ code complete
- [x] Local Expo module `modules/slot-timer-service`; Kotlin `SlotTimerFgService`
      start/update/stop a `mediaPlayback` foreground service
- [x] `TimerMath.kt` — `snapLogic` tick math ported verbatim
- [x] Gong/bell playback via `MediaPlayer` at ticks, at the in-app volume; silent when volume is 0
- [x] Ongoing notification (`NotificationCompat`), updated "Next gong at HH:MM" each minute;
      falls back to a minimal "Timer running" body when the in-app notifications toggle is off
      (Android requires *some* ongoing notification for any foreground service — OS constraint,
      not an app choice)
- [x] Optional looping bg music (track + volume, live-switchable via `update()`) — **fully mutable**
- [x] `start()`/`update()`/`stop()` wired from `useTimer.ts`; `POST_NOTIFICATIONS` requested
      via `expo-notifications` before starting
- [x] JS/Kotlin need no tick-event IPC — both derive ticks independently from the same phase
- [x] Verified in this container: `tsc --noEmit` clean, `expo-doctor` 20/20,
      `expo prebuild --platform android` succeeds, `expo-modules-autolinking resolve` correctly
      discovers and links the module's Kotlin class
- [ ] **Not verified here** (no Android SDK/emulator in this container): actual Gradle/Kotlin
      compilation, on-device behavior (screen off, app swiped away, multi-hour session, mute).
      See Verification below.

### Phase 4 — Ship
- [x] `expo-font` + `@expo-google-fonts/jetbrains-mono`; `app.json` name/permissions/plugins finalized
- [x] Icons/splash/adaptive-icon regenerated from SlotTimer's actual mark (`legacy-web/public/icon-512.png`
      → `assets/icon.png`, `android-icon-foreground.png`, `android-icon-monochrome.png`, `splash-icon.png`,
      `favicon.png`); adaptive icon background uses the flat `#0b0c10` brand color (no image needed)
- [x] `expo-splash-screen` installed and configured (dark `#0b0c10` background + the mark)
- [x] `eas.json` build profiles (development/preview/production)
- [ ] `eas init` / account link — **needs the user's Expo account**, not something this session can do
- [ ] EAS build (internal / Play internal testing) — needs the account link above, then a real device/CI run
- [ ] EAS Update replaces the SW update banner — set up alongside the first EAS build

---

## Phase 5 — Alarm mode (added beyond the original plan)

A toggle (in `ConfigScreen` and on `RunningScreen`) that turns the main gong into a
continuous, dismissable alarm instead of a one-shot chime — full-screen overlay, wakes the
screen, rings until dismissed. Two decisions made with the user before building this:
**bundle a custom alarm sound** (rather than the system default), and go straight for
**full alarm-clock behavior** (screen-wake + lock-screen display via a full-screen-intent
notification) rather than a notification-only v1.

- [x] `TimerConfig.alarmModeEnabled` (persisted), toggle in `ConfigScreen` and `RunningScreen`
- [x] Placeholder alarm sound: **synthesized**, not sourced — `assets/sounds/alarm.wav`, a
      plain three-beep pattern generated with Python's stdlib `wave` module (no licensed audio
      available in this environment). **Swap this for a real alarm sound before shipping** —
      it's a functional stand-in, not final audio.
- [x] `SlotTimerFgService`: on the main tick, alarm mode starts a **looping** `MediaPlayer`
      (`USAGE_ALARM`/`CONTENT_TYPE_SONIFICATION`) and *pauses* normal tick scheduling — no
      ticks are missed, they simply resume from `stopAlarmRinging()` since `TimerMath.nextTick`
      always computes the next tick from current wall-clock time regardless of how long the
      alarm rang
- [x] Escalated `slottimer-alarm` notification channel (`IMPORTANCE_HIGH`, distinct from the
      ordinary silent `slottimer-running` channel): "Stop alarm" action button, full-screen
      intent, `CATEGORY_ALARM`/`PRIORITY_MAX`. Guarded by `NotificationManager
      .canUseFullScreenIntent()` on API 34+ — if not granted, the notification still rings and
      is dismissable, it just won't force the screen on (graceful degradation, not a crash)
- [x] `AlarmWindowHelper.kt` (plain Kotlin object) calls `Activity.setShowWhenLocked`/
      `setTurnScreenOn` (or the pre-API-27 window-flag equivalent) + `requestDismissKeyguard`
      when MainActivity is launched/resumed with the alarm-ringing intent extra
- [x] **Config plugin** (`modules/slot-timer-service/app.plugin.js`, referenced in `app.json`
      by relative path since this is a local, not installed, module) injects two calls to
      `AlarmWindowHelper` into the generated `MainActivity.kt` — once in `onCreate` (cold
      launch) and once in a newly-added `onNewIntent` override (already-running app brought to
      front) — via `@expo/config-plugins`' `withMainActivity` + `mergeContents`, tagged so
      re-running `expo prebuild` is idempotent. **Verified in this container**: `expo prebuild`
      applies the merge cleanly and the resulting `MainActivity.kt` reads as valid Kotlin (not
      compiled — no Android SDK here, see Verification)
- [x] `onStartCommand` guards against a config `START`/`UPDATE` disturbing an in-progress ring
      (it only remembers the new config for when the alarm is eventually dismissed) — otherwise
      reopening the app while ringing would silently cut the alarm short
- [x] JS: `isAlarmRinging`/`dismissAlarm` exposed from `useTimer`, synced via a synchronous
      `isRinging()` query (cold-start/resume — covers the "app was killed, relaunched from the
      alarm notification" case) plus a live `onAlarmStateChanged` event subscription
- [x] Same behavior implemented in the **JS fallback path** too (looping `expo-audio` alarm +
      local ringing state) for when the native module isn't linked — foreground-only, no
      lock-screen wake, but functionally consistent
- [ ] `USE_FULL_SCREEN_INTENT` is exactly the kind of permission Play Store scrutinizes for
      apps that aren't obviously alarm/calling apps (same category as the exact-alarm gray area
      discussed earlier in this doc) — worth revisiting before submitting for review

---

## Verification

**What was verified in this cloud container** (no Android SDK, no emulator, no `kotlinc`
available — see below): `tsc --noEmit` across the whole app (clean), `expo-doctor` (20/20
checks), and `npx expo prebuild --platform android` (succeeds — generates the native project,
confirms `expo-modules-autolinking resolve --platform android` discovers
`modules/slot-timer-service` and correctly resolves its Kotlin module class, and confirms the
alarm-mode config plugin's `MainActivity.kt` merge applies cleanly). The generated `android/`
project was deleted again each time since it's CNG-managed (gitignored, regenerated by
`prebuild`/`expo run:android`).

**What still needs a real device or emulator** (this container has Java + Gradle but no
Android SDK/platform tools, so Gradle can't actually compile or run anything Android):
1. `npx expo run:android` — first real Gradle/Kotlin compile of `SlotTimerFgService.kt` /
   `SlotTimerServiceModule.kt` / `AlarmWindowHelper.kt`. This is genuinely unbuilt code; treat
   the first build as a normal native-module bring-up (Kotlin API mistakes are the most likely
   thing to fix).
2. On-device behavior: screen off, app swiped away, multi-hour session → gong still fires on
   time via the foreground service; mute (volume 0) → truly silent while the ongoing
   notification keeps updating; live volume/track/bg-volume changes while running.
3. Alarm mode specifically: does the full-screen intent actually wake the screen and show the
   Dismiss overlay over the lock screen on a real device (behavior varies by OEM — some
   heavily restrict full-screen intents regardless of the permission); does "Stop alarm" from
   the notification work with the screen off; does dismissing correctly resume normal ticking.
4. Visual parity of `ConfigScreen`/`RunningScreen` against the running legacy web app.

## Known tradeoffs / risks
- **Persistent notification while running** — expected & honest for an active timer (like a
  workout/stopwatch), not intrusive.
- **Battery** — a resident service costs more than idle scheduling; acceptable because the
  work is genuinely ongoing and user-initiated.
- **Notification icon** — `SlotTimerFgService` currently uses `applicationInfo.icon` as the
  small icon; Android wants a dedicated monochrome/transparent notification icon asset for a
  polished look (Phase 4 item).

## iOS, later
iOS forbids foreground services and long-running timers, so the correct iOS path is
**scheduled local notifications** with bundled sounds (the *opposite* primitive). The shared
`snapLogic` schedule makes adding it later straightforward: same tick math, different
delivery. Background chime volume on iOS would be system notification volume (a platform
limitation), and the `audio` background mode is intentionally **not** used (that's the very
keep-alive hack being removed).
