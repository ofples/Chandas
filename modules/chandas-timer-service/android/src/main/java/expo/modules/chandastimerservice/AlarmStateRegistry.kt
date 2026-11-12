package expo.modules.chandastimerservice

import android.content.Context

data class AlarmStateSignal(val ringing: Boolean, val runId: String?)

object AlarmStateRegistry {
  private val listeners = NativeListenerRegistry<AlarmStateSignal>()

  fun add(listener: (AlarmStateSignal) -> Unit) = listeners.add(listener)
  fun remove(listener: (AlarmStateSignal) -> Unit) = listeners.remove(listener)
  fun notify(context: Context, ringing: Boolean) = listeners.notify(AlarmStateSignal(ringing, TimerRuns.id(context)))
}
