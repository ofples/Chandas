package expo.modules.chandastimerservice

object AlarmStateRegistry {
  private val listeners = mutableSetOf<(Boolean) -> Unit>()

  @Synchronized
  fun add(listener: (Boolean) -> Unit) {
    listeners.add(listener)
  }

  @Synchronized
  fun remove(listener: (Boolean) -> Unit) {
    listeners.remove(listener)
  }

  @Synchronized
  fun notify(ringing: Boolean) {
    listeners.toList().forEach { it(ringing) }
  }
}
