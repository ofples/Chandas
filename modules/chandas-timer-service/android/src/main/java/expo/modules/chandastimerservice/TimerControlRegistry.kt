package expo.modules.chandastimerservice

data class TimerControlState(
  val alarmOnceArmed: Boolean,
  val mutedUntil: Long,
  val mutedIterationsRemaining: Int,
  val mutedIterationEndId: String?,
  val mutedIterationEndAt: Long,
)

object TimerControlRegistry {
  private val listeners = mutableSetOf<(TimerControlState) -> Unit>()

  @Synchronized
  fun add(listener: (TimerControlState) -> Unit) {
    listeners.add(listener)
  }

  @Synchronized
  fun remove(listener: (TimerControlState) -> Unit) {
    listeners.remove(listener)
  }

  @Synchronized
  fun notify(state: TimerControlState) {
    listeners.toList().forEach { it(state) }
  }
}
