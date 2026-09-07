package expo.modules.chandastimerservice

data class TimerScheduleState(
  val active: Boolean,
  val timerV2Anchor: Long,
  val nextEventAt: Long,
  val nextLogicalId: String?,
  val exactTimingAvailable: Boolean,
)

object TimerStateRegistry {
  private val listeners = NativeListenerRegistry<TimerScheduleState>()

  fun add(listener: (TimerScheduleState) -> Unit) = listeners.add(listener)
  fun remove(listener: (TimerScheduleState) -> Unit) = listeners.remove(listener)
  fun notify(state: TimerScheduleState) = listeners.notify(state)
}
