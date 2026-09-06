package expo.modules.chandastimerservice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TimerCountdownTextTest {
  @Test fun combinesSubMinuteCurrentAndMinuteFinalCountdowns() {
    assertEquals(
      "12s | 10m",
      TimerCountdownText.compact(currentAt = 12_000L, finalAt = 600_000L, currentIsFinal = false, now = 0L),
    )
  }

  @Test fun combinesClockCurrentAndCeilingMinuteFinalCountdowns() {
    assertEquals(
      "01:12 | 5m",
      TimerCountdownText.compact(currentAt = 72_000L, finalAt = 241_000L, currentIsFinal = false, now = 0L),
    )
  }

  @Test fun collapsesWhenTheCurrentEventCompletesTheRun() {
    assertEquals(
      "12s",
      TimerCountdownText.compact(currentAt = 12_000L, finalAt = 12_000L, currentIsFinal = true, now = 0L),
    )
  }

  @Test fun matchingDeadlinesCollapseEvenWithoutAnEventHint() {
    assertEquals(
      "01:12",
      TimerCountdownText.compact(currentAt = 72_000L, finalAt = 72_000L, currentIsFinal = false, now = 0L),
    )
  }

  @Test fun continuousRunsHaveOnlyTheCurrentCountdown() {
    assertEquals(
      "01:12",
      TimerCountdownText.compact(currentAt = 72_000L, finalAt = 0L, currentIsFinal = false, now = 0L),
    )
  }

  @Test fun expiredCurrentCountdownProducesNoChipText() {
    assertNull(TimerCountdownText.compact(currentAt = 10L, finalAt = 20L, currentIsFinal = false, now = 10L))
  }
}
