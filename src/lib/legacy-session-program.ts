import type { TimerProgram } from '../types'
import { normalizePatternProgram, normalizeSequenceProgram } from './timerV2'
import { convertLegacyProgramToUnified } from './unified-timer'

/** Resume the accepted legacy program without reordering tracks or rewriting cue lists.
 * Defaults fill old omissions only; configuration migration is a separate operation.
 */
export function legacySessionProgram(input: unknown): TimerProgram | null {
  if (!convertLegacyProgramToUnified(input).ok) return null
  const raw = input as TimerProgram
  const entries = raw.mode === 'pattern' ? raw.tracks : raw.steps
  if (!Array.isArray(entries) || entries.some(entry => typeof entry.id !== 'string' || !entry.id.length)) return null
  if (raw.mode === 'pattern') {
    const defaults = normalizePatternProgram(raw)
    const byId = new Map(defaults.tracks.map(track => [track.id, track]))
    return {
      ...defaults, ...raw,
      mainCue: { ...defaults.mainCue, ...raw.mainCue },
      runPolicy: { ...defaults.runPolicy, ...raw.runPolicy },
      tracks: raw.tracks.map(track => ({ ...byId.get(track.id)!, ...track })),
    }
  }
  const defaults = normalizeSequenceProgram(raw)
  const byId = new Map(defaults.steps.map(step => [step.id, step]))
  return { ...defaults, ...raw, runPolicy: { ...defaults.runPolicy, ...raw.runPolicy }, steps: raw.steps.map(step => ({ ...byId.get(step.id)!, ...step })) }
}
