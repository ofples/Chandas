# Timer batch verification — 2026-09-21

Reviewed implementation: `212d92eb36166e5324c2c92cdd0bc5554080661d` on `claude/pwa-to-expo-migration-n3esll`. Scope: specification section 26 (B-01–B-17), the product review's near-term additions, and the shared runtime, storage, transfer and compatibility paths.

## Verdict

**Ready for physical-device acceptance.** The original verification below is retained as the failure record. Its seven reproduced failures and the later source findings have been repaired in the current working tree and the final reconciliation at the end of this report supersedes the earlier source verdict. Tactile, audible, lock-screen, keyboard, large-text and gesture perception still require the manual phone checklist.

This verification adds regression tests and this report, and corrects the specification's acceptance status. It does not change application behavior or dependencies. No publication, installation, settings reset, or commit was performed in this verification pass.

## Checks actually run

| Check | Result |
| --- | --- |
| Initial working tree | Clean |
| TypeScript, `npx tsc --noEmit` | Pass, including the added regression tests |
| Original JavaScript suite | 112/112 pass |
| Original Android timer-service suite | 46/46 pass |
| Added JavaScript acceptance probes | 1 pass, 5 fail; final full suite: 113 pass, 5 fail |
| Added native acceptance probes | 2 fail; final full suite: 46 pass, 2 fail |
| Local `:app:assembleDebug` | Pass |
| Android production-mode JS export, `npx expo export --platform android --output-dir .expo/verification-export` | Pass; Hermes bundle produced |
| `npx expo install --check` | Fail: 15 packages behind Expo's recommended compatible patch versions; this alone does not prove runtime breakage |
| Phone availability | Pixel 10 Pro initially connected; disconnected before attempted UI inspection (`device not found`) |
| Phone logs | Initial filtered recent ReactNativeJS/AndroidRuntime log query returned no entries; this is not proof of successful app execution |
| Interactive/native lifecycle acceptance | Not completed: gestures, keyboard, large text, TalkBack, audible output, perceived vibration, lock screen, Doze, process death, reboot, and permission revocation remain unverified |

The user's manually started server on port 8081 was left running. No separate server was started. No iOS build was attempted on Windows. There is no configured lint script in package.json.

## Reproduced failures

Regression tests assert the intended behavior and deliberately remain red until the implementation is repaired; they do not redefine incorrect behavior as acceptable.

### V-01 — Overnight Quiet resume skips the current morning (P1)

`src/lib/activeHours.ts`, `weeklyBoundary` / `nextActiveHoursStart`: with all-day Active and daily Quiet 22:00–06:00, querying at 01:00 on September 21 returns September 22 at 06:00 rather than September 21 at 06:00. The overnight-end enumeration adds a day but never includes the previous start day. Kotlin enumerates today's end differently. This can give the running UI a wrong resume prediction and delay fallback playback by a day.

### V-02 — Fully suppressed overrides still count as available time (P1)

`src/lib/activeHours.ts`, `hasAvailableTime`: a future Active override completely covered by a mute override returns true through its final `some(active override)` fallback. Native validation rejects resolved empty availability. In JS, a subsequent no-resume result of zero reaches `useTimerV2.scheduleNext`, which lacks the native no-resume guard and can repeatedly schedule a zero-delay timeout. Handle resolved empty schedules consistently and explicitly.

### V-03 — Disabled cadence still determines JS collision priority (P1)

`src/lib/timeline.ts`, `winnerForCandidates`: a repeat-disabled one-off with stored cadence 20 minutes beats an enabled five-minute repeating cue at the same instant. Its missing `cadenceSeconds` falls back to `cadenceMinutes`. Native uses zero priority for a repeat-disabled track, so it selects the other sound. Make the two engines use the same explicit priority.

### V-04 — Sequence compact status omits the step name (P1)

`TimerNotifications.kt`, `forProgram`: real notification calls supply `currentEndsAt` as positive `finalAt`. The first branch calls `compact`, so the Sequence branch is never reached. A Work step with 83 seconds remaining produces `01:23`, not `1:23·Work`. Even the unused Sequence branch forcibly truncates the whole output to seven characters instead of trying the requested string. Fix the branch selection and separate OS truncation policy from the requested presentation.

### V-05 — Cycle end below one minute remains expressed as minutes (P2)

`TimerNotifications.kt`, `compact`: next cue at 12 seconds and cycle end at 43 seconds produces `12s·1m`, not `12s·43s`. The secondary value always rounds to minutes. Retain timestamp-based collapse and use seconds below one minute.

### V-06 — Configuration transfer drops selector visibility (P2)

`src/lib/configuration-transfer.ts`: serialization exports only name, creation date and program. A hidden preset comes back visible. The spec's proposed preservation policy has neither been implemented nor replaced with a documented decision.

### V-07 — Secondary device sounds miss portability warnings (P2)

`src/lib/configuration-transfer.ts`, `programHasDeviceSpecificSounds`: the scan visits only each cue's primary `sound`. A built-in primary plus a document sound in the ordered list reports no device-specific audio. The picker likewise checks availability only for the primary sound. Visit every configured sound.

## Further confirmed source defects and gaps

### V-08 — Preview cancellation protects UI updates, not playback (P1)

`SoundPickerSheet.tsx:78` and `ChandasTimerService.ts`, `previewSound`: the native wrapper awaits built-in asset caching and then starts playback without a cancellation token. Closing the sheet invalidates its request counter, but that check happens only after `previewSound` has already started audio. Background handling stops current audio without invalidating pending cache work. The claim that close/background cannot cause a late preview is false. Cancellation must be checked immediately before starting playback, shared across all callers. Explicit sound selection also uses a toggle based on stale `previewing`, so reselecting the same sound can stop rather than audition it.

### V-09 — Running configuration replacement can discard working edits (P1)

`App.tsx:543`, `switchRunningConfiguration`, calls `loadProgramPreset` after reanchor without consulting the existing `hasUnsavedProgramChanges` safeguard. A modified cue volume or other working edit can be overwritten without a save/discard choice. Session storage has no accepted preset identity field, so restoration cannot independently restore that identity alongside its program snapshot. `saveTimerV2Session` still swallows storage errors.

### V-10 — Native replacement is not fully transactional (P1)

`useTimerV2.ts`, `reanchor`, checks ringing before awaiting sound preparation, but not afterward. An alarm can begin during that wait. `TimerScheduler.start` stops current playback, cancels the event, clears ringing state and begins a new session generation before scheduling succeeds. Rollback restores program/control fields, not the prior ringing playback or sound-order generation. It also leaves Once/Locked state armed when switching to Sequence, contrary to the spec. Guard at native transaction time and define rollback for all runtime state.

### V-11 — Sound order advances too early and terminal playback loses its cursor (P1)

`TimerScheduler.kt:419–441` and `TimerStateStore.kt:119`: ordinary sound selection persists the next index before `playCue` has accepted playback. Complete rejection therefore consumes a selection. A terminal event calls `completeSession`, which clears preferences, before selecting its sound: a bounded run that inherits the main cue's A/B/C list can restart at A on its final bell instead of continuing the order. A rejected replacement also changes the generation. Persist event claim and accepted selection coherently, and resolve terminal selection before clearing its session state.

The JS fallback stores cursors only in hook refs, never session storage, and never resets those refs on explicit restart or configuration replacement. Random mode avoids immediate repetition but implements no shuffle bag; that is a deviation from the proposed default and needs an explicit decision. Native generation-specific keys can accumulate across replacements until the store is cleared.

### V-12 — Haptic overrides bypass global Off in the JS fallback (P1)

`useTimerV2.ts`, `playEvent`: custom overrides call `cueHapticProfile` without testing `activeSettings.haptics.enabled`. Native correctly gates every automatic cue on global enable. `CueHaptics` ignores a false preview result, and Expo multi-pulse previews have no cancellation generation, so pending pulses can overlap or continue after dismissal. General preview fallback has improved, but the complete B-02 contract is not met.

### V-13 — One-off-only setup and previews are incomplete (P1)

No screen exposes `repeatEnabled`, despite support in the data model. A user cannot directly turn repeat off while retaining cadence selection for later. Clearing all Advanced occurrences is not the requested simple control. Setup timelines, track summaries and watch-face timing still read `trackSelectedOffsetsSeconds`; they omit after-start/before-end cues and can display cadence occurrences that have been disabled. Use the compiled effective event set for these views. Out-of-range markers have an inactive message, but preset chips are not filtered by the field's maximum and custom maximums round to whole minutes, so exact-second editing near the boundary remains inconsistent.

### V-14 — Duration drafts can be lost or silently rounded (P1)

`DurationSelector.tsx`, `InlineDurationFields`: clicking sheet Done/Back does not commit or validate its local draft; only Set duration does. Saving while second precision is off explicitly adds zero instead of retaining the stored seconds. A saved 1m30s duration becomes 1m even if the user opens Custom and saves without changing the visible values. This contradicts B-06 and the shared editor contract. The selected nonpreset chip is placed first, but existing preset selections have no scroll-to-selected mechanism.

### V-15 — Hide/reveal gesture ownership is unsafe (P1 source risk; device reproduction pending)

`TimerV2RunningScreen.tsx:135–156`: the root reveals on touch-down, while a nested Pressable later handles release using visibility state. That creates a path for the same reveal gesture to clear mute or immediately hide again. The inner ring Pressable claims to hide controls in its accessibility label but its handler only reveals or unmutes; an ordinary visible ring tap does not explicitly hide. Blank areas outside the visual-stage Pressable do not hide either. Use one gesture decision captured for the full tap and ensure reveal consumes it. TalkBack activation also needs an actual reveal action rather than relying on raw touch events.

### V-16 — Clock/editor edge cases remain unverified or incomplete (P2)

`ClockTimeInput` implements the requested append-digit formatting, but it does not track caret/selection as required for middle edits. Invalid blur restores the previous valid value and can be followed by sheet dismissal; there is no parent validation gate. Sequence minimum sheet height is a fixed 560 logical pixels, potentially conflicting with keyboard-reduced viewport height. The editable field itself now has more width/height and title edits are persisted on typing. Full keyboard, IME, long-title and large-font acceptance still requires device testing.

### V-17 — Drag cancellation is not handled distinctly (P2 source risk)

The new library integrates and bundles, uses stable IDs, and the step editor provides Move earlier/later. In the installed library, the sortable gesture calls onDrop from onFinalize; the integration commits the final index without a cancellation/success check or restoration of the initial order. This does not establish the required cancel-restores-order behavior. Neighbor animation, edge scrolling, repeated drags, the nested Pressable handle, and reduced motion still require device acceptance. A successful build cannot validate these interactions.

### V-18 — Runtime quiet and completion presentation is incomplete (P2)

Running schedule copy still says Resumes/Paused rather than the specified Quiet explanation. A no-resume timer can show No active time with a Resumes caption. The Sequence upcoming-step display wraps to the first step even for a run about to finish. Native completion cancels running/alarm notifications without a distinct meaningful completion notification; the playback foreground notification still uses the generic event wording. Required playback service notification is legitimate, but does not establish the requested completion presentation. Expanded running notification also does not consistently show a separate bounded-session end alongside the current label.

### V-19 — JavaScript late-cue gate differs from native (P1)

`useTimerV2.ts:400`: nonterminal delivery checks the scheduled timestamp and freshness, without checking whether a non-boundary cue was actually delivered after Quiet began. Native explicitly suppresses that case. A cue scheduled just before 09:00 but delivered at 09:00:00.500 can leak into Quiet in the JS fallback. The exact closing-bell exception should remain, while ordinary delayed cues use the same delivery-time gate as native.

## Requirement-by-requirement acceptance

“Partial” means code exists but at least one acceptance condition fails. “Pending” does not mean passed.

| Requirement | Assessment |
| --- | --- |
| B-01 hide controls | Partial; V-15, device/TalkBack pending |
| B-02 haptics | Partial; native inheritance and fallback exist, V-12, physical perception pending |
| B-03 sound audition | Partial; selection initiates preview, V-08 |
| B-04 status | Fail; two reproduced native failures, V-04/V-05 |
| B-05 duration selection | Partial; custom chip and separate action exist, selected preset scrolling absent |
| B-06 single duration editor | Partial; nested modal removed, draft/seconds defects V-14 |
| B-07 cue timing | Partial; compiled one-offs exist, repeat-off UI/preview missing, V-03/V-13 |
| B-08 title dimensions | Source improvements present; keyboard/large text pending, V-16 |
| B-09 title Done | Saves as typed; explicit title/duration draft controller absent, blur/delete race pending |
| B-10 clock input | Shared component and append formatting present; caret/invalid-dismiss behavior incomplete |
| B-11 list/actions | Outside handle, padding and confirmed Delete present; phone visual acceptance pending |
| B-12 drag/drop | Native build and JS bundle pass; cancellation gap and gestures pending |
| B-13 snap selection | Null unsnapped state fixed in source; transactional failure paths still need V-10 repair/testing |
| B-14 active/quiet | Daytime subtraction probe passes; overnight and availability probes fail, V-01/V-02/V-19 |
| B-15 running selector | Partial; visibility/name picker present, unsaved/transaction/restoration issues V-09/V-10 |
| B-16 notifications | Routine scheduler posts removed; required service remains; meaningful completion unresolved |
| B-17 sound lists/actions | Duplicate/Delete and ordered lists present; ordering, transfer, and fallback gaps V-06/V-07/V-11 |
| Near-term upcoming-event preview | Existing next-cue/step display present; one-off setup visuals and terminal Sequence preview incomplete |
| Near-term quiet/mute explanations | Mute duration copy exists; Quiet/no-resume copy incomplete |
| Near-term optional starter configurations | Four opt-in presets implemented; no automatic seeding; not phone-tested |
| Near-term explicit vibration-only | Model/UI/native suppression present; global-Off fallback defect and perception pending |

## Reproduction and next verification gate

Run `npm test` for the five retained JS failures in `src/lib/__tests__/timer-batch-verification.test.ts`. Run `android/gradlew.bat :chandas-timer-service:testDebugUnitTest` from the android directory for the two retained native failures in `BatchVerificationProbeTest.kt`. These tests check the intended spec behavior.

Repair runtime parity, transactional switching, sound-order lifetime, preview cancellation and editing data loss first. Then rerun the focused regression suites, TypeScript, Expo compatibility check, Android export and native build. Follow with the existing manual acceptance checklist on the phone, particularly hidden-muted reveal, title/clock editing with keyboard open, drag cancellation/edge scroll, audible exact closing bells, haptic perception and process restoration. Do not mark these manual rows passed from build or source evidence alone.

For subsequent installed test builds, use the user's requested separate development identity (`com.yukti.chandas.dev`, Chandas Dev). The currently reviewed configuration still uses the production package ID and versionCode 1 in the generated debug project. Changing that was not part of this verification pass.

## Follow-up remediation — 2026-09-21

The editor feedback pass resolved the seven retained acceptance-probe failures and several findings above. Current automated results are 121/121 JavaScript tests, 48/48 native unit tests, a clean TypeScript check, and a successful local `:app:assembleDebug` build using the separate `com.yukti.chandas.dev` identity.

Resolved in this pass:

- V-01/V-02: future availability now evaluates the resolved active-minus-Quiet timeline, including the end of an overnight Quiet range carried in from the previous day.
- V-03: one-off-only tracks no longer inherit their stored disabled cadence as collision priority.
- V-04/V-05: Sequence compact status uses the real step deadline with countdown first; distinct Cycle end deadlines below one minute use seconds.
- V-06/V-07: configuration transfer preserves `showInRunningSelector` and scans every sound in a cue's ordered/random list for device-specific references.
- V-12: automatic JS fallback overrides now obey global Haptics Off. Fallback previews use a generation guard and Android previews cancel the prior waveform before starting the selected profile.
- V-13: Repeat every has an independent switch, and setup counts/summaries use effective compiled events including after-start/before-end cues.
- V-14: elapsed duration editing has returned to a focused sheet with one right-filled timer input, including second precision. Schedule clock input commits valid values on every digit and refuses invalid 24-hour drafts.

The source-risk and physical-device findings V-08–V-11 and V-15–V-19 remain subject to their own implementation/manual gates except where explicitly resolved above. The phone disconnected before the fresh APK could be installed, so this update does not claim tactile haptic differences, keyboard layout, modal spacing, animation appearance, or drag behavior as physically accepted.

## Final reconciliation — 2026-09-21

All V-01 through V-19 source findings are resolved or reduced to the explicit physical-device acceptance rows below:

- V-08: preview generation now lives in the shared sound service. Close, background, a newer preview, timer Start and real timer/alarm delivery invalidate pending asset work before playback. Selection auditions no longer use toggle semantics.
- V-09/V-10: running switches ask before discarding unsaved work and submit program, settings and saved identity together. Session restore retains the accepted identity/settings. JS rechecks ringing after asset preparation; synchronized native Start rejects ringing replacements, restores the prior sound generation on rollback and clears Cycle alarm state for Sequence.
- V-11: native sound selection peeks before terminal cleanup and commits only after playback handoff. JS commits after a usable source starts, persists sequence/random state and resets it for a deliberate restart or switch.
- V-15/V-18/V-19: reveal has one dedicated gesture surface, visible timer taps hide controls, mute clearing stays explicit, no-resume copy is coherent, terminal Sequence preview does not wrap, completion uses distinct notification copy, expanded notifications retain the bounded end, and JS uses the same scheduled/delivered-time gate as native while preserving the exact closing bell.
- V-16: invalid 24-hour values are rejected, duration confirmation works with the keyboard open, and hidden exact seconds are retained. Caret behavior, IME variants and large-font layout remain device checks.
- V-17: the shared drag dependency is patched at installation so cancelled gestures restore the initial positions and do not call the commit callback. Neighbor animation, edge scrolling and touch arbitration remain device checks.

Final automated evidence:

| Check | Final result |
| --- | --- |
| `npx expo install --check` | Pass after SDK 57 compatible patch updates |
| `npx tsc --noEmit` | Pass |
| `npm test` | 123/123 pass |
| Android timer-service unit tests | 48/48 pass |
| Android development APK | Pass; `com.yukti.chandas.dev` |
| Android release APK | Pass; `com.yukti.chandas` |

The remaining gate is hands-on testing of vibration feel, audible output, lock screen/Doze/process restoration, keyboard and large text layout, TalkBack, drag/scroll/swipe behavior, and exact schedule-boundary delivery on a physical phone. These are not inferred from compilation or unit tests.
