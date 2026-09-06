package expo.modules.chandastimerservice

data class HapticProfileConfig(
  val pattern: String,
  val strength: String,
) {
  companion object {
    fun normalized(pattern: String?, strength: String?, fallback: HapticProfileConfig): HapticProfileConfig =
      HapticProfileConfig(
        pattern = pattern?.takeIf { it == "single" || it == "double" || it == "triple" } ?: fallback.pattern,
        strength = strength?.takeIf { it == "gentle" || it == "balanced" || it == "strong" } ?: fallback.strength,
      )
  }
}

data class TimerHapticsConfig(
  val enabled: Boolean = true,
  val main: HapticProfileConfig = HapticProfileConfig("single", "strong"),
  val subBell: HapticProfileConfig = HapticProfileConfig("single", "gentle"),
  val alarm: HapticProfileConfig = HapticProfileConfig("double", "strong"),
)

data class TimerConfig(
  val mainMs: Long,
  val subMs: Long,
  val phase: Long,
  val subEnabled: Boolean,
  val volume: Float,
  /** Global repeat-until-dismissed alarm sound, independent of the main gong. */
  val alarmSoundId: String = "alarm-tone",
  /** Per-alarm level, multiplied by the master and Android Alarm volumes. */
  val alarmVolume: Float = 1f,
  val haptics: TimerHapticsConfig = TimerHapticsConfig(),
  val notificationsEnabled: Boolean,
  val liveCountdownEnabled: Boolean = false,
  /** OTA-owned notification wording; null uses native fallback copy. */
  val notificationPresentation: String? = null,
  val muteDuringCallsEnabled: Boolean = true,
  val focusModeEnabled: Boolean,
  val alarmModeEnabled: Boolean,
  val activeHoursEnabled: Boolean,
  val activeHoursStart: Int,
  val activeHoursEnd: Int,
  val activeHoursDays: Int,
  /** V2 availability policy JSON. Legacy active-hours fields remain as fallback. */
  val availabilityPolicy: String? = null,
  val alarmDurationSeconds: Int,
  /** Serialized V2 Pattern/Sequence program. Null keeps the legacy scheduler path. */
  val timerV2Program: String? = null,
  val timerV2Anchor: Long = 0L,
  val timerV2StartedAt: Long = 0L,
  /** Fixed terminal epoch. Zero means continuous. */
  val timerV2EndsAt: Long = 0L,
)

enum class TimerEventType(val value: String) {
  MAIN("main"),
  SUB("sub"),
  V2("v2"),
  ACTIVE_START("activeStart"),
  REALIGN("realign");

  companion object {
    fun fromValue(value: String?): TimerEventType? = entries.firstOrNull { it.value == value }
  }
}
