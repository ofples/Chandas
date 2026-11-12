package expo.modules.chandastimerservice

import android.content.Context

data class TimerControlState(
  val alarmOnceArmed: Boolean,
  val mutedUntil: Long,
  val mutedIterationsRemaining: Int,
  val mutedIterationEndId: String?,
  val mutedIterationEndAt: Long,
  val runId: String? = null,
)

object TimerControlRegistry {
  private val listeners = NativeListenerRegistry<TimerControlState>()

  fun add(listener: (TimerControlState) -> Unit) = listeners.add(listener)
  fun remove(listener: (TimerControlState) -> Unit) = listeners.remove(listener)
  fun notify(context: Context, state: TimerControlState) = listeners.notify(state.copy(runId = TimerRuns.id(context)))
}
