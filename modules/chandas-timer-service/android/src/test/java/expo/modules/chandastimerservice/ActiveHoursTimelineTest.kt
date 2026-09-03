package expo.modules.chandastimerservice

import java.nio.charset.StandardCharsets
import java.util.Calendar
import java.util.TimeZone
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ActiveHoursTimelineTest {
  private val fixtures: JSONObject by lazy {
    val stream = requireNotNull(javaClass.getResourceAsStream("/timer-v2-timeline.json"))
    JSONObject(stream.use { String(it.readBytes(), StandardCharsets.UTF_8) })
  }

  private fun config(
    start: Int,
    end: Int,
    days: Int,
  ) = TimerConfig(
    mainMs = 30 * 60_000L,
    subMs = 5 * 60_000L,
    phase = 0L,
    subEnabled = true,
    volume = 0.8f,
    notificationsEnabled = true,
    focusModeEnabled = false,
    alarmModeEnabled = false,
    activeHoursEnabled = true,
    activeHoursStart = start,
    activeHoursEnd = end,
    activeHoursDays = days,
    alarmDurationSeconds = 60,
  )

  private fun localTime(year: Int, month: Int, day: Int, hour: Int, minute: Int = 0): Long =
    Calendar.getInstance().apply {
      clear()
      set(year, month, day, hour, minute, 0)
    }.timeInMillis

  @Test fun equalEndpointsCoverTheWholeSelectedCivilDay() = withTimeZone("Asia/Kolkata") {
    val sunday = config(start = 8 * 60, end = 8 * 60, days = 1)
    val sundayMorning = localTime(2026, Calendar.SEPTEMBER, 6, 3)
    val mondayMorning = localTime(2026, Calendar.SEPTEMBER, 7, 3)
    assertTrue(ActiveHours.isActive(sunday, sundayMorning))
    assertFalse(ActiveHours.isActive(sunday, mondayMorning))

    val next = Calendar.getInstance().apply { timeInMillis = ActiveHours.nextStart(sunday, mondayMorning) }
    assertEquals(Calendar.SUNDAY, next.get(Calendar.DAY_OF_WEEK))
    assertEquals(0, next.get(Calendar.HOUR_OF_DAY))
    assertEquals(0, next.get(Calendar.MINUTE))
  }

  @Test fun crossMidnightWindowBelongsToItsStartingDay() = withTimeZone("Asia/Kolkata") {
    val fridayOnly = config(start = 22 * 60, end = 2 * 60, days = 1 shl (Calendar.FRIDAY - Calendar.SUNDAY))
    assertTrue(ActiveHours.isActive(fridayOnly, localTime(2026, Calendar.SEPTEMBER, 4, 23)))
    assertTrue(ActiveHours.isActive(fridayOnly, localTime(2026, Calendar.SEPTEMBER, 5, 1)))
    assertFalse(ActiveHours.isActive(fridayOnly, localTime(2026, Calendar.SEPTEMBER, 5, 3)))
  }

  @Test fun localClockAnchorUsesCivilTimeInAHalfHourZone() = withTimeZone("Asia/Kolkata") {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    root.put("alignment", JSONObject().put("kind", "local-clock").put("offsetMinutes", 10))
    val now = Calendar.getInstance().apply {
      clear()
      set(2026, Calendar.SEPTEMBER, 6, 9, 37, 45)
      set(Calendar.MILLISECOND, 123)
    }.timeInMillis

    val anchor = requireNotNull(TimerV2Timeline.alignedAnchor(root.toString(), now))
    val local = Calendar.getInstance().apply { timeInMillis = anchor }
    assertEquals(9, local.get(Calendar.HOUR_OF_DAY))
    assertEquals(10, local.get(Calendar.MINUTE))
    assertEquals(0, local.get(Calendar.SECOND))
    assertEquals(0, local.get(Calendar.MILLISECOND))
  }

  @Test fun reorderAloneChangesTheCollisionWinner() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    val tracks = root.getJSONArray("tracks")
    val first = tracks.remove(0)
    tracks.put(first)
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 0L, 9 * 60_000L))
    assertEquals("lower", event.winner.cueId)
    assertEquals(2, event.candidates.size)
  }

  @Test fun patternMainAndSequenceCycleAreDifferentBoundaries() {
    val pattern = fixtures.getJSONObject("patternCollision").getJSONObject("program").toString()
    val patternEvent = requireNotNull(TimerV2Timeline.next(pattern, 0L, 29 * 60_000L))
    assertEquals(TimerV2Boundary.PATTERN_MAIN, patternEvent.boundary)

    val sequenceFixture = fixtures.getJSONObject("sequence")
    val sequence = sequenceFixture.getJSONObject("program").toString()
    val cycleEvent = requireNotNull(TimerV2Timeline.next(sequence, 0L, 30 * 60_000L))
    assertEquals(TimerV2Boundary.SEQUENCE_CYCLE, cycleEvent.boundary)
    assertNotEquals(patternEvent.logicalId, cycleEvent.logicalId)
  }

  @Test fun iterationMuteTargetsTheFinalAudibleBoundary() {
    val sequence = fixtures.getJSONObject("sequence").getJSONObject("program").toString()
    val end = requireNotNull(TimerV2Timeline.iterationEnd(sequence, 0L, 60_000L, 3))
    assertEquals("sequence:0:2:step:2", end.logicalId)
    assertEquals(96 * 60_000L, end.at)
  }

  private inline fun withTimeZone(id: String, block: () -> Unit) {
    val previous = TimeZone.getDefault()
    try {
      TimeZone.setDefault(TimeZone.getTimeZone(id))
      block()
    } finally {
      TimeZone.setDefault(previous)
    }
  }
}
