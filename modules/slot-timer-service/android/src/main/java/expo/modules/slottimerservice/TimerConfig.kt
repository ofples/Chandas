package expo.modules.slottimerservice

data class TimerConfig(
  val mainMs: Long,
  val subMs: Long,
  val phase: Long,
  val subEnabled: Boolean,
  val volume: Float,
  val bgTrack: Int,
  val bgVolume: Float,
  val notificationsEnabled: Boolean,
)
