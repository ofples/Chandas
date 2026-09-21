package expo.modules.chandastimerservice

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class TimerNotificationCopyTest {
  @Test fun acceptsOtaCopyAndInterpolatesTime() {
    val copy = TimerNotificationCopy.from(JSONObject()
      .put("runningTitle", "Quiet cycle")
      .put("nextCueAt", "Another bell at {time}")
      .toString())

    assertEquals("Quiet cycle", copy.runningTitle)
    assertEquals("Another bell at 9:30", copy.nextCue("9:30"))
    assertEquals(TimerNotificationCopy.DEFAULT.alarmTitle, copy.alarmTitle)
  }

  @Test fun rejectsMissingPlaceholderAndOversizedPayload() {
    val missingPlaceholder = TimerNotificationCopy.from(JSONObject()
      .put("nextCueAt", "Soon")
      .toString())
    assertEquals("Next cue at 9:30", missingPlaceholder.nextCue("9:30"))

    val oversized = TimerNotificationCopy.from("x".repeat(TimerNotificationCopy.MAX_SERIALIZED_CHARACTERS + 1))
    assertEquals(TimerNotificationCopy.DEFAULT, oversized)
  }
}
