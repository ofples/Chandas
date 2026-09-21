package expo.modules.chandastimerservice

import org.junit.Assert.assertEquals
import org.junit.Test

class BatchVerificationProbeTest {
  @Test fun sequenceStatusKeepsStepNameWithRealStepDeadline() {
    assertEquals("1:23·Work", TimerCountdownText.forProgram(
      identity = "Work", sequence = true, currentAt = 83_000L,
      finalAt = 83_000L, currentIsFinal = true, now = 0L,
    ))
  }
  @Test fun cycleEndUnderOneMinuteUsesSeconds() {
    assertEquals("12s·43s", TimerCountdownText.forProgram(
      identity = "", sequence = false, currentAt = 12_000L,
      finalAt = 43_000L, currentIsFinal = false, now = 0L,
    ))
  }
}
