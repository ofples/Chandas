package expo.modules.slottimerservice

import android.content.Context

object TimerStateStore {
  private const val PREFS = "slottimer-native-state"
  private const val ACTIVE = "active"
  private const val RINGING = "ringing"
  private const val NEXT_AT = "nextAt"
  private const val NEXT_TYPE = "nextType"

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
}
