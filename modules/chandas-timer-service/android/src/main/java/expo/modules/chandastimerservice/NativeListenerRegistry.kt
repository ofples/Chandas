package expo.modules.chandastimerservice

/**
 * Thread-safe in-process listeners whose failures never escape into timer work.
 * Expo bridges can disappear while Android services and receivers keep running.
 */
internal class NativeListenerRegistry<T> {
  private val lock = Any()
  private val listeners = linkedSetOf<(T) -> Unit>()

  fun add(listener: (T) -> Unit) {
    synchronized(lock) { listeners.add(listener) }
  }

  fun remove(listener: (T) -> Unit) {
    synchronized(lock) { listeners.remove(listener) }
  }

  fun notify(value: T) {
    val snapshot = synchronized(lock) { listeners.toList() }
    snapshot.forEach { listener -> runCatching { listener(value) } }
  }
}
