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
)

object TimerEventRegistry {
  private val listeners = mutableSetOf<(TimerEventSignal) -> Unit>()

  @Synchronized
  fun add(listener: (TimerEventSignal) -> Unit) {
    listeners.add(listener)
  }

  @Synchronized
  fun remove(listener: (TimerEventSignal) -> Unit) {
    listeners.remove(listener)
  }

  @Synchronized
  fun notify(event: TimerEventSignal) {
    listeners.toList().forEach { it(event) }
  }
}
