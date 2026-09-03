package expo.modules.chandastimerservice

data class NativeFocusState(
  val policyAccess: Boolean,
  val automationEnabled: Boolean,
  val ruleExists: Boolean,
  val ruleEnabled: Boolean,
  val actual: String,
  val reason: String,
)

object FocusStateRegistry {
  private val listeners = mutableSetOf<(NativeFocusState) -> Unit>()

  @Synchronized fun add(listener: (NativeFocusState) -> Unit) { listeners.add(listener) }
  @Synchronized fun remove(listener: (NativeFocusState) -> Unit) { listeners.remove(listener) }
  @Synchronized fun notify(state: NativeFocusState) { listeners.toList().forEach { it(state) } }
}
