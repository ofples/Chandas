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
}
