package expo.modules.chandastimerservice

data class TimerConfig(
  val mainMs: Long,
  val subMs: Long,
  val phase: Long,
  val subEnabled: Boolean,
  val volume: Float,
  val notificationsEnabled: Boolean,
  val focusModeEnabled: Boolean,
  val alarmModeEnabled: Boolean,
  val activeHoursEnabled: Boolean,
  val activeHoursStart: Int,
  val activeHoursEnd: Int,
  val activeHoursDays: Int,
  val alarmDurationSeconds: Int,
  /** Serialized V2 Pattern/Sequence program. Null keeps the legacy scheduler path. */
  val timerV2Program: String? = null,
  val timerV2Anchor: Long = 0L,
)

enum class TimerEventType(val value: String) {
  MAIN("main"),
  SUB("sub"),
  V2("v2"),
  ACTIVE_START("activeStart");

  companion object {
    fun fromValue(value: String?): TimerEventType? = entries.firstOrNull { it.value == value }
  }
}
