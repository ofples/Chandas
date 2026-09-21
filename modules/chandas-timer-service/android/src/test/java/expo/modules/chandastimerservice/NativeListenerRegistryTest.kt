package expo.modules.chandastimerservice

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeListenerRegistryTest {
  @Test fun oneBrokenListenerCannotBlockTheOthers() {
    val registry = NativeListenerRegistry<Int>()
    val received = mutableListOf<Int>()
    registry.add { error("stale bridge") }
    registry.add { received.add(it) }

    registry.notify(7)

    assertEquals(listOf(7), received)
  }

  @Test fun listenersCanRemoveThemselvesDuringNotification() {
    val registry = NativeListenerRegistry<Int>()
    val received = mutableListOf<Int>()
    lateinit var selfRemoving: (Int) -> Unit
    selfRemoving = { value ->
      received.add(value)
      registry.remove(selfRemoving)
    }
    registry.add(selfRemoving)

    registry.notify(1)
    registry.notify(2)

    assertEquals(listOf(1), received)
  }
}
