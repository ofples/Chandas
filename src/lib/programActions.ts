import type {
  CueSettings,
  PatternProgram,
  PatternTrack,
  ProgramPreset,
  SequenceProgram,
  SequenceStep,
  TimerMode,
  TimerProgram,
  TimerV2State,
  WorkingProgramState,
} from '../types'
import {
  MAX_PATTERN_TRACKS,
  MAX_SEQUENCE_STEPS,
  clampDuration,
  clampVolume,
  createProgramId,
  normalizeLabel,
  normalizePatternProgram,
  normalizeSequenceProgram,
  validOffsets,
} from './timerV2'
import { defaultSubBellColor } from './subBellColors'

function selectedProgram(state: TimerV2State): TimerProgram {
  return state.workingPrograms[state.workingPrograms.selectedMode]
}

function withWorkingProgram(state: TimerV2State, mode: TimerMode, program: TimerProgram): TimerV2State {
  return {
    ...state,
    workingPrograms: {
      ...state.workingPrograms,
      selectedMode: mode,
      [mode]: program,
      sourcePreset: state.workingPrograms.selectedMode === mode ? state.workingPrograms.sourcePreset : undefined,
    } as WorkingProgramState,
  }
}

export function chooseProgramMode(state: TimerV2State, mode: TimerMode): TimerV2State {
  if (state.workingPrograms.selectedMode === mode) return state
  return { ...state, workingPrograms: { ...state.workingPrograms, selectedMode: mode, sourcePreset: undefined } }
}

export function updatePattern(state: TimerV2State, update: (program: PatternProgram) => PatternProgram): TimerV2State {
  return withWorkingProgram(state, 'pattern', normalizePatternProgram(update(state.workingPrograms.pattern)))
}

export function updatePatternMainMinutes(state: TimerV2State, minutes: number): TimerV2State {
  return updatePattern(state, program => {
    const mainMinutes = clampDuration(minutes, program.mainMinutes)
    return {
      ...program,
      mainMinutes,
      tracks: program.tracks.map(track => {
        const previousOffsets = validOffsets(program.mainMinutes, track.cadenceMinutes)
        const nextOffsets = validOffsets(mainMinutes, track.cadenceMinutes)
        if (mainMinutes <= program.mainMinutes) return { ...track, selectedOffsetsMinutes: track.selectedOffsetsMinutes.filter(offset => nextOffsets.includes(offset)) }
        const selected = new Set(track.selectedOffsetsMinutes)
        if (previousOffsets.length === 0 || previousOffsets.every(offset => selected.has(offset))) return { ...track, selectedOffsetsMinutes: nextOffsets }
        const selectedPattern = previousOffsets.map(offset => selected.has(offset))
        return { ...track, selectedOffsetsMinutes: nextOffsets.filter((_, index) => selectedPattern[index % selectedPattern.length]) }
      }),
    }
  })
}

export function addPatternTrack(state: TimerV2State): TimerV2State {
  return updatePattern(state, program => {
    if (program.tracks.length >= MAX_PATTERN_TRACKS) return program
    const cadenceMinutes = 5
    const track: PatternTrack = {
      id: createProgramId(),
      label: `Sub-bell ${program.tracks.length + 1}`,
      color: defaultSubBellColor(program.tracks.length),
      enabled: true,
      cadenceMinutes,
      selectedOffsetsMinutes: validOffsets(program.mainMinutes, cadenceMinutes),
      sound: { kind: 'builtin', id: 'clear-bell' },
      volume: 1,
    }
    return { ...program, subBellsEnabled: true, tracks: [...program.tracks, track] }
  })
}

export function setPatternSubBellsEnabled(state: TimerV2State, enabled: boolean): TimerV2State {
  const withTrack = enabled && state.workingPrograms.pattern.tracks.length === 0 ? addPatternTrack(state) : state
  return updatePattern(withTrack, program => ({ ...program, subBellsEnabled: enabled }))
}

export function patchPatternTrack(state: TimerV2State, trackId: string, patch: Partial<PatternTrack>): TimerV2State {
  return updatePattern(state, program => ({
    ...program,
    tracks: program.tracks.map(track => track.id === trackId ? { ...track, ...patch } : track),
  }))
}

export function removePatternTrack(state: TimerV2State, trackId: string): TimerV2State {
  return updatePattern(state, program => {
    const tracks = program.tracks.filter(track => track.id !== trackId)
    return { ...program, tracks, subBellsEnabled: tracks.length > 0 && program.subBellsEnabled }
  })
}

export function setTrackCadence(state: TimerV2State, trackId: string, cadenceMinutes: number): TimerV2State {
  return updatePattern(state, program => ({
    ...program,
    tracks: program.tracks.map(track => {
      if (track.id !== trackId) return track
      const cadence = clampDuration(cadenceMinutes, track.cadenceMinutes)
      const previousOffsets = validOffsets(program.mainMinutes, track.cadenceMinutes)
      const selected = new Set(track.selectedOffsetsMinutes)
      const selectedOffsetsMinutes = previousOffsets.length === 0 || previousOffsets.every(offset => selected.has(offset))
        ? validOffsets(program.mainMinutes, cadence)
        : track.selectedOffsetsMinutes.filter(offset => offset % cadence === 0)
      return { ...track, cadenceMinutes: cadence, selectedOffsetsMinutes }
    }),
  }))
}

export function setTrackOffsets(state: TimerV2State, trackId: string, offsets: number[]): TimerV2State {
  return patchPatternTrack(state, trackId, { selectedOffsetsMinutes: offsets })
}

export function toggleTrackOffset(state: TimerV2State, trackId: string, offset: number): TimerV2State {
  const track = state.workingPrograms.pattern.tracks.find(value => value.id === trackId)
  if (!track) return state
  const selectedOffsetsMinutes = track.selectedOffsetsMinutes.includes(offset)
    ? track.selectedOffsetsMinutes.filter(value => value !== offset)
    : [...track.selectedOffsetsMinutes, offset].sort((a, b) => a - b)
  return setTrackOffsets(state, trackId, selectedOffsetsMinutes)
}

export function updateSequence(state: TimerV2State, update: (program: SequenceProgram) => SequenceProgram): TimerV2State {
  return withWorkingProgram(state, 'sequence', normalizeSequenceProgram(update(state.workingPrograms.sequence)))
}

/** Keeps final-gong editing identical across Pattern and Sequence programs. */
export function setCompletionCueEnabled(state: TimerV2State, mode: TimerMode, enabled: boolean): TimerV2State {
  if (mode === 'pattern') {
    return updatePattern(state, program => ({
      ...program,
      completionCue: enabled ? program.completionCue ?? { ...program.mainCue, sound: { ...program.mainCue.sound } } : null,
    }))
  }
  return updateSequence(state, program => {
    const fallback = program.steps.at(-1)!
    return {
      ...program,
      completionCue: enabled ? program.completionCue ?? { sound: { ...fallback.sound }, volume: fallback.volume } : null,
    }
  })
}

export function patchCompletionCue(state: TimerV2State, mode: TimerMode, patch: Partial<CueSettings>): TimerV2State {
  const apply = <T extends PatternProgram | SequenceProgram>(program: T): T => program.completionCue
    ? { ...program, completionCue: { ...program.completionCue, ...patch } }
    : program
  return mode === 'pattern' ? updatePattern(state, apply) : updateSequence(state, apply)
}

export function addSequenceStep(state: TimerV2State): TimerV2State {
  return updateSequence(state, program => {
    if (program.steps.length >= MAX_SEQUENCE_STEPS) return program
    const step: SequenceStep = {
      id: createProgramId(),
      label: `Step ${program.steps.length + 1}`,
      durationMinutes: 5,
      sound: { kind: 'builtin', id: 'clear-bell' },
      volume: 0.8,
    }
    return { ...program, steps: [...program.steps, step] }
  })
}

export function duplicateSequenceStep(state: TimerV2State, stepId: string): TimerV2State {
  return updateSequence(state, program => {
    if (program.steps.length >= MAX_SEQUENCE_STEPS) return program
    const index = program.steps.findIndex(step => step.id === stepId)
    if (index < 0) return program
    const source = program.steps[index]
    const duplicate: SequenceStep = { ...source, id: createProgramId(), label: normalizeLabel(`${source.label} copy`, source.label) }
    const steps = [...program.steps]
    steps.splice(index + 1, 0, duplicate)
    return { ...program, steps }
  })
}

export function patchSequenceStep(state: TimerV2State, stepId: string, patch: Partial<SequenceStep>): TimerV2State {
  return updateSequence(state, program => ({
    ...program,
    steps: program.steps.map(step => step.id === stepId ? {
      ...step,
      ...patch,
      durationMinutes: patch.durationMinutes === undefined ? step.durationMinutes : clampDuration(patch.durationMinutes, step.durationMinutes),
      volume: patch.volume === undefined ? step.volume : clampVolume(patch.volume, step.volume),
      label: patch.label === undefined ? step.label : normalizeLabel(patch.label, step.label),
    } : step),
  }))
}

export function removeSequenceStep(state: TimerV2State, stepId: string): TimerV2State {
  return updateSequence(state, program => ({
    ...program,
    steps: program.steps.length > 1 ? program.steps.filter(step => step.id !== stepId) : program.steps,
  }))
}

export function reorderSequenceSteps(state: TimerV2State, from: number, to: number): TimerV2State {
  return updateSequence(state, program => {
    if (from === to || from < 0 || to < 0 || from >= program.steps.length || to >= program.steps.length) return program
    const steps = [...program.steps]
    const [item] = steps.splice(from, 1)
    steps.splice(to, 0, item)
    return { ...program, steps }
  })
}

/** Presets are immutable snapshots. Editing always happens in working state. */
export function saveProgramPreset(state: TimerV2State, name: string, now = Date.now()): TimerV2State {
  const trimmed = [...name.trim()].slice(0, 80).join('')
  if (!trimmed) return state
  const program = selectedProgram(state)
  const snapshot = program.mode === 'pattern' ? normalizePatternProgram(program) : normalizeSequenceProgram(program)
  const preset: ProgramPreset = { id: createProgramId(), name: trimmed, createdAt: now, program: snapshot }
  return {
    ...state,
    presets: [preset, ...state.presets],
    workingPrograms: { ...state.workingPrograms, sourcePreset: { id: preset.id, name: preset.name, createdAt: preset.createdAt } },
  }
}

export function loadProgramPreset(state: TimerV2State, presetId: string): TimerV2State {
  const preset = state.presets.find(value => value.id === presetId)
  if (!preset) return state
  const program = preset.program.mode === 'pattern' ? normalizePatternProgram(preset.program) : normalizeSequenceProgram(preset.program)
  return {
    ...state,
    workingPrograms: {
      ...state.workingPrograms,
      selectedMode: program.mode,
      [program.mode]: program,
      sourcePreset: { id: preset.id, name: preset.name, createdAt: preset.createdAt },
    } as WorkingProgramState,
  }
}

export function deleteProgramPreset(state: TimerV2State, presetId: string): TimerV2State {
  const sourcePreset = state.workingPrograms.sourcePreset
  return {
    ...state,
    presets: state.presets.filter(preset => preset.id !== presetId),
    workingPrograms: sourcePreset?.id === presetId
      ? { ...state.workingPrograms, sourcePreset: { ...sourcePreset, deleted: true } }
      : state.workingPrograms,
  }
}
