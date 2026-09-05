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

  @Test fun acceptsAndResolvesEveryProductionBuiltInSound() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    val productionIds = listOf(
      "temple-gong", "clear-bell", "bloom", "boxing-bell", "bubble", "champagne", "cymbal", "handpan", "heartbeat",
      "ice", "instamatic", "mouse-click", "page", "sine-bass", "sine-high", "sine-low", "water-drop", "wind",
    )
    productionIds.forEach { id ->
      root.getJSONObject("mainCue").getJSONObject("sound").put("id", id)
      assertTrue("Timeline rejected $id", TimerV2Timeline.isValid(root.toString()))
      assertTrue("Player has no raw resource for $id", TimerSoundPlayer.builtInResource(id) != null)
    }
    listOf("soft-bowl", "wood-block", "bright-chime").forEach { legacyId ->
      assertTrue("Legacy sound alias is not recoverable: $legacyId", TimerSoundPlayer.builtInResource(legacyId) != null)
    }
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

  @Test fun customCompletionCueReplacesNaturalTerminalBoundary() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    root.put("runPolicy", JSONObject().put("kind", "cycles").put("cycleCount", 1).put("durationSeconds", 1_800))
    root.put("completionCue", JSONObject()
      .put("sound", JSONObject().put("kind", "builtin").put("id", "bloom"))
      .put("volume", 0.35))
    val endAt = requireNotNull(TimerV2Timeline.runEndAt(root.toString(), 0L, 1L))
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 0L, endAt - 1L, 1L, endAt))
    assertEquals(TimerV2Boundary.PATTERN_MAIN, event.boundary)
    assertEquals("completion", event.winner.cueId)
    assertEquals("run-complete", event.winner.kind)
    assertEquals("bloom", event.winner.soundId)
    assertEquals(0.35f, event.winner.volume)
    assertEquals(1, event.candidates.size)
    assertTrue(event.completesRun)
  }

  @Test fun customCompletionCueIsUsedBetweenNaturalCuesAndValidated() {
    val root = JSONObject(fixtures.getJSONObject("sequence").getJSONObject("program").toString())
    root.put("runPolicy", JSONObject().put("kind", "duration").put("cycleCount", 1).put("durationSeconds", 90))
    root.put("completionCue", JSONObject()
      .put("sound", JSONObject().put("kind", "builtin").put("id", "instamatic"))
      .put("volume", 0.45))
    assertTrue(TimerV2Timeline.isValid(root.toString()))
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 1_000L, 1_000L, 1_000L, 91_000L))
    assertEquals(TimerV2Boundary.RUN_COMPLETE, event.boundary)
    assertEquals("instamatic", event.winner.soundId)
    assertEquals(0.45f, event.winner.volume)

    root.put("completionCue", JSONObject().put("volume", 3))
    assertFalse(TimerV2Timeline.isValid(root.toString()))
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
