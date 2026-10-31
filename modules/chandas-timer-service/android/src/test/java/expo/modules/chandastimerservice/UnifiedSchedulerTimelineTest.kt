package expo.modules.chandastimerservice

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Integration acceptance through the exact facade used by TimerScheduler and notifications. */
class UnifiedSchedulerTimelineTest {
  private fun program(): JSONObject = JSONObject(requireNotNull(javaClass.getResourceAsStream("/timer-unified-timeline.json")).bufferedReader().use { it.readText() }).getJSONObject("program")

  @Test fun schedulerGetsStepBellsAlarmsAndHiddenCollisionMetadata() {
    val program = program().toString()
    assertTrue(TimerV2Timeline.isValid(program))
    assertTrue(TimerV2Timeline.isSequence(program))
    val bell = requireNotNull(TimerV2Timeline.next(program, 1000, 1000))
    assertEquals(11000L, bell.at)
    assertEquals(TimerV2Boundary.PATTERN_OFFSET, bell.boundary)
    assertEquals("handpan", bell.winner.soundId)
    assertEquals("pattern-track", bell.winner.kind)
    assertEquals(2, bell.candidates.size)
    assertFalse(bell.winner.showOnWatchFace)
    assertTrue(bell.showOnWatchFace)
    assertFalse(requireNotNull(TimerV2Timeline.next(program, 1000, 51000)).showOnWatchFace)
    assertEquals(61000L, TimerV2Timeline.nextVisible(program, 1000, 51000)?.at)
    val end = requireNotNull(TimerV2Timeline.next(program, 1000, 91000))
    assertEquals(TimerV2Boundary.SEQUENCE_CYCLE, end.boundary)
    assertTrue(end.winner.alarmEnabled)
    assertEquals("sequence-step", end.winner.kind)
    assertEquals("bloom", end.winner.soundId)
  }

  @Test fun oneStepRetainsMainAlarmBoundaryAndCueLevels() {
    val root = program()
    val step = root.getJSONArray("steps").getJSONObject(0).put("endAlarmEnabled", true)
    root.put("steps", JSONArray().put(step))
    val serialized = root.toString()
    assertFalse(TimerV2Timeline.isSequence(serialized))
    val event = requireNotNull(TimerV2Timeline.next(serialized, 1000, 56000))
    assertEquals(TimerV2Boundary.PATTERN_MAIN, event.boundary)
    assertEquals("pattern-main", event.winner.kind)
    assertTrue(event.winner.alarmEnabled)
    assertEquals("temple-gong", TimerV2Timeline.mainCueSound(serialized))
    assertEquals(0.8f, TimerV2Timeline.mainCueVolume(serialized), 0.0001f)
    assertEquals("Work", TimerV2Timeline.notificationTitle(serialized))
    assertEquals("", TimerV2Timeline.notificationContext(serialized, 1000, 1000)?.compactIdentity)
  }

  @Test fun facadePreservesBoundedTransportAndCurrentStepNotificationIdentity() {
    val root = program()
    root.getJSONObject("runPolicy").put("kind", "cycles").put("cycleCount", 2)
    val serialized = root.toString()
    assertEquals(100000L, TimerV2Timeline.cycleDuration(serialized))
    assertEquals(201000L, TimerV2Timeline.runEndAt(serialized, 1000, 1000))
    assertTrue(TimerV2Timeline.hasMatchingRunEnd(serialized, 1000, 1000, 201000))
    val iteration = requireNotNull(TimerV2Timeline.iterationEnd(serialized, 1000, 61000, 2))
    assertEquals(TimerV2Timeline.next(serialized, 1000, iteration.at - 1)?.logicalId, iteration.logicalId)
    assertTrue(requireNotNull(TimerV2Timeline.skipSequenceTarget(serialized, 1000, 161000, 1000, 201000, 1)).completesRun)
    val context = requireNotNull(TimerV2Timeline.notificationContext(serialized, 1000, 61000))
    assertEquals("Rest", context.label)
    assertEquals(101000L, context.currentEndsAt)
  }

  @Test fun wholeRoundClockAndElapsedAdaptersRetainAuthoredSteps() {
    val root = program().put("alignment", JSONObject().put("kind", "local-clock").put("offsetMinutes", 5))
    val serialized = root.toString()
    assertTrue(TimerV2Timeline.isLocalClock(serialized))
    assertEquals(UnifiedTimerTimeline.alignedAnchor(serialized, 1700000000123), TimerV2Timeline.alignedAnchor(serialized, 1700000000123))
    val elapsed = requireNotNull(TimerV2Timeline.elapsedAlignment(serialized))
    assertTrue(TimerV2Timeline.isValid(elapsed))
    assertFalse(TimerV2Timeline.isLocalClock(elapsed))
    assertEquals(root.getJSONArray("steps").toString(), JSONObject(elapsed).getJSONArray("steps").toString())
  }
}
