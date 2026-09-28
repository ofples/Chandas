package expo.modules.chandastimerservice

import android.content.Context
import androidx.core.os.bundleOf
import org.json.JSONObject

/** Invoked under TimerScheduler's monitor, alongside normal timer transactions. */
internal object FloatingTimerActions {
  private const val PREFS = "chandas-floating-overlay"
  private const val PHASE_KEYS = "phaseKeys"
  private const val PENDING_DESTINATION = "pendingDestination"

  fun perform(context: Context, action: String): android.os.Bundle {
    if (action == "overlay-layout-ready") {
      FloatingTimerOverlay.contentReady(context)
      return result(context, true)
    }
    val current = TimerStateStore.load(context)
    if (action == "collapse" || action == "expand") {
      FloatingTimerOverlay.setExpanded(context, action == "expand")
      return result(context, true)
    }
    if (action == "open-running" || action == "open-clock" || action == "open-sound") {
      val destination = when (action) {
        "open-clock" -> "clock"
        "open-sound" -> "sound"
        else -> null
      }
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: return result(context, false, "open-app")
      intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (destination != null) prefs.edit().putString(PENDING_DESTINATION, destination).apply()
      return if (runCatching { context.startActivity(intent) }.isSuccess) result(context, true)
      else {
        if (destination != null) prefs.edit().remove(PENDING_DESTINATION).apply()
        result(context, false, "open-app")
      }
    }
    if (current == null || TimerStateStore.isRinging(context)) return result(context, false, "inactive")
    val accepted = when (action) {
      "restart" -> reanchor(context, current, align = false)
      "pause" -> TimerScheduler.setPaused(context, true)
      "resume" -> TimerScheduler.setPaused(context, false)
      "next-step" -> TimerScheduler.skipSequence(context, 1)
      "previous-step" -> TimerScheduler.skipSequence(context, -1)
      "toggle-clock" -> reanchor(context, current, align = !TimerV2Timeline.isLocalClock(current.timerV2Program ?: ""))
      "alarm", "alarm-single" -> alarm(context, current, false)
      "alarm-double" -> alarm(context, current, true)
      "mute" -> { TimerScheduler.muteForIterations(context, 1); true }
      "clear-mute" -> { TimerScheduler.clearMute(context); true }
      "stop" -> { TimerScheduler.stop(context); TimerStateStore.load(context) == null }
      else -> if (action.startsWith("toggle-step-alarm:")) toggleStepAlarm(context, current, action.removePrefix("toggle-step-alarm:")) else false
    }
    FloatingTimerOverlay.reconcile(context)
    FloatingTimerOverlay.emitSnapshot(context)
    if (accepted && action != "stop") FloatingTimerOverlay.interaction(context)
    return result(context, accepted, if (accepted) null else "action-rejected")
  }

  fun consumeDestination(context: Context): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val destination = prefs.getString(PENDING_DESTINATION, null)
      ?.takeIf { it == "clock" || it == "sound" }
    if (destination != null) prefs.edit().remove(PENDING_DESTINATION).apply()
    return destination
  }

  private fun result(context: Context, success: Boolean, error: String? = null) = bundleOf(
    "success" to success,
    "error" to error,
    "snapshot" to FloatingTimerOverlay.snapshot(context),
  )

  private fun alarm(context: Context, config: TimerConfig, double: Boolean): Boolean {
    val program = config.timerV2Program ?: return false
    if (TimerV2Timeline.isSequence(program)) return false
    val controls = TimerStateStore.getControlState(context)
    val current = when {
      config.alarmModeEnabled -> "locked"
      controls.alarmOnceArmed -> "once"
      else -> "off"
    }
    val next = if (double) { if (current == "locked") "off" else "locked" }
      else { if (current == "off") "once" else "off" }
    if (config.alarmModeEnabled != (next == "locked")) TimerScheduler.update(context, config.copy(alarmModeEnabled = next == "locked"))
    val after = TimerStateStore.getControlState(context)
    if (after.alarmOnceArmed != (next == "once")) TimerScheduler.toggleAlarmOnce(context)
    val saved = TimerStateStore.load(context) ?: return false
    return saved.alarmModeEnabled == (next == "locked") && TimerStateStore.getControlState(context).alarmOnceArmed == (next == "once")
  }

  private fun toggleStepAlarm(context: Context, config: TimerConfig, stepId: String): Boolean {
    val serialized = config.timerV2Program ?: return false
    val root = runCatching { JSONObject(serialized) }.getOrNull() ?: return false
    if (root.optString("mode") != "sequence") return false
    val steps = root.optJSONArray("steps") ?: return false
    val step = (0 until steps.length()).mapNotNull { steps.optJSONObject(it) }.firstOrNull { it.optString("id") == stepId } ?: return false
    step.put("alarmEnabled", !step.optBoolean("alarmEnabled", false))
    val updated = root.toString().takeIf { it.length <= NativeTimerContract.MAX_PROGRAM_CHARACTERS && TimerV2Timeline.isValid(it) } ?: return false
    TimerScheduler.update(context, config.copy(timerV2Program = updated))
    return TimerStateStore.load(context)?.timerV2Program == updated
  }

  private fun reanchor(context: Context, config: TimerConfig, align: Boolean): Boolean {
    val serialized = config.timerV2Program ?: return false
    val root = runCatching { JSONObject(serialized) }.getOrNull() ?: return false
    val duration = TimerV2Timeline.cycleDuration(serialized) ?: return false
    val currentAlignment = root.optJSONObject("alignment")
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (currentAlignment?.optString("kind") == "local-clock") {
      val previous = currentAlignment.optInt("offsetMinutes", 0)
      if (previous in 0..59) rememberPhase(context, duration, previous)
    }
    val offset = prefs.getInt("phase:$duration", 0).coerceIn(0, 59)
    root.put("alignment", if (align) JSONObject().put("kind", "local-clock").put("offsetMinutes", offset)
      else JSONObject().put("kind", "elapsed"))
    val program = root.toString().takeIf { it.length <= NativeTimerContract.MAX_PROGRAM_CHARACTERS && TimerV2Timeline.isValid(it) }
      ?: return false
    val now = System.currentTimeMillis()
    val anchor = if (align) TimerV2Timeline.alignedAnchor(program, now) ?: return false else now
    val endsAt = TimerV2Timeline.runEndAt(program, anchor, now) ?: 0L
    val controls = TimerStateStore.getControlState(context)
    val replacement = config.copy(
      phase = anchor,
      timerV2Program = program,
      timerV2Anchor = anchor,
      timerV2StartedAt = now,
      timerV2EndsAt = endsAt,
      timerV2RandomSeed = now,
      timerV2PausedAt = 0L,
      timerV2ClockRejoinAt = 0L,
    )
    val preserved = controls.copy(mutedIterationsRemaining = 0, mutedIterationEndId = null, mutedIterationEndAt = 0L)
    return TimerScheduler.start(context, replacement, preserved)
  }

  private fun rememberPhase(context: Context, duration: Long, offset: Int) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val keys = prefs.getString(PHASE_KEYS, "")!!.split(',').filter { it.isNotEmpty() && it != duration.toString() }.toMutableList()
    keys.add(duration.toString())
    val edit = prefs.edit().putInt("phase:$duration", offset)
    while (keys.size > 16) edit.remove("phase:${keys.removeAt(0)}")
    edit.putString(PHASE_KEYS, keys.joinToString(",")).apply()
  }
}
