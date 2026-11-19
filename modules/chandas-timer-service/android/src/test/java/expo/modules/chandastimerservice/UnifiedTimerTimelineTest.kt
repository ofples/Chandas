package expo.modules.chandastimerservice

import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UnifiedTimerTimelineTest {
  @Test fun percentagePointsAndFixedMarkersResolveAcrossRoundsAndDurations() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program")
    val step = program.getJSONArray("steps").getJSONObject(0).put("durationSeconds", 100)
    val track = step.getJSONArray("subBellTracks").getJSONObject(0)
      .put("repeatEnabled", false).put("selectedOffsetsSeconds", JSONArray())
    track.remove("afterStartSeconds"); track.remove("beforeEndSeconds"); track.remove("randomRepeat")
    track.put("points", JSONArray().put(JSONObject().put("id", "quarter").put("kind", "percent").put("value", 25))
      .put(JSONObject().put("id", "fixed").put("kind", "start").put("value", 80))
      .put(JSONObject().put("id", "last").put("kind", "end").put("value", 10)))
    step.put("subBellTracks", JSONArray().put(track))
    program.put("steps", JSONArray().put(step)).put("runPolicy", JSONObject().put("kind", "continuous").put("cycleCount", 1).put("durationSeconds", 1800))
    assertTrue(UnifiedTimerTimeline.isValid(program.toString()))
    assertEquals(26_000L, UnifiedTimerTimeline.next(program.toString(), 1000L, 1000L)!!.at)
    assertEquals(81_000L, UnifiedTimerTimeline.next(program.toString(), 1000L, 26_000L)!!.at)
    assertEquals(126_000L, UnifiedTimerTimeline.next(program.toString(), 1000L, 101_000L)!!.at)
    step.put("durationSeconds", 40)
    assertEquals(11_000L, UnifiedTimerTimeline.next(program.toString(), 1000L, 1000L)!!.at)
    assertEquals(31_000L, UnifiedTimerTimeline.next(program.toString(), 1000L, 11_000L)!!.at)
    step.put("durationSeconds", 60)
    track.put("points", JSONArray().put(JSONObject().put("id", "fraction").put("kind", "percent").put("value", 12.5)))
    assertEquals(9000L, UnifiedTimerTimeline.next(program.toString(), 1000L, 1000L)!!.at)
    for (value in listOf(0.0, 100.0, 1.23)) {
      track.getJSONArray("points").getJSONObject(0).put("value", value)
      assertFalse(UnifiedTimerTimeline.isValid(program.toString()))
    }
  }

  @Test fun independentBellsIgnoreMainCueAndFiniteOffsets() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program")
    val step = program.getJSONArray("steps").getJSONObject(0).put("durationSeconds", 60).put("endAlarmEnabled", true)
    val tracks = step.getJSONArray("subBellTracks")
    for (i in 0 until 2) tracks.getJSONObject(i).apply {
      put("enabled", true).put("repeatEnabled", true).put("cadenceSeconds", if (i == 0) 60 else 300)
      put("selectedOffsetsSeconds", JSONArray()).put("afterStartSeconds", 5).remove("randomRepeat")
    }
    val encoded = program.put("steps", JSONArray().put(step)).put("noMainInterval", true)
      .put("alignment", JSONObject().put("kind", "elapsed")).put("runPolicy", JSONObject().put("kind", "continuous").put("durationSeconds", 30).put("cycleCount", 1))
      .put("completionCue", JSONObject.NULL).toString()
    assertTrue(UnifiedTimerTimeline.isValid(encoded))
    val next = requireNotNull(UnifiedTimerTimeline.next(encoded, 1_000L, 300_999L, terminalAt = null))
    assertEquals(301_000L, next.at)
    assertEquals(2, next.candidates.size)
    assertEquals(tracks.getJSONObject(1).getString("id"), next.winner.trackId)
    assertFalse(next.winner.alarmEnabled)
    val done = requireNotNull(UnifiedTimerTimeline.next(encoded, 1_000L, 1_000L, terminalAt = 31_000L))
    assertTrue(done.completesRun)
    assertTrue(done.winner.hapticsOff)
    assertEquals(0f, done.winner.volume, 0f)
    assertNull(TimerV2Timeline.seekStepTarget(encoded, 1_000L, 1_000L, 1_000L, 0L, 5000))
  }

  @Test fun seekWithinStepKeepsFixedEndTime() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program")
    program.put("runPolicy", JSONObject().put("kind", "duration").put("durationSeconds", 130))
    val encoded = program.toString()
    val target = requireNotNull(TimerV2Timeline.seekStepTarget(encoded, 1_000L, 71_000L, 1_000L, 130_000L, 5000))
    val position = requireNotNull(UnifiedTimerTimeline.position(encoded, target.anchor, 71_000L, target.startedAt, target.endsAt))
    assertEquals(130_000L, target.endsAt)
    assertEquals(1, position.currentStepIndex)
    assertEquals(0.5f, position.stepProgress, 0.001f)
  }

  @Test fun explicitMarkersWinAtBothOffsets() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program")
    val step = program.getJSONArray("steps").getJSONObject(0).put("durationSeconds", 300)
    val tracks = step.getJSONArray("subBellTracks")
    tracks.getJSONObject(0).put("repeatEnabled", true).put("selectedOffsetsSeconds", JSONArray(listOf(120, 180)))
    val marker = tracks.getJSONObject(1).put("repeatEnabled", false).put("afterStartSeconds", 120).put("beforeEndSeconds", 120)
    for (offset in listOf(120_000L, 180_000L)) {
      val at = 1_000L + offset
      val event = requireNotNull(UnifiedTimerTimeline.next(program.toString(), 1_000L, at - 1L, 1_000L, null, 1_000L))
      assertEquals(at, event.at)
      assertEquals(2, event.candidates.size)
      assertEquals(marker.getString("id"), event.winner.trackId)
    }
  }

  @Test fun shortStepsDoNotShareAlarmFlags() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program")
    val steps = program.getJSONArray("steps")
    steps.getJSONObject(0).put("durationSeconds", 10).put("subBellsEnabled", false).put("endAlarmEnabled", true)
    steps.getJSONObject(1).put("durationSeconds", 5).put("subBellsEnabled", false).put("endAlarmEnabled", false)
    val encoded = program.toString()
    val first = requireNotNull(UnifiedTimerTimeline.next(encoded, 1_000L, 1_000L, 1_000L, null, 1_000L))
    val second = requireNotNull(UnifiedTimerTimeline.next(encoded, 1_000L, 11_000L, 1_000L, null, 1_000L))
    assertEquals(11_000L, first.at)
    assertTrue(first.winner.alarmEnabled)
    assertEquals(16_000L, second.at)
    assertFalse(second.winner.alarmEnabled)
  }

  @Test fun queuedAndRingingStepAlarmsExpireByTheFollowingBoundary() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program")
    val steps = program.getJSONArray("steps")
    steps.getJSONObject(0).put("durationSeconds", 10).put("subBellsEnabled", false).put("endAlarmEnabled", true)
    steps.getJSONObject(1).put("durationSeconds", 5).put("subBellsEnabled", false).put("endAlarmEnabled", false)
    val encoded = program.toString()
    val alarm = requireNotNull(TimerV2Timeline.next(encoded, 1_000L, 1_000L, 1_000L, 0L))
    val expiresAt = TimerV2Timeline.stepAlarmExpiresAt(encoded, 1_000L, alarm, 0L)
    assertEquals(16_000L, expiresAt)
    assertFalse(alarmExpired(expiresAt, 15_999L))
    assertTrue(alarmExpired(expiresAt, 16_000L))
    assertEquals(13_000L, TimerV2Timeline.stepAlarmExpiresAt(encoded, 1_000L, alarm, 13_000L))
    val single = JSONObject(encoded).put("steps", JSONArray().put(steps.getJSONObject(0))).toString()
    val cycle = requireNotNull(TimerV2Timeline.next(single, 1_000L, 1_000L, 1_000L, 0L))
    assertEquals(0L, TimerV2Timeline.stepAlarmExpiresAt(single, 1_000L, cycle, 0L))
  }

  @Test fun unarmedStepStaysUnarmedInLongRunningFiveTwoTimer() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program")
    program.put("runPolicy", JSONObject().put("kind", "continuous"))
    val steps = program.getJSONArray("steps")
    steps.getJSONObject(0).put("durationSeconds", 300).put("subBellsEnabled", false).put("endAlarmEnabled", true)
    steps.getJSONObject(1).put("durationSeconds", 120).put("subBellsEnabled", false).put("endAlarmEnabled", false)
    val encoded = program.toString()
    val anchor = 1_000L

    for (round in listOf(0L, 10L, 100L, 10_000L)) {
      val roundStart = anchor + round * 420_000L
      val armed = requireNotNull(TimerV2Timeline.next(encoded, anchor, roundStart, anchor, 0L))
      val ordinary = requireNotNull(TimerV2Timeline.next(encoded, anchor, armed.at, anchor, 0L))
      assertEquals(roundStart + 300_000L, armed.at)
      assertEquals(roundStart + 420_000L, ordinary.at)
      assertTrue(armed.winner.alarmEnabled)
      assertFalse(ordinary.winner.alarmEnabled)
      assertEquals(ordinary.at, TimerV2Timeline.stepAlarmExpiresAt(encoded, anchor, armed, 0L))
    }
  }

  @Test fun independentFixtureMatchesStepBoundariesCollisionsAndVisibility() {
    val fixture = fixtures.getJSONObject("fixture")
    val program = fixture.getJSONObject("program").toString()
    val anchor = fixture.getLong("anchor")
    val seed = fixture.getLong("randomSeed")
    val queries = fixture.getJSONArray("queries")
    for (index in 0 until queries.length()) {
      val expected = queries.getJSONObject(index)
      val event = requireNotNull(UnifiedTimerTimeline.next(program, anchor, expected.getLong("now"), anchor, null, seed)) { expected.getString("name") }
      assertEquals(expected.getString("name"), expected.getLong("at"), event.at)
      assertEquals(expected.getString("name"), expected.getString("stepId"), event.stepId)
      assertEquals(expected.getString("name"), expected.getLong("roundIndex"), event.roundIndex)
      assertEquals(expected.getString("name"), expected.getString("winnerCueId"), event.winner.sourceCueId)
      assertEquals(expected.getString("name"), sourceCueIds(expected.getJSONArray("candidateCueIds")), event.candidates.map { it.sourceCueId })
      assertEquals(expected.getString("name"), expected.getBoolean("visible"), event.showOnWatchFace)
      assertEquals(expected.getString("name"), expected.getBoolean("completesRun"), event.completesRun)
      if (expected.has("alarmEnabled")) assertEquals(expected.getBoolean("alarmEnabled"), event.winner.alarmEnabled)
    }
    val visible = fixture.getJSONArray("visibleQueries").getJSONObject(0)
    val visibleEvent = requireNotNull(UnifiedTimerTimeline.nextVisible(program, anchor, visible.getLong("now"), anchor, null, seed))
    assertEquals(visible.getLong("at"), visibleEvent.at)
    assertEquals(visible.getString("winnerCueId"), visibleEvent.winner.sourceCueId)
  }

  @Test fun matchesBoundedTerminalFallbackAndCycleCountRules() {
    val fixture = fixtures.getJSONObject("fixture")
    val program = fixture.getJSONObject("program")
    val queries = fixture.getJSONArray("boundedQueries")
    for (index in 0 until queries.length()) {
      val expected = queries.getJSONObject(index)
      val bounded = JSONObject(program.toString()).put("runPolicy", JSONObject().put("kind", if (expected.has("durationSeconds")) "duration" else "cycles").put("cycleCount", expected.optInt("cycleCount", 1)).put("durationSeconds", expected.optLong("durationSeconds", 75L)))
      val anchor = fixture.getLong("anchor")
      val startedAt = expected.optLong("startedAt", anchor)
      val terminalAt = requireNotNull(UnifiedTimerTimeline.runEndAt(bounded.toString(), anchor, startedAt))
      val event = requireNotNull(UnifiedTimerTimeline.next(bounded.toString(), anchor, expected.getLong("now"), startedAt, terminalAt, fixture.getLong("randomSeed"))) { expected.getString("name") }
      assertEquals(expected.getString("name"), expected.getLong("at"), event.at)
      assertEquals(expected.getString("name"), expected.getBoolean("completesRun"), event.completesRun)
      if (expected.has("winnerCueId")) assertEquals(expected.getString("winnerCueId"), event.winner.sourceCueId)
      if (expected.has("soundId")) assertEquals(expected.getString("soundId"), event.winner.soundId)
      if (expected.has("visible")) assertEquals(expected.getBoolean("visible"), event.showOnWatchFace)
    }
    val atZero = JSONObject(program.toString()).put("runPolicy", JSONObject().put("kind", "cycles").put("cycleCount", 1).put("durationSeconds", 75))
    assertEquals(100_000L, UnifiedTimerTimeline.runEndAt(atZero.toString(), 0L, 0L))
  }

  @Test fun cueIdentitiesAreStepScopedAndDelimiterSafe() {
    val fixtureProgram = JSONObject(fixtures.getJSONObject("fixture").getJSONObject("program").toString())
    val steps = fixtureProgram.getJSONArray("steps")
    val first = steps.getJSONObject(0).put("id", "a:b")
    first.getJSONArray("subBellTracks").getJSONObject(0).put("id", "c")
    val second = steps.getJSONObject(1).put("id", "a")
    second.getJSONArray("subBellTracks").getJSONObject(0).put("id", "c")
    val program = fixtureProgram.toString()
    val firstEvent = requireNotNull(UnifiedTimerTimeline.next(program, 1_000L, 1_000L, 1_000L, null, 1_000L))
    val secondEvent = requireNotNull(UnifiedTimerTimeline.next(program, 1_000L, 61_000L, 1_000L, null, 1_000L))
    assertEquals(firstEvent.winner.sourceCueId, secondEvent.winner.sourceCueId)
    assertNotEquals(firstEvent.winner.cueId, secondEvent.winner.cueId)
  }

  @Test fun cueCandidatePreservesPrimaryAndOrderedSoundAndHapticMetadata() {
    val root = JSONObject(fixtures.getJSONObject("fixture").getJSONObject("program").toString())
    val cue = root.getJSONArray("steps").getJSONObject(0).getJSONObject("endCue")
      .put("sound", JSONObject().put("kind", "builtin").put("id", "temple-gong"))
      .put("sounds", JSONArray().put(JSONObject().put("kind", "builtin").put("id", "clear-bell")).put(JSONObject().put("kind", "builtin").put("id", "page")))
      .put("soundMode", "random")
      .put("hapticOverride", JSONObject().put("pattern", "double").put("strength", "strong"))
    val event = requireNotNull(UnifiedTimerTimeline.next(root.toString(), 1_000L, 56_000L, 1_000L, null, 1_000L))
    val candidate = event.winner
    assertEquals("temple-gong", candidate.soundId)
    assertEquals(listOf("clear-bell", "page"), candidate.soundIds)
    assertEquals("random", candidate.soundMode)
    assertEquals(HapticProfileConfig("double", "strong"), candidate.hapticOverride)
  }

  @Test fun disabledStepLayerOrDisabledTracksRetainSettingsAndSkipAllSubBells() {
    val root = JSONObject(fixtures.getJSONObject("fixture").getJSONObject("program").toString())
    val step = root.getJSONArray("steps").getJSONObject(0)
    val tracksBefore = step.getJSONArray("subBellTracks").toString()
    step.put("subBellsEnabled", false)
    var event = requireNotNull(UnifiedTimerTimeline.next(root.toString(), 1_000L, 1_000L, 1_000L, null, 1_000L))
    assertEquals(61_000L, event.at)
    assertEquals("work", event.winner.sourceCueId)
    assertEquals(tracksBefore, step.getJSONArray("subBellTracks").toString())
    step.put("subBellsEnabled", true)
    val tracks = step.getJSONArray("subBellTracks")
    for (index in 0 until tracks.length()) tracks.getJSONObject(index).put("enabled", false)
    val configuredCount = tracks.length()
    event = requireNotNull(UnifiedTimerTimeline.next(root.toString(), 1_000L, 1_000L, 1_000L, null, 1_000L))
    assertEquals(61_000L, event.at)
    assertEquals("work", event.winner.sourceCueId)
    assertEquals(configuredCount, tracks.length())
    assertTrue((0 until tracks.length()).all { !tracks.getJSONObject(it).getBoolean("enabled") })
  }

  @Test fun variedRandomGapsMatchTheJavaScriptUtf16LcgVector() {
    val root = JSONObject(fixtures.getJSONObject("fixture").getJSONObject("program").toString())
    val step = root.getJSONArray("steps").getJSONObject(0)
    val track = JSONObject()
      .put("id", "rand-😀")
      .put("label", "random")
      .put("enabled", true)
      .put("showOnWatchFace", true)
      .put("cadenceSeconds", 10)
      .put("repeatEnabled", false)
      .put("selectedOffsetsSeconds", JSONArray())
      .put("randomRepeat", JSONObject().put("minSeconds", 5).put("maxSeconds", 17))
      .put("sound", JSONObject().put("kind", "builtin").put("id", "clear-bell"))
      .put("volume", 1)
    step.put("subBellTracks", JSONArray().put(track))
    val serialized = root.toString()
    val offsets = mutableListOf<Long>()
    var now = 1_000L
    repeat(10) {
      val event = requireNotNull(UnifiedTimerTimeline.next(serialized, 1_000L, now, 1_000L, null, 1_000L))
      if (event.stepId != "work" || event.offsetSeconds == null) return@repeat
      offsets.add(event.offsetSeconds)
      now = event.at
    }
    assertEquals(listOf(12L, 27L, 32L, 42L, 48L, 54L), offsets)
  }

  @Test fun sharedRandomVectorsMatchAcrossRoundsAndShiftedPhaseAnchors() {
    val vectors = JSONObject(requireNotNull(javaClass.getResourceAsStream("/timer-unified-random-vectors.json")).use { String(it.readBytes(), StandardCharsets.UTF_8) })
    val duration = vectors.getLong("stepDurationSeconds")
    val range = vectors.getJSONObject("range")
    val values = vectors.getJSONArray("vectors")
    for (vectorIndex in 0 until values.length()) {
      val vector = values.getJSONObject(vectorIndex)
      val program = JSONObject()
        .put("schemaVersion", 4)
        .put("mode", "unified")
        .put("alignment", JSONObject().put("kind", "elapsed"))
        .put("completionCue", JSONObject.NULL)
        .put("runPolicy", JSONObject().put("kind", "continuous").put("cycleCount", 1).put("durationSeconds", 75))
        .put("steps", JSONArray().put(JSONObject()
          .put("id", "random-step")
          .put("label", "Random")
          .put("durationSeconds", duration)
          .put("endCue", JSONObject().put("sound", JSONObject().put("kind", "builtin").put("id", "temple-gong")).put("volume", 1))
          .put("endAlarmEnabled", false)
          .put("subBellsEnabled", true)
          .put("subBellTracks", JSONArray().put(JSONObject()
            .put("id", vector.getString("trackId"))
            .put("label", "Random track")
            .put("enabled", true)
            .put("showOnWatchFace", true)
            .put("cadenceSeconds", 10)
            .put("repeatEnabled", false)
            .put("selectedOffsetsSeconds", JSONArray())
            .put("randomRepeat", JSONObject().put("minSeconds", range.getInt("minSeconds")).put("maxSeconds", range.getInt("maxSeconds")))
            .put("sound", JSONObject().put("kind", "builtin").put("id", "clear-bell"))
            .put("volume", 1)))))
      val serialized = program.toString()
      assertTrue(UnifiedTimerTimeline.isValid(serialized))
      val seed = vector.getLong("randomSeed")
      val rounds = vector.getJSONArray("roundOffsets")
      for (roundIndex in 0 until rounds.length()) {
        val expectedArray = rounds.getJSONArray(roundIndex)
        val expected = (0 until expectedArray.length()).map { expectedArray.getLong(it) }
        val start = 1_000L + roundIndex * duration * 1_000L
        assertEquals(expected, collectOffsets(serialized, start, seed, 1_000L))
      }
      val shiftedSeedOffsets = collectOffsets(serialized, 71_000L, seed, 71_000L)
      assertEquals((0 until rounds.getJSONArray(0).length()).map { rounds.getJSONArray(0).getLong(it) }, shiftedSeedOffsets)
    }
  }

  @Test fun validatesEverySharedMalformedFieldMutationWithoutCoercion() {
    val base = JSONObject(fixtures.getJSONObject("fixture").getJSONObject("program").toString())
    assertTrue(UnifiedTimerTimeline.isValid(base.toString()))
    val mutations = fixtures.getJSONArray("invalid")
    for (index in 0 until mutations.length()) {
      val mutation = mutations.getJSONObject(index)
      val root = JSONObject(base.toString())
      val path = mutation.getJSONArray("path")
      var parent: Any = root
      for (pathIndex in 0 until path.length() - 1) {
        val part = path.get(pathIndex)
        parent = if (parent is JSONObject) parent.get(part as String) else (parent as JSONArray).get((part as Number).toInt())
      }
      val leaf = path.get(path.length() - 1)
      if (mutation.optBoolean("remove")) (parent as JSONObject).remove(leaf as String)
      else if (parent is JSONObject) parent.put(leaf as String, mutation.get("value"))
      else (parent as JSONArray).put((leaf as Number).toInt(), mutation.get("value"))
      assertFalse(mutation.getString("name"), UnifiedTimerTimeline.isValid(root.toString()))
    }
  }

  @Test fun skipMuteAndPositionUseWholeOrderedRounds() {
    val program = fixtures.getJSONObject("fixture").getJSONObject("program").toString()
    val position = requireNotNull(UnifiedTimerTimeline.position(program, 1_000L, 71_000L, 1_000L, null, 1_000L))
    assertEquals("rest", position.currentStepId)
    assertEquals(1, position.currentStepIndex)
    assertEquals(0.25f, position.stepProgress, 0.0001f)
    val mute = requireNotNull(UnifiedTimerTimeline.iterationEnd(program, 1_000L, 71_000L, 2))
    assertEquals(201_000L, mute.at)
    assertEquals(UnifiedTimerTimeline.next(program, 1_000L, 200_999L, 1_000L, null, 1_000L)?.logicalId, mute.logicalId)
    assertEquals(-29_000L, UnifiedTimerTimeline.skipTarget(program, 1_000L, 71_000L, 1_000L, null, 1)?.anchor)
    assertEquals(71_000L, UnifiedTimerTimeline.skipTarget(program, 1_000L, 71_000L, 1_000L, null, -1)?.anchor)
    assertTrue(requireNotNull(UnifiedTimerTimeline.skipTarget(program, 1_000L, 70_000L, 1_000L, 76_000L, 1)).completesRun)

    val bounded = JSONObject(program).put("runPolicy", JSONObject().put("kind", "cycles").put("cycleCount", 2).put("durationSeconds", 75))
    val originalEnd = requireNotNull(UnifiedTimerTimeline.runEndAt(bounded.toString(), 1_000L, 1_000L))
    val shifted = requireNotNull(UnifiedTimerTimeline.skipTarget(bounded.toString(), 1_000L, 71_000L, 1_000L, originalEnd, 1))
    assertEquals(-29_000L, shifted.anchor)
    assertEquals(-29_000L, shifted.startedAt)
    assertEquals(171_000L, shifted.terminalAt)
    assertEquals(shifted.terminalAt, UnifiedTimerTimeline.runEndAt(bounded.toString(), shifted.anchor, shifted.startedAt))
  }

  private fun sourceCueIds(values: JSONArray): List<String> = (0 until values.length()).map { values.getString(it) }

  private fun collectOffsets(program: String, stepStart: Long, seed: Long, anchor: Long): List<Long> {
    val values = mutableListOf<Long>()
    var now = stepStart
    repeat(64) {
      val event = requireNotNull(UnifiedTimerTimeline.next(program, anchor, now, anchor, null, seed))
      if (event.stepId != "random-step" || event.offsetSeconds == null) return values
      values.add(event.offsetSeconds)
      now = event.at
    }
    error("Random schedule did not reach its boundary")
  }

  private val fixtures: JSONObject by lazy {
    val timeline = requireNotNull(javaClass.getResourceAsStream("/timer-unified-timeline.json"))
    val invalid = requireNotNull(javaClass.getResourceAsStream("/timer-unified-invalid-fields.json"))
    JSONObject().put("fixture", JSONObject(timeline.use { String(it.readBytes(), StandardCharsets.UTF_8) }))
      .put("invalid", JSONArray(invalid.use { String(it.readBytes(), StandardCharsets.UTF_8) }))
  }
}
