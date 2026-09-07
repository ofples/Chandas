# Native release audit — 2026-09-07

This is the release gate for the next Android binary. It covers the checked-in
Expo module, manifest/config plugin, native persistence and scheduling,
background audio, notification/Focus integrations, app-to-native bridge, and
EAS runtime compatibility. Generated `android/` output is not source-controlled;
EAS regenerates it from these inputs.

## Confirmed findings

| ID | Severity | Finding | Status | Resolution commit |
| --- | --- | --- | --- | --- |
| N-01 | Critical | Android is pinned to an old manual runtime ID despite incompatible contract-v10 native changes, allowing an old and new binary to share unsafe OTA code. | Resolved | `Restore fingerprint-safe Android updates` |
| N-02 | High | The Chandas notification-icon plugin runs before `expo-notifications`, so the later plugin overwrites the intended circular default icon. | Resolved | `Preserve the circular notification icon` (official plugin now receives the circular source too) |
| N-03 | Critical | Native active-hours delivery accepts an arbitrarily stale cue whenever delivery happens during an active window. Missed bells can replay much later. | Open | — |
| N-04 | High | A bounded native program validates only the presence of `timerV2EndsAt`, not equality with the deadline derived from its run policy. | Open | — |
| N-05 | Critical | Start, update, stop, restore, and exact-alarm delivery are multi-step state transactions without a shared lock. Interleaving can revive a stopped schedule or start sound after Stop. | Open | — |
| N-06 | High | Bridge event listeners execute inline without fault isolation. A stale/throwing listener can interrupt native cleanup, scheduling, or cue delivery. | Open | — |
| N-07 | High | Local-clock programs depend on the manifest `DATE_CHANGED` broadcast for daily re-phasing, but modern Android does not exempt that implicit broadcast for manifest receivers. | Open | — |
| N-08 | Critical | One-shot bells/gongs outlive `BroadcastReceiver.goAsync()` (packaged sounds reach 18.24 seconds) but have no service lifetime. Android may reclaim the process and cut them off or omit them. | Open | — |
| N-09 | Medium | Bridge/native validation permits non-finite volume values and imported remote URI schemes. This can persist unusable state or make an imported configuration initiate network media access. | Open | — |

## Reviewed and currently acceptable

- Exact alarms use alarm-clock delivery for audible cues, with the required
  Android permissions and a fail-closed path if exact access disappears.
- The repeating alarm runs in a media-playback foreground service, owns audio
  focus, maintains its wake lock, and restores/dismisses from persisted state.
- The Android 16 live countdown uses the standard promoted-notification shape,
  a dedicated `specialUse` foreground service, and a platform chronometer
  fallback.
- Focus/DND integration uses an owned condition-provider rule and separates
  timer stop from Android's user-managed paused state.
- Timer state uses synchronous persistence for schedule-critical writes and a
  session generation plus logical event identity to reject obsolete alarms.
- Boot, package replacement, timezone, and manual wall-clock changes enter the
  same restore/reconciliation path.
- Native schema ceilings exceed the UI limits and reject future program schema
  versions rather than guessing.
- Sound assets have packaged fallbacks, and OTA-added built-ins are copied into
  app-private storage with atomic replacement.

## Verification constraints

Repository policy forbids local Gradle/native builds on this computer. Every
fix will therefore receive the strongest available source-level verification:
pure Kotlin tests where the logic permits it, TypeScript compilation, JavaScript
tests, Expo config/autolinking inspection, and whitespace/diff checks. The final
remote EAS build and physical-device matrix remain mandatory before promotion.

## Required device matrix after the remote build

- Start, update, optimistic Stop, immediate restart, and repeated Stop while a
  cue is beginning; verify no later cue or notification is resurrected.
- Pattern and Sequence cues in foreground, background, screen-off, Doze, after
  process reclamation, and after reboot.
- Packaged 18-second bell, 11-second gong, device ringtone, and document sound;
  verify complete playback and immediate cancellation on Stop.
- Active-hours opening/closing boundary, a stale alarm delivered more than five
  seconds late, overlapping windows, and an overnight window.
- Local-clock cycles across midnight, manual clock change, timezone change, and
  a daylight-saving transition.
- Continuous, cycle-bounded, and duration-bounded runs, including a custom end
  gong and restored state.
- Alarm over the lock screen, alarm dismissal from screen and notification,
  notification permission denied, DND access revoked, and an active phone call.
- Android 16 promoted countdown enabled/disabled and the notification/status
  icon in light and dark system themes.
