// All times in milliseconds.
// phaseMs encodes the "phase offset" of the interval relative to the Unix epoch.
//   - With snap:    phaseMs = snapOffsetMinutes * 60_000
//   - Without snap: phaseMs = startTime % intervalMs  (frozen at start())

/** Next tick of a repeating interval with a phase offset. Always returns a time > nowMs. */
export function nextTick(nowMs: number, intervalMs: number, phaseMs: number): number {
  const phase = ((phaseMs % intervalMs) + intervalMs) % intervalMs
  return phase + (Math.floor((nowMs - phase) / intervalMs) + 1) * intervalMs
}

/** The most recent main tick (the anchor for sub-interval scheduling). */
export function lastMainTick(nowMs: number, mainIntervalMs: number, phaseMs: number): number {
  const phase = ((phaseMs % mainIntervalMs) + mainIntervalMs) % mainIntervalMs
  return Math.floor((nowMs - phase) / mainIntervalMs) * mainIntervalMs + phase
}

/** Next sub-interval tick, anchored to the last main tick. Always returns a time > nowMs. */
export function nextSubTick(
  nowMs: number,
  mainIntervalMs: number,
  subIntervalMs: number,
  phaseMs: number
): number {
  const anchor = lastMainTick(nowMs, mainIntervalMs, phaseMs)
  return anchor + (Math.floor((nowMs - anchor) / subIntervalMs) + 1) * subIntervalMs
}

/** Progress through the current main interval [0, 1). */
export function mainProgress(nowMs: number, mainIntervalMs: number, phaseMs: number): number {
  const anchor = lastMainTick(nowMs, mainIntervalMs, phaseMs)
  return (nowMs - anchor) / mainIntervalMs
}

/** Format milliseconds as MM:SS */
export function formatCountdown(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSecs / 60)
  const s = totalSecs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
