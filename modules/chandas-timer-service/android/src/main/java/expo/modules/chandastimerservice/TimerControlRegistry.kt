package expo.modules.chandastimerservice

data class TimerControlState(
  val alarmOnceArmed: Boolean,
  val mutedUntil: Long,
  val mutedIterationsRemaining: Int,
  val mutedIterationEndId: String?,
  val mutedIterationEndAt: Long,
)

object TimerControlRegistry {
  private val listeners = NativeListenerRegistry<TimerControlState>()

  fun add(listener: (TimerControlState) -> Unit) = listeners.add(listener)
  fun remove(listener: (TimerControlState) -> Unit) = listeners.remove(listener)
  fun notify(state: TimerControlState) = listeners.notify(state)
}
