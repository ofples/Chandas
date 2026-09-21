export interface VerifiableNativeTimer {
  stop(): void
  getState(): { active: boolean }
}

/**
 * A native stop can throw during secondary Android UI cleanup after its
 * durable schedule was already cleared. The state read is authoritative:
 * return success only when Android explicitly reports inactivity.
 */
export function stopAndVerifyNativeTimer(timer: VerifiableNativeTimer): boolean {
  try {
    timer.stop()
  } catch {
    // Verification below distinguishes a harmless cleanup exception from an
    // actual stop failure.
  }
  try {
    return !timer.getState().active
  } catch {
    return false
  }
}
