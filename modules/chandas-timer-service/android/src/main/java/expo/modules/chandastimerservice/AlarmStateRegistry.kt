package expo.modules.chandastimerservice

object AlarmStateRegistry {
  private val listeners = NativeListenerRegistry<Boolean>()

  fun add(listener: (Boolean) -> Unit) = listeners.add(listener)
  fun remove(listener: (Boolean) -> Unit) = listeners.remove(listener)
  fun notify(ringing: Boolean) = listeners.notify(ringing)
}
