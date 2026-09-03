package expo.modules.chandastimerservice

import android.content.Context

object TimerStateStore {
  private const val PREFS = "chandas-native-state"
  private const val ACTIVE = "active"
  private const val RINGING = "ringing"
  private const val ALARM_VISIBLE = "alarmVisible"
  private const val NEXT_AT = "nextAt"
  private const val NEXT_TYPE = "nextType"
  private const val NEXT_LOGICAL_ID = "nextLogicalId"
  private const val SESSION_GENERATION = "sessionGeneration"
  private const val ALARM_ONCE = "alarmOnce"
  private const val MUTED_UNTIL = "mutedUntil"
  private const val MUTED_ITERATIONS = "mutedIterations"
  private const val MUTED_ITERATION_END_ID = "mutedIterationEndId"
  private const val MUTED_ITERATION_END_AT = "mutedIterationEndAt"

  fun save(context: Context, config: TimerConfig) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(ACTIVE, true)
      .putLong("mainMs", config.mainMs)
      .putLong("subMs", config.subMs)
      .putLong("phase", config.phase)
      .putBoolean("subEnabled", config.subEnabled)
      .putFloat("volume", config.volume)
      .putBoolean("notificationsEnabled", config.notificationsEnabled)
      .putBoolean("focusModeEnabled", config.focusModeEnabled)
      .putBoolean("alarmModeEnabled", config.alarmModeEnabled)
      .putBoolean("activeHoursEnabled", config.activeHoursEnabled)
      .putInt("activeHoursStart", config.activeHoursStart)
      .putInt("activeHoursEnd", config.activeHoursEnd)
      .putInt("activeHoursDays", config.activeHoursDays)
      .putInt("alarmDurationSeconds", config.alarmDurationSeconds)
      .putString("timerV2Program", config.timerV2Program)
      .putLong("timerV2Anchor", config.timerV2Anchor)
      .commit()
  }

  fun load(context: Context): TimerConfig? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(ACTIVE, false)) return null
    val mainMs = prefs.getLong("mainMs", 0L)
    val subMs = prefs.getLong("subMs", 0L)
    if (mainMs <= 0L || subMs <= 0L) return null
    return TimerConfig(
      mainMs = mainMs,
      subMs = subMs,
      phase = prefs.getLong("phase", 0L),
      subEnabled = prefs.getBoolean("subEnabled", true),
      volume = prefs.getFloat("volume", 0.8f).coerceIn(0f, 1f),
      notificationsEnabled = prefs.getBoolean("notificationsEnabled", true),
      focusModeEnabled = prefs.getBoolean("focusModeEnabled", false),
      alarmModeEnabled = prefs.getBoolean("alarmModeEnabled", false),
      activeHoursEnabled = prefs.getBoolean("activeHoursEnabled", false),
      activeHoursStart = prefs.getInt("activeHoursStart", 480).coerceIn(0, 1_439),
      activeHoursEnd = prefs.getInt("activeHoursEnd", 1_320).coerceIn(0, 1_439),
      activeHoursDays = prefs.getInt("activeHoursDays", 0x7f).and(0x7f).let { if (it == 0) 0x7f else it },
      alarmDurationSeconds = prefs.getInt("alarmDurationSeconds", 60).coerceIn(5, 3_600),
      timerV2Program = prefs.getString("timerV2Program", null),
      timerV2Anchor = prefs.getLong("timerV2Anchor", 0L),
    )
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
  }

  fun beginSession(context: Context): String {
    val generation = java.util.UUID.randomUUID().toString()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(SESSION_GENERATION, generation)
      .commit()
    return generation
  }

  fun ensureSessionGeneration(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs.getString(SESSION_GENERATION, null) ?: beginSession(context)
  }

  fun setRinging(context: Context, ringing: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(RINGING, ringing)
      .commit()
  }

  fun isRinging(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(RINGING, false)

  fun setAlarmVisible(context: Context, visible: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(ALARM_VISIBLE, visible)
      .commit()
  }

  fun isAlarmVisible(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ALARM_VISIBLE, false)

  fun setNext(context: Context, at: Long, type: TimerEventType, logicalId: String, generation: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putLong(NEXT_AT, at)
      .putString(NEXT_TYPE, type.value)
      .putString(NEXT_LOGICAL_ID, logicalId)
      .putString(SESSION_GENERATION, generation)
      .commit()
  }

  fun clearNext(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(NEXT_AT)
      .remove(NEXT_TYPE)
      .remove(NEXT_LOGICAL_ID)
      .commit()
  }

  fun matchesNext(context: Context, at: Long, type: TimerEventType, logicalId: String, generation: String): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs.getLong(NEXT_AT, -1L) == at &&
      prefs.getString(NEXT_TYPE, null) == type.value &&
      prefs.getString(NEXT_LOGICAL_ID, null) == logicalId &&
      prefs.getString(SESSION_GENERATION, null) == generation
  }

  fun nextLogicalId(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(NEXT_LOGICAL_ID, null)
  fun nextAt(context: Context): Long = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(NEXT_AT, 0L)
  fun sessionGeneration(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SESSION_GENERATION, null)

  fun getControlState(context: Context, now: Long = System.currentTimeMillis()): TimerControlState {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    var mutedUntil = prefs.getLong(MUTED_UNTIL, 0L)
    if (mutedUntil in 1..now) {
      prefs.edit().remove(MUTED_UNTIL).commit()
      mutedUntil = 0L
    }
    return TimerControlState(
      alarmOnceArmed = prefs.getBoolean(ALARM_ONCE, false),
      mutedUntil = mutedUntil,
      mutedIterationsRemaining = if (prefs.getString(MUTED_ITERATION_END_ID, null) != null) 1 else prefs.getInt(MUTED_ITERATIONS, 0).coerceAtLeast(0),
      mutedIterationEndId = prefs.getString(MUTED_ITERATION_END_ID, null),
      mutedIterationEndAt = prefs.getLong(MUTED_ITERATION_END_AT, 0L),
    )
  }

  fun toggleAlarmOnce(context: Context): TimerControlState {
    val current = getControlState(context)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(ALARM_ONCE, !current.alarmOnceArmed)
      .commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun consumeAlarmOnce(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(ALARM_ONCE, false)) return false
    prefs.edit().putBoolean(ALARM_ONCE, false).commit()
    TimerControlRegistry.notify(getControlState(context))
    return true
  }

  fun muteForIterations(context: Context, count: Int): TimerControlState {
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(MUTED_UNTIL)
    val config = load(context)
    val v2End = config?.timerV2Program?.let { TimerV2Timeline.iterationEnd(it, config.timerV2Anchor, System.currentTimeMillis(), count) }
    if (v2End != null) {
      editor.remove(MUTED_ITERATIONS)
        .putString(MUTED_ITERATION_END_ID, v2End.logicalId)
        .putLong(MUTED_ITERATION_END_AT, v2End.at)
    } else {
      editor.remove(MUTED_ITERATION_END_ID).remove(MUTED_ITERATION_END_AT)
        .putInt(MUTED_ITERATIONS, count.coerceIn(1, 99))
    }
    editor.commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun muteForMinutes(context: Context, minutes: Int): TimerControlState {
    val until = System.currentTimeMillis() + minutes.coerceIn(1, 1_440) * 60_000L
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putLong(MUTED_UNTIL, until)
      .remove(MUTED_ITERATIONS)
      .remove(MUTED_ITERATION_END_ID)
      .remove(MUTED_ITERATION_END_AT)
      .commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun clearMute(context: Context): TimerControlState {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(MUTED_UNTIL)
      .remove(MUTED_ITERATIONS)
      .remove(MUTED_ITERATION_END_ID)
      .remove(MUTED_ITERATION_END_AT)
      .commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun restoreControls(
    context: Context,
    alarmOnceArmed: Boolean,
    mutedUntil: Long,
    mutedIterationEndId: String?,
    mutedIterationEndAt: Long,
  ): TimerControlState {
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(ALARM_ONCE, alarmOnceArmed)
      .remove(MUTED_ITERATIONS)
      .remove(MUTED_UNTIL)
      .remove(MUTED_ITERATION_END_ID)
      .remove(MUTED_ITERATION_END_AT)
    if (mutedUntil > System.currentTimeMillis()) editor.putLong(MUTED_UNTIL, mutedUntil)
    if (!mutedIterationEndId.isNullOrBlank() && mutedIterationEndAt > 0L) {
      editor.putString(MUTED_ITERATION_END_ID, mutedIterationEndId)
        .putLong(MUTED_ITERATION_END_AT, mutedIterationEndAt)
    }
    editor.commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun consumeMuteForEvent(context: Context, type: TimerEventType, now: Long, logicalId: String? = null): Boolean {
    val state = getControlState(context, now)
    if (type == TimerEventType.V2) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val endId = prefs.getString(MUTED_ITERATION_END_ID, null)
      val endAt = prefs.getLong(MUTED_ITERATION_END_AT, 0L)
      if (state.mutedUntil > now) return true
      if (endId != null) {
        if (logicalId == endId || now > endAt) {
          prefs.edit().remove(MUTED_ITERATION_END_ID).remove(MUTED_ITERATION_END_AT).commit()
          TimerControlRegistry.notify(getControlState(context, now))
          return false
        }
        return true
      }
      return false
    }
    val muted = state.mutedUntil > now || state.mutedIterationsRemaining > 0
    if (type == TimerEventType.MAIN && state.mutedIterationsRemaining > 0) {
      val remaining = state.mutedIterationsRemaining - 1
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putInt(MUTED_ITERATIONS, remaining)
        .commit()
      TimerControlRegistry.notify(getControlState(context, now))
    }
    return muted
  }
}
