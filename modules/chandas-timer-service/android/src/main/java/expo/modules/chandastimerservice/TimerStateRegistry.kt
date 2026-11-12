package expo.modules.chandastimerservice

import android.content.Context

data class TimerScheduleState(
  val active: Boolean,
  val timerV2Anchor: Long,
  val nextEventAt: Long,
  val nextLogicalId: String?,
  val exactTimingAvailable: Boolean,
  val runId: String? = null,
)

object TimerStateRegistry {
  private val listeners = NativeListenerRegistry<TimerScheduleState>()

  fun add(listener: (TimerScheduleState) -> Unit) = listeners.add(listener)
  fun remove(listener: (TimerScheduleState) -> Unit) = listeners.remove(listener)
  fun notify(context: Context, state: TimerScheduleState) = listeners.notify(state.copy(runId = TimerRuns.id(context)))
}
