package expo.modules.chandastimerservice

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UnifiedTimerOverlayProgramTest {
  private fun program(): JSONObject = JSONObject(requireNotNull(javaClass.getResourceAsStream("/timer-unified-timeline.json")).bufferedReader().use { it.readText() }).getJSONObject("program")
  private fun legacyFixture(): JSONObject = JSONObject(requireNotNull(javaClass.getResourceAsStream("/timer-v2-timeline.json")).bufferedReader().use { it.readText() })

  @Test fun togglesCanonicalStepAlarmAndPreservesEveryOtherProgramField() {
    val source = program().put("nativeExtension", "preserve-me")
    val original = source.toString()
    assertTrue(TimerV2Timeline.isValid(original))
    val updated = requireNotNull(UnifiedTimerOverlayProgram.toggleStepAlarm(original, "rest"))
    val result = JSONObject(updated)
    assertEquals("preserve-me", result.getString("nativeExtension"))
    assertEquals(source.getJSONArray("steps").getJSONObject(0).toString(), result.getJSONArray("steps").getJSONObject(0).toString())
    assertFalse(result.getJSONArray("steps").getJSONObject(1).getBoolean("endAlarmEnabled"))
    assertEquals(source.getJSONArray("steps").getJSONObject(1).getJSONArray("subBellTracks").toString(), result.getJSONArray("steps").getJSONObject(1).getJSONArray("subBellTracks").toString())
    assertTrue(TimerV2Timeline.isValid(updated))
    val restored = requireNotNull(UnifiedTimerOverlayProgram.toggleStepAlarm(updated, "rest"))
    assertEquals(original, restored)
  }

  @Test fun refusesUnknownStepAndLegacyPatternWithoutRewritingTheProgram() {
    val source = program().toString()
    assertNull(UnifiedTimerOverlayProgram.toggleStepAlarm(source, "missing"))
    val pattern = legacyFixture().getJSONObject("patternCollision").getJSONObject("program").toString()
    assertNull(UnifiedTimerOverlayProgram.toggleStepAlarm(pattern, "higher"))
  }

  @Test fun retainsLegacySequenceAlarmFieldWhileSupportingTheExistingSchemaRange() {
    val source = legacyFixture().getJSONObject("sequence").getJSONObject("program").toString()
    assertTrue(TimerV2Timeline.isValid(source))
    val updated = requireNotNull(UnifiedTimerOverlayProgram.toggleStepAlarm(source, "work"))
    val root = JSONObject(updated)
    assertTrue(root.getJSONArray("steps").getJSONObject(1).getBoolean("alarmEnabled"))
    val restored = JSONObject(requireNotNull(UnifiedTimerOverlayProgram.toggleStepAlarm(updated, "work")))
    assertFalse(restored.getJSONArray("steps").getJSONObject(1).getBoolean("alarmEnabled"))
    assertTrue(TimerV2Timeline.isValid(restored.toString()))
  }
}
