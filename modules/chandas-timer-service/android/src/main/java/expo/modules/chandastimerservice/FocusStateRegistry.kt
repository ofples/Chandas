package expo.modules.chandastimerservice

data class NativeFocusState(
  val policyAccess: Boolean,
  val automationEnabled: Boolean,
  val ruleExists: Boolean,
  val ruleEnabled: Boolean,
  val actual: String,
  val reason: String,
  /** Raw facts let the OTA layer revise presentation without changing Android code. */
  val timerRunning: Boolean = false,
  val requestedActive: Boolean = false,
  val pausedByAndroid: Boolean = false,
  val ruleWasRemoved: Boolean = false,
  val withinActiveHours: Boolean = false,
)

object FocusStateRegistry {
  private val listeners = NativeListenerRegistry<NativeFocusState>()

  fun add(listener: (NativeFocusState) -> Unit) = listeners.add(listener)
  fun remove(listener: (NativeFocusState) -> Unit) = listeners.remove(listener)
  fun notify(state: NativeFocusState) = listeners.notify(state)
}
