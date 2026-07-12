package expo.modules.slottimerservice

data class TimerConfig(
  val mainMs: Long,
  val subMs: Long,
  val phase: Long,
  val subEnabled: Boolean,
  val volume: Float,
  val notificationsEnabled: Boolean,
  val alarmModeEnabled: Boolean,
)

enum class TimerEventType(val value: String) {
  MAIN("main"),
  SUB("sub");

  companion object {
    fun fromValue(value: String?): TimerEventType? = entries.firstOrNull { it.value == value }
  }
}
