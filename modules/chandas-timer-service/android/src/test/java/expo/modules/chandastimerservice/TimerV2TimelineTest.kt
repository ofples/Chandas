package expo.modules.chandastimerservice

import java.nio.charset.StandardCharsets
import java.util.TimeZone
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

  @Test fun patternCollisionUsesSlowerCadenceAndStableIdentity() {
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

  @Test fun patternCollisionDoesNotDependOnUntrustedSerializedTrackOrder() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    val tracks = root.getJSONArray("tracks")
    root.put("tracks", org.json.JSONArray().put(tracks.getJSONObject(1)).put(tracks.getJSONObject(0)))
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 0L, 9 * 60_000L))
    assertEquals("higher", event.winner.cueId)
    assertEquals(5, event.winner.cadenceMinutes)
  }

  @Test fun notificationTitleIsBoundedAndOldProgramsWithoutLabelsStillRestore() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    assertTrue(TimerV2Timeline.isValid(root.toString()))
    assertEquals(null, TimerV2Timeline.notificationTitle(root.toString()))
    root.put("label", "Meditation")
    assertTrue(TimerV2Timeline.isValid(root.toString()))
    assertEquals("Meditation", TimerV2Timeline.notificationTitle(root.toString()))
    root.put("label", "x".repeat(61))
    assertFalse(TimerV2Timeline.isValid(root.toString()))
    assertEquals(null, TimerV2Timeline.notificationTitle(root.toString()))
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

  @Test fun notificationContextTracksTheCurrentSequenceStep() {
    val fixture = fixtures.getJSONObject("sequence")
    val program = fixture.getJSONObject("program").toString()
    val anchor = fixture.getLong("anchor")

    assertEquals(TimerV2NotificationContext("Prepare", "1P"), TimerV2Timeline.notificationContext(program, anchor, 0L))
    assertEquals(TimerV2NotificationContext("Deep work", "2D"), TimerV2Timeline.notificationContext(program, anchor, 300_000L))
    assertEquals(TimerV2NotificationContext("Reset", "3R"), TimerV2Timeline.notificationContext(program, anchor, 1_800_000L))
    assertEquals(TimerV2NotificationContext("Prepare", "1P"), TimerV2Timeline.notificationContext(program, anchor, 1_920_000L))
  }

  @Test fun notificationContextNamesPatternAndSupportsOlderPrograms() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    assertEquals(TimerV2NotificationContext("Main interval", "M"), TimerV2Timeline.notificationContext(root.toString(), 0L, 0L))
    root.put("label", "Meditation")
    assertEquals(TimerV2NotificationContext("Meditation", "M"), TimerV2Timeline.notificationContext(root.toString(), 0L, 0L))
  }

  @Test fun exactSecondDurationsDrivePatternAndSequenceBoundaries() {
    val pattern = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
      .put("mainMinutes", 1)
      .put("mainDurationSeconds", 30)
      .put("tracks", org.json.JSONArray())
    assertTrue(TimerV2Timeline.isValid(pattern.toString()))
    assertEquals(31_000L, requireNotNull(TimerV2Timeline.next(pattern.toString(), 1_000L, 1_000L)).at)

    val sequence = JSONObject(fixtures.getJSONObject("sequence").getJSONObject("program").toString())
    sequence.getJSONArray("steps").getJSONObject(0).put("durationMinutes", 1).put("durationSeconds", 20)
    sequence.getJSONArray("steps").getJSONObject(1).put("durationMinutes", 1).put("durationSeconds", 10)
    assertTrue(TimerV2Timeline.isValid(sequence.toString()))
    assertEquals(21_000L, requireNotNull(TimerV2Timeline.next(sequence.toString(), 1_000L, 1_000L)).at)
    assertEquals(31_000L, requireNotNull(TimerV2Timeline.next(sequence.toString(), 1_000L, 21_000L)).at)
  }

  @Test fun exactSecondSubBellCadenceDrivesOffsetsAndCollisionPriority() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    val tracks = root.getJSONArray("tracks")
    tracks.getJSONObject(0)
      .put("cadenceMinutes", 2)
      .put("cadenceSeconds", 90)
      .put("selectedOffsetsMinutes", org.json.JSONArray())
      .put("selectedOffsetsSeconds", org.json.JSONArray().put(90).put(180))
    tracks.getJSONObject(1)
      .put("cadenceMinutes", 1)
      .put("cadenceSeconds", 30)
      .put("selectedOffsetsMinutes", org.json.JSONArray())
      .put("selectedOffsetsSeconds", org.json.JSONArray().put(90).put(180))

    assertTrue(TimerV2Timeline.isValid(root.toString()))
    val event = requireNotNull(TimerV2Timeline.next(root.toString(), 0L, 89_000L))
    assertEquals(90_000L, event.at)
    assertEquals("pattern:0:0:offset-seconds:90", event.logicalId)
    assertEquals("higher", event.winner.cueId)
    assertEquals(90L, event.winner.cadenceSeconds)

    tracks.getJSONObject(0).remove("selectedOffsetsSeconds")
    assertFalse(TimerV2Timeline.isValid(root.toString()))
  }

  @Test fun localClockAlignmentSupportsExactCyclesAndWholeSequenceRounds() {
    val previousTimezone = TimeZone.getDefault()
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    try {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    root.put("mainMinutes", 2).put("mainDurationSeconds", 75).put("tracks", org.json.JSONArray())
    root.put("alignment", JSONObject().put("kind", "local-clock").put("offsetMinutes", 0))
    assertTrue(TimerV2Timeline.isValid(root.toString()))
    val now = 10L * 60L * 60_000L + 17L * 60_000L + 42_123L
    assertEquals(10L * 60L * 60_000L + 17L * 60_000L + 30_000L, TimerV2Timeline.alignedAnchor(root.toString(), now))

    val sequence = JSONObject(fixtures.getJSONObject("sequence").getJSONObject("program").toString())
    sequence.getJSONArray("steps").getJSONObject(0).put("durationMinutes", 2).put("durationSeconds", 90)
    sequence.getJSONArray("steps").getJSONObject(1).put("durationMinutes", 4).put("durationSeconds", 210)
    sequence.getJSONArray("steps").remove(2)
    sequence.put("alignment", JSONObject().put("kind", "local-clock").put("offsetMinutes", 0))
    assertTrue(TimerV2Timeline.isValid(sequence.toString()))
    assertTrue(TimerV2Timeline.isLocalClock(sequence.toString()))
    assertEquals(10L * 60L * 60_000L + 15L * 60_000L, TimerV2Timeline.alignedAnchor(sequence.toString(), now))
    } finally {
      TimeZone.setDefault(previousTimezone)
    }
  }

  @Test fun rejectsFutureSchemaAndDuplicateIds() {
    val valid = fixtures.getJSONObject("sequence").getJSONObject("program")
    assertFalse(TimerV2Timeline.isValid(JSONObject(valid.toString()).put("schemaVersion", 99).toString()))
    assertFalse(TimerV2Timeline.isValid(JSONObject(valid.toString()).put("alignment", "local-clock").toString()))
    val duplicate = JSONObject(valid.toString())
    duplicate.getJSONArray("steps").getJSONObject(1).put("id", "prepare")
    assertFalse(TimerV2Timeline.isValid(duplicate.toString()))
  }

  @Test fun acceptsProductionAndFutureBuiltInSoundIdsWithoutANativeRegistry() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    val productionIds = listOf(
      "temple-gong", "clear-bell", "bloom", "boxing-bell", "bubble", "champagne", "cymbal", "handpan", "heartbeat",
      "ice", "instamatic", "mouse-click", "page", "sine-bass", "sine-high", "sine-low", "water-drop", "wind",
    )
    productionIds.forEach { id ->
      root.getJSONObject("mainCue").getJSONObject("sound").put("id", id)
      assertTrue("Timeline rejected $id", TimerV2Timeline.isValid(root.toString()))
      assertTrue("Identifier rejected $id", TimerSoundIds.isValid(id))
    }
    root.getJSONObject("mainCue").getJSONObject("sound").put("id", "future-ota-sound")
    assertTrue(TimerV2Timeline.isValid(root.toString()))
    assertTrue(TimerSoundIds.isValid("future-ota-sound"))
    assertEquals("handpan", TimerSoundIds.canonical("soft-bowl"))
    assertEquals("instamatic", TimerSoundIds.canonical("wood-block"))
    assertEquals("bloom", TimerSoundIds.canonical("bright-chime"))

    listOf("", "123", "Uppercase", "../escape", "ends-", "a".repeat(65)).forEach { invalidId ->
      root.getJSONObject("mainCue").getJSONObject("sound").put("id", invalidId)
      assertFalse("Timeline accepted unsafe sound id: $invalidId", TimerV2Timeline.isValid(root.toString()))
    }
    assertTrue(TimerSoundPlayer.builtInResource("temple-gong") != null)
    assertTrue(TimerSoundPlayer.builtInResource("clear-bell") != null)
    assertTrue(TimerSoundPlayer.builtInResource("future-ota-sound") == null)
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

  @Test fun persistedDeadlineMustMatchTheRunPolicyExactly() {
    val root = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    root.put("runPolicy", JSONObject().put("kind", "cycles").put("cycleCount", 2).put("durationSeconds", 1_800))
    val anchor = 1_000L
    val startedAt = 12 * 60_000L + anchor
    val endAt = requireNotNull(TimerV2Timeline.runEndAt(root.toString(), anchor, startedAt))

    assertTrue(TimerV2Timeline.hasMatchingRunEnd(root.toString(), anchor, startedAt, endAt))
    assertFalse(TimerV2Timeline.hasMatchingRunEnd(root.toString(), anchor, startedAt, endAt + 1L))
    assertFalse(TimerV2Timeline.hasMatchingRunEnd(root.toString(), anchor, startedAt, 0L))

    root.put("runPolicy", JSONObject().put("kind", "continuous").put("cycleCount", 2).put("durationSeconds", 1_800))
    assertTrue(TimerV2Timeline.hasMatchingRunEnd(root.toString(), anchor, startedAt, 0L))
    assertFalse(TimerV2Timeline.hasMatchingRunEnd(root.toString(), anchor, startedAt, endAt))
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

  @Test fun nativeSafetyEnvelopeExceedsCurrentProductLimits() {
    val pattern = JSONObject(fixtures.getJSONObject("patternCollision").getJSONObject("program").toString())
    pattern.put("mainMinutes", 241)
    pattern.getJSONObject("mainCue").put("volume", 1.0)
    pattern.put("tracks", org.json.JSONArray())
    assertTrue(TimerV2Timeline.isValid(pattern.toString()))

    val sequence = JSONObject(fixtures.getJSONObject("sequence").getJSONObject("program").toString())
    val steps = sequence.getJSONArray("steps")
    while (steps.length() < 21) {
      steps.put(JSONObject(steps.getJSONObject(0).toString()).put("id", "future-step-${steps.length()}"))
    }
    assertTrue(TimerV2Timeline.isValid(sequence.toString()))
  }
}
