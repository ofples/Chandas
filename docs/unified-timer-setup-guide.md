# Timer setup and running guide

## Build a timer

Every timer has one or more ordered steps. Edit the first step directly, or use **Add step** to make a round with several steps. Select a step to edit its name, duration, ending cue, alarm, and sub-bells. Use the arrow buttons to change step order.

Each step can have up to five sub-bell tracks. A track can repeat on a cadence, use selected cadence offsets, ring after the step starts or before it ends, and add deterministic random gaps. These timing choices can be combined. Turning off a step's sub-bell layer keeps its settings for later.

The **Optional settings** row reveals clock alignment, run length, schedules, haptics, alarm and device options. Turned-on settings remain visible when you select a different option or reopen setup. Device access is reported from Android; selecting a preference does not itself grant access.

Drag the handle to move between a partial and expanded sheet, or drag down from the partial view to dismiss it. **Expand**, **Collapse** and **Done/Close** provide the same actions without dragging. Sound pickers and running settings use the same interaction; dismissing a sheet retains the current draft.

## Save and switch configurations

The name at the top opens the configuration picker. **Save** updates the selected saved configuration; **Save as** creates a separate one. You can keep a draft while switching, then return to it from the picker. Rename, duplicate, delete, import and export are available on configuration cards.

Starting a timer uses a frozen copy of the current step list and timer settings. Later editor changes do not change the active timer. While running, the screen shows the current step and upcoming cue. For a multi-step timer, **Previous** and **Next** move between steps without playing skipped cues. Pause and resume preserve the current position.

## Legacy data and recovery

Existing Cycle and Sequence work copies are imported into unified configurations/drafts, including the unselected copy. If legacy data cannot be interpreted safely, Chandas keeps the raw source and shows a recovery notice rather than replacing it with defaults. The retired setup experiment's storage key is not read or migrated.
