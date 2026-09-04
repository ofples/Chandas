package expo.modules.chandastimerservice

import java.nio.charset.StandardCharsets
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimerV2TimelineTest {
  private val fixtures: JSONObject by lazy {
    val stream = requireNotNull(javaClass.getResourceAsStream("/timer-v2-timeline.json"))
    JSONObject(stream.use { String(it.readBytes(), StandardCharsets.UTF_8) })
  }

  @Test fun patternCollisionUsesTrackOrderAndStableIdentity() {
    val fixture = fixtures.getJSONObject("patternCollision")
    val program = fixture.getJSONObject("program").toString()
    val expected = fixture.getJSONObject("expected")
    assertTrue(TimerV2Timeline.isValid(program))
    val event = requireNotNull(TimerV2Timeline.next(program, fixture.getLong("anchor"), fixture.getLong("now")))
    assertEquals(expected.getLong("at"), event.at)
    assertEquals(expected.getString("logicalId"), event.logicalId)
    assertEquals(expected.getString("winnerCueId"), event.winner.cueId)
    assertEquals(TimerV2Boundary.PATTERN_OFFSET, event.boundary)
    assertEquals(expected.getBoolean("collision"), event.candidates.size > 1)
  }

  @Test fun sequenceBoundariesRepeatStrictlyAfterNow() {
    val fixture = fixtures.getJSONObject("sequence")
    val program = fixture.getJSONObject("program").toString()
    val anchor = fixture.getLong("anchor")
    val queries = fixture.getJSONArray("queries")
    assertTrue(TimerV2Timeline.isValid(program))
    for (index in 0 until queries.length()) {
      val query = queries.getJSONObject(index)
      val event = requireNotNull(TimerV2Timeline.next(program, anchor, query.getLong("now")))
      assertTrue(event.at > query.getLong("now"))
      assertEquals(query.getLong("at"), event.at)
      assertEquals(query.getString("logicalId"), event.logicalId)
      assertEquals(query.getString("winnerCueId"), event.winner.cueId)
      assertEquals(query.getString("boundary"), event.boundary.value)
    }
  }

  @Test fun rejectsFutureSchemaAndDuplicateIds() {
    val valid = fixtures.getJSONObject("sequence").getJSONObject("program")
    assertFalse(TimerV2Timeline.isValid(JSONObject(valid.toString()).put("schemaVersion", 99).toString()))
    val duplicate = JSONObject(valid.toString())
    duplicate.getJSONArray("steps").getJSONObject(1).put("id", "prepare")
    assertFalse(TimerV2Timeline.isValid(duplicate.toString()))
  }

  @Test fun boundedCycleEndsOnOneNaturalBoundary() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    root.put("runPolicy", JSONObject().put("kind", "cycles").put("cycleCount", 2).put("durationSeconds", 1_800))
    val endAt = requireNotNull(TimerV2Timeline.runEndAt(root.toString(), 1_000L, 12 * 60_000L + 1_000L))
    assertEquals(60 * 60_000L + 1_000L, endAt)
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 1_000L, endAt - 1L, 12 * 60_000L + 1_000L, endAt))
    assertEquals(TimerV2Boundary.PATTERN_MAIN, event.boundary)
    assertTrue(event.completesRun)
    assertEquals(null, TimerV2Timeline.next(root.toString(), 1_000L, endAt, 12 * 60_000L + 1_000L, endAt))
  }

  @Test fun boundedDurationCreatesSyntheticCompletionBetweenCues() {
    val root = JSONObject(fixtures.getJSONObject("sequence").getJSONObject("program").toString())
    root.put("runPolicy", JSONObject().put("kind", "duration").put("cycleCount", 1).put("durationSeconds", 90))
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 1_000L, 1_000L, 1_000L, 91_000L))
    assertEquals(91_000L, event.at)
    assertEquals(TimerV2Boundary.RUN_COMPLETE, event.boundary)
    assertEquals("run-complete", event.winner.kind)
    assertTrue(event.completesRun)
  }

  @Test fun customEndingCueReplacesNaturalAndSyntheticCompletionSounds() {
    val endCue = JSONObject()
      .put("sound", JSONObject().put("kind", "builtin").put("id", "wood-block"))
      .put("volume", 0.35)

    val pattern = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    pattern.put("endCue", endCue)
    pattern.put("runPolicy", JSONObject().put("kind", "cycles").put("cycleCount", 1).put("durationSeconds", 1_800))
    assertTrue(TimerV2Timeline.isValid(pattern.toString()))
    val natural = requireNotNull(TimerV2Timeline.next(pattern.toString(), 1_000L, 1_000L + 30 * 60_000L - 1L, 1_000L))
    assertEquals(TimerV2Boundary.PATTERN_MAIN, natural.boundary)
    assertTrue(natural.completesRun)
    assertEquals("end", natural.winner.cueId)
    assertEquals("wood-block", natural.winner.soundId)
    assertEquals(1, natural.candidates.size)

    val sequence = JSONObject(fixtures.getJSONObject("sequence").getJSONObject("program").toString())
    sequence.put("endCue", endCue)
    sequence.put("runPolicy", JSONObject().put("kind", "duration").put("cycleCount", 1).put("durationSeconds", 90))
    assertTrue(TimerV2Timeline.isValid(sequence.toString()))
    val synthetic = requireNotNull(TimerV2Timeline.next(sequence.toString(), 1_000L, 1_000L, 1_000L, 91_000L))
    assertEquals(TimerV2Boundary.RUN_COMPLETE, synthetic.boundary)
    assertEquals("end", synthetic.winner.cueId)
    assertEquals("wood-block", synthetic.winner.soundId)
  }

  @Test fun fixedCycleDeadlineSurvivesLocalPhaseRealignment() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    root.put("runPolicy", JSONObject().put("kind", "cycles").put("cycleCount", 2).put("durationSeconds", 1_800))
    val startedAt = 12 * 60_000L
    val fixedEnd = requireNotNull(TimerV2Timeline.runEndAt(root.toString(), 0L, startedAt))
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 7 * 60_000L, fixedEnd - 1L, startedAt, fixedEnd))
    assertEquals(fixedEnd, event.at)
    assertEquals(TimerV2Boundary.RUN_COMPLETE, event.boundary)
    assertTrue(event.completesRun)
  }
}
