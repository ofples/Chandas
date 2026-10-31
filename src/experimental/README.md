# Unified timer setup prototype

This is an isolated React Native setup experiment. Run it with `npm run prototype:web` or `npm run prototype:android`. The normal app entry remains the default unless `EXPO_PUBLIC_SETUP_PROTOTYPE=1` is selected by the prototype launcher.

## Interaction coverage

- A directly editable single interval and a multi-step sequence with compact rows, reorder controls, add, duplicate, and remove.
- Per-step end cues and alarms; per-step sub-bell tracks with independently enabled cadence occurrences, random gaps, after-start offsets, and before-end offsets. Ring visibility is separate from whether a cue plays.
- Shared sound picker, imported-sound library, ordered or randomized sound choices, cue volume, cue haptic overrides, sub-bell colors, and occurrence selection.
- Whole-round elapsed or clock alignment; continuous, round-count, or exact-duration runs with an optional final gong.
- Horizontal labelled option chips for overall volume, active/quiet schedule windows, run length, haptic profiles, alarm settings, final gong, widget appearance, notifications, call muting, and focus preferences. Enabled controls remain visible in the main sheet after switching or reopening.
- A draggable partial/full sheet, explicit expand/done actions, keyboard-aware scroll content, focused step editing, and a setup review notice.
- Prototype-only saved configurations, rename, duplicate, confirmed deletion, import, export-to-clipboard, save, save-as, and save/keep/discard switching. A kept draft can be selected again from the configuration picker. Compact cards disclose their actions and the retained “Show while running” preference through their action button.

## Data and limitations

Prototype data uses only the `chandas.experimental-unified-setup.v1` AsyncStorage key and a separate schema. Loading completes before edits or writes are enabled. Configuration snapshots and the imported sound library never enter production timer state.

The review button only shows a notice. No real timer is started, no production configuration is migrated, and notification, call-mute, exact-timing, focus, and overlay choices do not request or grant device permissions. The widget's System/Dark/Light appearance is a prototype preference and is not applied to a native widget. Production timer integration and permission/device acceptance remain out of scope.

The setup uses the existing Chandas duration, cue, sound picker, schedule, haptics, clock-alignment, color, toggle, and theme components. `PrototypeSheet.tsx` is experimental-only and leaves the shared sheet untouched.

## Local review

From this worktree, run `npm ci`, then `npm run prototype:web -- --port 8091`. Open `http://localhost:8091`. The prototype begins with the setup expanded. Use the handle or Collapse/Expand controls to try the partial view; Done dismisses the sheet, and Open setup restores it. The configuration name and Save controls remain pinned while the contents scroll.

Create a configuration with Save, then Save as to make a second one. Edit one, select the other through the name at the top, and try each switch decision. Keep draft retains those changes when returning or reloading. Sub-bell rows expand individually; their horizontal action strip reveals optional timing, appearance and vibration controls. Already enabled timing controls remain visible together.

The prototype branch starts at `469019b` (the 2.2.4 release preparation and latest widget fixes). The regular entry point and existing running screen remain available without the prototype environment flag.

## Validation — 2026-10-31

- TypeScript passes. All 143 Vitest tests pass, including eight prototype model tests covering saved snapshots, kept/discarded drafts, unnamed drafts, imports, shared sounds, fresh versus duplicated steps, saved selector metadata, and invalid records.
- React Native Web browser checks pass for save/save-as, cancelled switching, kept/discarded drafts, reload persistence, retained enabled options, combined sub-bell timing, hidden-but-enabled cues, names committed before Done, partial/full sheet buttons, pointer dragging in both directions, light/dark themes, 320 px viewport fit, and absence of production storage writes. The configuration picker is an expandable sheet with compact cards and disclosed actions.
- An Android x86_64 debug APK assembled successfully and installed on the emulator. Final interaction review uses React Native Web; native sheet gestures and keyboard behavior are not accepted by the build result.
- The aggregate `npm run release:check` stops at Expo's dependency compatibility check: eight existing packages are behind its current recommended patch versions. The prototype adds no dependency changes. Dependency updates are separate work.
- Timer execution, Android permission requests, production storage migration and physical-device audio/e-ink verification are deliberately outside this setup experiment.
