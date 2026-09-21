# Chandas Timer v2 HTML mockup

Open `index.html` directly in a browser. No package installation, server, or build step is required.

## Purpose

This is a presentation-level prototype for the Timer v2 flows defined in `../../docs/timer-v2-spec-and-log.md`.

It covers:

- Pattern configuration and sub-bell summaries.
- Trigger grid selections and track-order overlap precedence.
- Immutable saved configurations.
- Sequence ordering and drag-handle treatment.
- Master/per-cue Mixer with preserved cycle/minute mute choices.
- Built-in, Android, and device sound sources.
- Pattern and Sequence running states, including nested Pattern progress rings.
- Alarm Off/Once/Locked appearance.
- Chandas Focus state language.
- Help and long-press tooltips.

## Prototype-only interactions

- Use the left rail—or the bottom rail on small screens—to inspect flows.
- Left and right arrow keys move between screens.
- Load/Edit/Mixer/Sound/Help buttons navigate to their proposed surfaces.
- Save As opens a native HTML dialog.
- Trigger cells can be tapped or drag-painted; Clear, Select all, and quick-choice chips update for visual inspection.
- On Pattern Running, single-click Alarm to show Once and double-click to show Locked.
- Hold or hover a running control briefly to show its tooltip.

The prototype does not implement timer math, persistence, sound, Android pickers, DND, real drag-and-drop, haptics, exact alarms, or production validation.

## Visual thesis

> A quiet instrument panel: near-black surfaces, precise mono numerals, and a single violet rhythm signal.

The presentation frame around the phone is not part of the app. The UI inside the phone follows Chandas's existing dark tokens and minimal control language.
