package expo.modules.slottimerservice

import android.content.Context

object TimerStateStore {
  private const val PREFS = "slottimer-native-state"
  private const val ACTIVE = "active"
  private const val RINGING = "ringing"
  private const val ALARM_VISIBLE = "alarmVisible"
  private const val NEXT_AT = "nextAt"
  private const val NEXT_TYPE = "nextType"
  private const val ALARM_ONCE = "alarmOnce"
  private const val MUTED_UNTIL = "mutedUntil"
  private const val MUTED_ITERATIONS = "mutedIterations"

  fun save(context: Context, config: TimerConfig) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(ACTIVE, true)
      .putLong("mainMs", config.mainMs)
      .putLong("subMs", config.subMs)
      .putLong("phase", config.phase)
      .putBoolean("subEnabled", config.subEnabled)
      .putFloat("volume", config.volume)
      .putBoolean("notificationsEnabled", config.notificationsEnabled)
      .putBoolean("alarmModeEnabled", config.alarmModeEnabled)
      .putBoolean("activeHoursEnabled", config.activeHoursEnabled)
      .putInt("activeHoursStart", config.activeHoursStart)
      .putInt("activeHoursEnd", config.activeHoursEnd)
      .putInt("activeHoursDays", config.activeHoursDays)
      .putInt("alarmDurationSeconds", config.alarmDurationSeconds)
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
      alarmModeEnabled = prefs.getBoolean("alarmModeEnabled", false),
      activeHoursEnabled = prefs.getBoolean("activeHoursEnabled", false),
      activeHoursStart = prefs.getInt("activeHoursStart", 480).coerceIn(0, 1_439),
      activeHoursEnd = prefs.getInt("activeHoursEnd", 1_320).coerceIn(0, 1_439),
      activeHoursDays = prefs.getInt("activeHoursDays", 0x7f).and(0x7f).let { if (it == 0) 0x7f else it },
      alarmDurationSeconds = prefs.getInt("alarmDurationSeconds", 60).coerceIn(5, 3_600),
    )
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
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

  fun setNext(context: Context, at: Long, type: TimerEventType) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putLong(NEXT_AT, at)
      .putString(NEXT_TYPE, type.value)
      .commit()
  }

  fun clearNext(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(NEXT_AT)
      .remove(NEXT_TYPE)
      .commit()
  }

  fun matchesNext(context: Context, at: Long, type: TimerEventType): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs.getLong(NEXT_AT, -1L) == at && prefs.getString(NEXT_TYPE, null) == type.value
  }

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
      mutedIterationsRemaining = prefs.getInt(MUTED_ITERATIONS, 0).coerceAtLeast(0),
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
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(MUTED_UNTIL)
      .putInt(MUTED_ITERATIONS, count.coerceIn(1, 99))
      .commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun muteForMinutes(context: Context, minutes: Int): TimerControlState {
    val until = System.currentTimeMillis() + minutes.coerceIn(1, 1_440) * 60_000L
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putLong(MUTED_UNTIL, until)
      .remove(MUTED_ITERATIONS)
      .commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun clearMute(context: Context): TimerControlState {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(MUTED_UNTIL)
      .remove(MUTED_ITERATIONS)
      .commit()
    return getControlState(context).also(TimerControlRegistry::notify)
  }

  fun consumeMuteForEvent(context: Context, type: TimerEventType, now: Long): Boolean {
    val state = getControlState(context, now)
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
