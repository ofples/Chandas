package expo.modules.chandastimerservice

/**
 * Deterministic tick math — a straight port of src/lib/snapLogic.ts.
 *
 * Kept identical to the JS version on purpose: the JS UI (ring/countdown) and this
 * service compute ticks independently from the same (mainMs, subMs, phase), so they
 * can never drift and never need to exchange tick events to stay in sync.
 */
object TimerMath {
  /** Next tick of a repeating interval with a phase offset. Always returns a time > nowMs. */
  fun nextTick(nowMs: Long, intervalMs: Long, phaseMs: Long): Long {
    val phase = ((phaseMs % intervalMs) + intervalMs) % intervalMs
    return phase + (Math.floorDiv(nowMs - phase, intervalMs) + 1) * intervalMs
  }

  /** The most recent main tick (the anchor for sub-interval scheduling). */
  fun lastMainTick(nowMs: Long, mainIntervalMs: Long, phaseMs: Long): Long {
    val phase = ((phaseMs % mainIntervalMs) + mainIntervalMs) % mainIntervalMs
    return Math.floorDiv(nowMs - phase, mainIntervalMs) * mainIntervalMs + phase
  }

  /** Next sub-interval tick, anchored to the last main tick. Always returns a time > nowMs. */
  fun nextSubTick(nowMs: Long, mainIntervalMs: Long, subIntervalMs: Long, phaseMs: Long): Long {
    val anchor = lastMainTick(nowMs, mainIntervalMs, phaseMs)
    return anchor + (Math.floorDiv(nowMs - anchor, subIntervalMs) + 1) * subIntervalMs
  }
}
