package expo.modules.chandastimerservice

data class TimerEventSignal(
  val at: Long,
  /** Wall-clock time at which native actually handled and emitted the event. */
  val firedAt: Long,
  val logicalId: String,
  val boundary: String,
  val winnerCueId: String,
  val collision: Boolean,
  val suppressed: Boolean,
  val suppressionReason: String,
  val completesRun: Boolean,
)

object TimerEventRegistry {
  private val listeners = NativeListenerRegistry<TimerEventSignal>()

  fun add(listener: (TimerEventSignal) -> Unit) = listeners.add(listener)
  fun remove(listener: (TimerEventSignal) -> Unit) = listeners.remove(listener)
  fun notify(event: TimerEventSignal) = listeners.notify(event)
}
