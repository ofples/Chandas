package expo.modules.chandastimerservice

data class TimerScheduleState(
  val active: Boolean,
  val timerV2Anchor: Long,
  val nextEventAt: Long,
  val nextLogicalId: String?,
  val exactTimingAvailable: Boolean,
)

object TimerStateRegistry {
  private val listeners = mutableSetOf<(TimerScheduleState) -> Unit>()

  @Synchronized fun add(listener: (TimerScheduleState) -> Unit) { listeners.add(listener) }
  @Synchronized fun remove(listener: (TimerScheduleState) -> Unit) { listeners.remove(listener) }
  @Synchronized fun notify(state: TimerScheduleState) { listeners.toList().forEach { it(state) } }
}
