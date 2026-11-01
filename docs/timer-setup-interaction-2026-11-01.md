# Timer setup interaction revision — November 1, 2026

This revision follows the user's review and supersedes the setup presentation in the October 31 goal/audit. The unified scheduler, canonical programs, migration and durable saved/draft/session separation remain in place. The previous interface passed functional checks but did not meet the intended visual simplicity.

## Main screen

- Show the current working timer directly. A new installation has an unsaved working copy and no invented saved configuration. Existing saved records remain intact.
- No “Timer setup” heading, enclosing main modal, Cycle/Sequence selector, separate single-step name, or long settings form.
- Configuration name is at the top and edits in place when tapped. An automatic name follows the main interval; custom names remain custom. The sole step shares this name.
- Top-right three-dot menu opens broader settings and configuration-library actions. Keep default haptics, sound library, alarm defaults/duration, schedule, appearance, Focus and system integrations there, preserving the existing capabilities.
- One interval uses the original Chandas duration pills and familiar sound summary/disclosure row. Optional timer controls live in a horizontal row: run length, clock alignment, volume, haptics and alarm.
- Sub-bells appear as a concise summary and timeline, opening a list sheet. Keep clear feedback about the configured rhythm rather than a collection of expanded forms.

## Steps and sub-bells

- Adding a step changes the main body to compact step cards with name/duration/sound/sub-bell summary and visualizer. Drag handles reorder them. Accessibility reorder actions remain, but visible earlier/later buttons are removed.
- Tapping a card opens a step sheet; it does not replace an editor underneath the cards. Step names are independently editable only in a multi-step timer.
- Sub-bells use list sheet → individual bell sheet → sound picker. Bell names edit inline. Sound and cadence are the default controls. Horizontal action rows reveal color, volume, selected offsets, random gaps, after-start, before-end, visibility and haptic controls.
- Timing-mode controls own cadence enablement; remove the redundant standalone Repeat cadence switch. Preserve dormant values and all supported combinations.
- Dismiss the top layer by tapping its backdrop, dragging down, or using Android Back/Escape/accessibility dismissal. Child dismissal restores its parent context. No generic visible Expand, Collapse or Done toolbar. Explicit business actions such as Save, import, delete confirmation and dirty-switch choices remain.

## Acceptance

Review the actual React Native Web app at phone width, including fresh install, inline rename/default-name behavior, add/edit/reorder steps, modal layering, sound selection, sub-bell modes, dismissal, configuration save/switch/reload and all settings destinations. Inspect rendered screenshots against the original Chandas, Todoist and Google Clock references. Existing timing/storage tests remain required; this is a presentation redesign rather than a new scheduling engine.
