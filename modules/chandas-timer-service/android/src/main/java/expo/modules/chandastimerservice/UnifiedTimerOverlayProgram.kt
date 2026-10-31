package expo.modules.chandastimerservice

import org.json.JSONObject

/** Pure JSON edit used by the floating overlay without touching authored cue data. */
internal object UnifiedTimerOverlayProgram {
  fun toggleStepAlarm(serialized: String, stepId: String): String? = runCatching {
    if (!TimerV2Timeline.isValid(serialized)) return null
    val root = JSONObject(serialized)
    val unified = root.optString("mode") == "unified"
    if (!unified && root.optString("mode") != "sequence") return null
    val steps = root.optJSONArray("steps") ?: return null
    val field = if (unified) "endAlarmEnabled" else "alarmEnabled"
    val step = (0 until steps.length()).mapNotNull { steps.optJSONObject(it) }
      .firstOrNull { it.opt("id") == stepId } ?: return null
    val enabled = if (!step.has(field) && !unified) false else step.opt(field) as? Boolean ?: return null
    step.put(field, !enabled)
    root.toString().takeIf(TimerV2Timeline::isValid)
  }.getOrNull()
}
