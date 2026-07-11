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
│  snapLogic.ts (unchanged) → ring + MM:SS countdown (Reanimated/RAF)
│  Config/session/theme  → AsyncStorage
│  Start/Stop            → calls SlotTimerService (native module)
│  Receives "tick" events → pulse animation, resync
└──────────────────────────────────────────────────────────────┘
            │ start(config) / stop() / update(config)   ▲ onTick event
            ▼                                            │
┌─ SlotTimerService (Kotlin, Expo Modules API) ────────────────┐
│  mediaPlayback foreground service + ongoing notification
│  snapLogic ported to Kotlin (~30 lines) → schedules next tick
│  Plays gong/bell (SoundPool/ExoPlayer) at each tick @ volume
│  Optional looping bg music (ExoPlayer)
│  Updates notification "Next gong at HH:MM" each minute
│  Emits onTick to JS
└──────────────────────────────────────────────────────────────┘
```

**Sound ownership:** the native service owns *all* gong/bell playback (foreground and
background), so there's no visible/hidden double-sound coordination like today. JS only
renders the ring + countdown and reacts to `onTick`. Full mute = volume 0 → service plays
nothing, notification still updates.

`snapLogic` lives in **both** JS (for the per-frame UI countdown/ring) and Kotlin (for the
service's sound + notification scheduling), each driven by the same `{mainMs, subMs, phase}`
— mirroring today's split between `App`/`useTimer` and `sw.ts`.

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
| **Audio** | gong.mp3 / bell.mp3 on ticks | native SoundPool/ExoPlayer in service, at in-app volume |
| | 3 bg tracks, loop, live volume/track switch | ExoPlayer in service — now **fully optional & mutable** |
| **Persistence** | config / session (phase,mainMs,subMs) / theme | `@react-native-async-storage/async-storage` |
| **Background** | silent-audio keepalive + wake lock + SW `setTimeout` | **Replaced** by the foreground service |

**Dropped (with rationale):** PiP mini-player (desktop-web API), service worker +
`vite-plugin-pwa` + Workbox (replaced by native service + EAS Update), version
double-tap-force-update.

---

## Dependencies

- `expo` (SDK 54+), `expo-dev-client`
- Custom native module **`SlotTimerService`** (Kotlin, Expo Modules API) — the foreground service
- `expo-audio` — (fallback / or reuse for bg music if we don't do all audio in Kotlin)
- `expo-notifications` — `POST_NOTIFICATIONS` permission + notification channel
- `react-native-svg` — progress ring
- `react-native-reanimated` — pulse + smooth ring
- `@react-native-async-storage/async-storage` — persistence
- `@react-native-community/slider` — volume sliders
- `react-native-safe-area-context` — safe-area insets (replaces CSS `env(safe-area-inset-*)`)
- `expo-font` — JetBrains Mono
- `expo-keep-awake` — screen-on while running & foreground

**`app.json` / manifest:** `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
`POST_NOTIFICATIONS`, `WAKE_LOCK`; foreground-service type `mediaPlayback`; portrait; icons/
splash from existing PNGs; notification channel for the ongoing status notification.

---

## Phases (worklist)

### Phase 0 — Scaffold
- [ ] `create-expo-app` (SDK 54+, TS) into the repo; preserve git history on the branch
- [ ] Install deps (above)
- [ ] Copy `src/lib/snapLogic.ts` and `src/types.ts` **unchanged**
- [ ] Bundle audio assets (gong/bell/bg1-3) for native playback
- [ ] Bare dev build boots on an Android device/emulator

### Phase 1 — Design system + Config screen
- [ ] Theme tokens (`App.css:1-30`) → `theme.ts` + `ThemeProvider`; dark/light toggle
- [ ] `ConfigScreen`, `IntervalPicker`, `SnapConfig`, `CustomMinutePicker` as RN
      (chips = `Pressable`, toggles, bottom-sheet picker), faithful to current look
- [ ] Gong/bell volume slider + notifications toggle
- [ ] Config persisted to AsyncStorage
- [ ] Verify parity vs. running web config screen

### Phase 2 — Running screen + foreground UI
- [ ] `RunningScreen`: SVG ring (`react-native-svg`), pulse (Reanimated), countdown text
- [ ] Volume / track / bg-volume popovers
- [ ] `expo-keep-awake` while running & foreground
- [ ] Session persistence + auto-resume from AsyncStorage
- [ ] JS timer drives ring/countdown from `snapLogic` (visual only)
- [ ] Verify parity vs. running web running-screen

### Phase 3 — `SlotTimerService` foreground service (the payoff)
- [ ] Kotlin Expo module: start/stop/update a `mediaPlayback` foreground service
- [ ] Port `snapLogic` tick math to Kotlin
- [ ] Play gong/bell at ticks via SoundPool/ExoPlayer at the in-app volume
- [ ] Ongoing notification, updated "Next gong at HH:MM" each minute
- [ ] Optional looping bg music (track + volume, live-switchable) — **fully mutable**
- [ ] `onTick` event → JS pulse/resync
- [ ] Start()/Stop() wired from the UI; `POST_NOTIFICATIONS` permission flow
- [ ] Verify: screen off, app swiped away, multi-hour session → gong fires on time; mute = silent

### Phase 4 — Ship
- [ ] `expo-font` JetBrains Mono; icons/splash; `app.json` finalized
- [ ] EAS build (internal / Play internal testing)
- [ ] EAS Update replaces the SW update banner

---

## Known tradeoffs / risks
- **Persistent notification while running** — expected & honest for an active timer (like a
  workout/stopwatch), not intrusive.
- **Battery** — a resident service costs more than idle scheduling; acceptable because the
  work is genuinely ongoing and user-initiated.
- **Verification** — no Android emulator in the cloud container; code migration happens here,
  final on-device verification happens on your machine (or an EAS build).

## iOS, later
iOS forbids foreground services and long-running timers, so the correct iOS path is
**scheduled local notifications** with bundled sounds (the *opposite* primitive). The shared
`snapLogic` schedule makes adding it later straightforward: same tick math, different
delivery. Background chime volume on iOS would be system notification volume (a platform
limitation), and the `audio` background mode is intentionally **not** used (that's the very
keep-alive hack being removed).
