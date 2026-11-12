import type { RuntimeTimerProgram } from '../types'
import type { NativeTimerCapabilities } from '../native/ChandasTimerService'

export function requiresExactSubBellRuntime(program: RuntimeTimerProgram): boolean {
  if (program.mode === 'unified') return program.steps.some(step => step.subBellsEnabled && step.subBellTracks.some(track => track.enabled))
  return program.mode === 'pattern' && program.subBellsEnabled && program.tracks.some(track => track.enabled && (typeof track.cadenceSeconds === 'number' || Array.isArray(track.selectedOffsetsSeconds)))
}

/** No native module may receive a program merely because its package version looks recent. */
export function nativeSupportsRuntimeProgram(program: RuntimeTimerProgram, capabilities: NativeTimerCapabilities | null): boolean {
  if (!capabilities || capabilities.programSchemaMin > program.schemaVersion || capabilities.programSchemaMax < program.schemaVersion) return false
  if (program.runPolicy.kind === 'until' && capabilities.supportsUntilRunLength !== true) return false
  if (program.mode === 'unified' && (capabilities.supportsUnifiedSteps !== true || capabilities.supportsStepSubBells !== true || capabilities.supportsSecondPrecision !== true)) return false
  const cues = program.mode === 'unified'
    ? [...program.steps.flatMap(step => [step.endCue, ...step.subBellTracks]), program.completionCue]
    : program.mode === 'pattern' ? [program.mainCue, ...program.tracks, program.completionCue] : [...program.steps, program.completionCue]
  if (capabilities.supportsUnlimitedSounds !== true && cues.some(cue => (cue?.sounds?.length ?? 0) > 8)) return false
  const tracks = program.mode === 'unified' ? program.steps.flatMap(step => step.subBellTracks) : program.mode === 'pattern' ? program.tracks : []
  if (capabilities.supportsRandomRepeat !== true && tracks.some(track => track.randomRepeat)) return false
  if (capabilities.supportsStepAlarms !== true && (program.mode === 'unified' ? program.steps.some(step => step.endAlarmEnabled) : program.mode === 'sequence' && program.steps.some(step => step.alarmEnabled))) return false
  return !requiresExactSubBellRuntime(program) || capabilities.supportsSubBellSecondPrecision === true
}
