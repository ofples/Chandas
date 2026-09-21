const screens = [...document.querySelectorAll('[data-screen]')]
const flowLinks = [...document.querySelectorAll('[data-screen-target]')]
const historyStack = ['pattern-config']
let currentScreen = 'pattern-config'

const notes = {
  'pattern-config': {
    title: 'Pattern configuration',
    body: 'The base screen stays compact. Advanced structure appears as summaries; editing moves into focused surfaces.',
    details: [['Primary action', 'Start'], ['Hidden depth', 'Tracks, Mixer, presets'], ['Decision', 'D-002, D-003']],
  },
  'track-editor': {
    title: 'Trigger grid',
    body: 'Offsets stay spatial and scannable. Overlaps remain selectable; the outlined cell shows that a higher-priority track will sound.',
    details: [['Gesture', 'Tap or drag-paint'], ['At 10m', 'Higher track wins'], ['Decision', 'D-008, D-028']],
  },
  'preset-library': {
    title: 'Immutable presets',
    body: 'Loading creates a working copy. The same name can appear more than once because date, mode, and summary identify each snapshot.',
    details: [['Create', 'Save as new'], ['Mutation', 'Delete only'], ['Decision', 'D-009–D-011']],
  },
  'sequence-editor': {
    title: 'Sequence editor',
    body: 'A quiet ordered list makes duration and sound easy to scan. Handles communicate reordering without turning the screen into a control panel.',
    details: [['Start', 'Step 1, full duration'], ['Reorder', 'Handle + haptics'], ['Decision', 'D-004–D-006']],
  },
  mixer: {
    title: 'Program mixer',
    body: 'Master remains prominent while each cue gets one restrained channel row. Cycle and minute mute remain separate from saved volume levels.',
    details: [['Formula', 'Master × cue × system'], ['Mute', '1× / 2× / 3× / minutes'], ['Decision', 'D-012–D-014, D-025']],
  },
  'sound-library': {
    title: 'Sound library',
    body: 'Five stable built-in identities anchor the library. Android tones and device files extend it without changing scheduling semantics.',
    details: [['Sources', 'Built in / Android / Device'], ['Missing URI', 'Fallback + warning'], ['Decision', 'D-015, D-016']],
  },
  'running-pattern': {
    title: 'Pattern running',
    body: 'The outer ring shows the main interval. Inner rings show sub-interval progress, while text names only the next sub-bell.',
    details: [['Alarm tap', 'Next main only'], ['Alarm double tap', 'Lock every main'], ['Decision', 'D-023, D-026']],
  },
  'running-sequence': {
    title: 'Sequence running',
    body: 'The current step owns the ring. Cycle context stays secondary, and Pattern-only alarm controls disappear.',
    details: [['Current', 'Deep work · step 2'], ['Cycle', '5 / 25 / 2'], ['Decision', 'D-005, D-024']],
  },
  'focus-status': {
    title: 'Chandas Focus states',
    body: 'The status language reports only Chandas’s owned Android rule and distinguishes intent from actual activation.',
    details: [['Manual snooze', 'Paused in Android'], ['Other DND', 'Not displayed'], ['Decision', 'D-019–D-022']],
  },
  help: {
    title: 'Help and tooltips',
    body: 'The sheet makes every gesture discoverable. Long press remains a compact shortcut, never the only way to learn a control.',
    details: [['Entry', 'Top-right ?'], ['Shortcut', 'Long-press tooltip'], ['Decision', 'D-027']],
  },
}

function updateNotes(name) {
  const note = notes[name]
  if (!note) return
  document.querySelector('#noteTitle').textContent = note.title
  document.querySelector('#noteBody').textContent = note.body
  const detailRoot = document.querySelector('#noteDetails')
  detailRoot.replaceChildren(...note.details.map(([term, value]) => {
    const row = document.createElement('div')
    const dt = document.createElement('dt')
    const dd = document.createElement('dd')
    dt.textContent = term
    dd.textContent = value
    row.append(dt, dd)
    return row
  }))
}

function showScreen(name, { push = true } = {}) {
  if (!screens.some(screen => screen.dataset.screen === name)) return
  if (push && name !== currentScreen) historyStack.push(name)
  currentScreen = name
  screens.forEach(screen => screen.classList.toggle('active', screen.dataset.screen === name))
  flowLinks.forEach(link => link.classList.toggle('active', link.dataset.screenTarget === name))
  updateNotes(name)
  hideTooltip()
}

function goBack() {
  if (historyStack.length > 1) historyStack.pop()
  showScreen(historyStack.at(-1) || 'pattern-config', { push: false })
}

flowLinks.forEach(link => link.addEventListener('click', () => showScreen(link.dataset.screenTarget)))
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.go)))
document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', goBack))

document.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  if (document.querySelector('dialog[open]')) return
  const names = flowLinks.map(link => link.dataset.screenTarget)
  const index = names.indexOf(currentScreen)
  const next = event.key === 'ArrowRight'
    ? names[(index + 1) % names.length]
    : names[(index - 1 + names.length) % names.length]
  showScreen(next)
})

document.querySelectorAll('[data-open-dialog]').forEach(button => {
  button.addEventListener('click', () => document.querySelector(`#${button.dataset.openDialog}`)?.showModal())
})

document.querySelectorAll('.filter-row, .choice-row, .quick-picks').forEach(group => {
  group.addEventListener('click', event => {
    const target = event.target.closest('button')
    if (!target) return
    group.querySelectorAll('button').forEach(button => button.classList.toggle('active', button === target))
  })
})

const triggerGrid = document.querySelector('.trigger-grid')
const triggerSummary = document.querySelector('#triggerSummary')
let isPainting = false
let paintSelected = false
let paintStarted = false

function triggerMinute(cell) {
  return cell.childNodes[0]?.textContent?.trim() || cell.textContent.trim()
}

function setTriggerSelected(cell, selected) {
  cell.classList.toggle('selected', selected)
  const overlapNote = cell.classList.contains('overlap-loser')
    ? ', every 5 minute track wins'
    : ''
  cell.setAttribute('aria-label', `${Number(triggerMinute(cell))} minutes ${selected ? 'selected' : 'not selected'}${overlapNote}`)
}

function updateTriggerSummary() {
  if (!triggerGrid || !triggerSummary) return
  const cells = [...triggerGrid.querySelectorAll('button')]
  const selected = cells.filter(cell => cell.classList.contains('selected')).length
  triggerSummary.textContent = `${selected} of ${cells.length} selected`
}

triggerGrid?.addEventListener('pointerdown', event => {
  const cell = event.target.closest('button')
  if (!cell) return
  isPainting = true
  paintStarted = true
  paintSelected = !cell.classList.contains('selected')
  setTriggerSelected(cell, paintSelected)
  updateTriggerSummary()
})

triggerGrid?.addEventListener('pointerover', event => {
  if (!isPainting || !event.buttons) return
  const cell = event.target.closest('button')
  if (!cell) return
  setTriggerSelected(cell, paintSelected)
  updateTriggerSummary()
})

window.addEventListener('pointerup', () => { isPainting = false })
window.addEventListener('pointercancel', () => {
  isPainting = false
  paintStarted = false
})

triggerGrid?.addEventListener('click', event => {
  const cell = event.target.closest('button')
  if (!cell) return
  if (paintStarted) {
    paintStarted = false
    return
  }
  setTriggerSelected(cell, !cell.classList.contains('selected'))
  updateTriggerSummary()
})

document.querySelectorAll('[data-grid-action]').forEach(button => {
  button.addEventListener('click', () => {
    const selected = button.dataset.gridAction === 'select-all'
    triggerGrid?.querySelectorAll('button').forEach(cell => setTriggerSelected(cell, selected))
    updateTriggerSummary()
  })
})

const alarmButton = document.querySelector('#alarmButton')
const alarmBadge = document.querySelector('#alarmBadge')
const alarmInstruction = document.querySelector('#alarmInstruction')
let alarmState = 'off'
let singleTapTimer = null

function renderAlarm() {
  alarmButton.classList.toggle('once', alarmState === 'once')
  alarmButton.classList.toggle('locked', alarmState === 'locked')
  alarmBadge.textContent = alarmState === 'once' ? '1' : alarmState === 'locked' ? '⌕' : ''
  alarmInstruction.textContent = alarmState === 'off'
    ? 'Tap alarm for next main · double tap to lock'
    : alarmState === 'once'
      ? 'Alarm armed for the next main boundary'
      : 'Alarm locked for every main boundary'
  alarmButton.setAttribute('aria-label', `Alarm ${alarmState}`)
}

alarmButton?.addEventListener('click', () => {
  clearTimeout(singleTapTimer)
  singleTapTimer = setTimeout(() => {
    alarmState = alarmState === 'off' ? 'once' : 'off'
    renderAlarm()
  }, 240)
})

alarmButton?.addEventListener('dblclick', event => {
  event.preventDefault()
  clearTimeout(singleTapTimer)
  alarmState = alarmState === 'locked' ? 'off' : 'locked'
  renderAlarm()
})

const tooltip = document.querySelector('#controlTooltip')
let tooltipTimer = null
let tooltipHideTimer = null

function showTooltip(text) {
  clearTimeout(tooltipHideTimer)
  tooltip.textContent = text
  tooltip.classList.add('show')
  tooltipHideTimer = setTimeout(hideTooltip, 2800)
}

function hideTooltip() {
  clearTimeout(tooltipTimer)
  clearTimeout(tooltipHideTimer)
  tooltip?.classList.remove('show')
}

document.querySelectorAll('[data-tooltip]').forEach(control => {
  const begin = () => {
    clearTimeout(tooltipTimer)
    tooltipTimer = setTimeout(() => showTooltip(control.dataset.tooltip), 480)
  }
  control.addEventListener('pointerdown', begin)
  control.addEventListener('pointerup', () => clearTimeout(tooltipTimer))
  control.addEventListener('pointercancel', hideTooltip)
  control.addEventListener('pointerleave', hideTooltip)
  control.addEventListener('mouseenter', begin)
  control.addEventListener('mouseleave', hideTooltip)
})

renderAlarm()
updateNotes(currentScreen)
