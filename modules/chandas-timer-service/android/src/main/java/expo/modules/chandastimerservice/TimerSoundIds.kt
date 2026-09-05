package expo.modules.chandastimerservice

/**
 * Built-in sound identifiers are data owned by the JavaScript bundle, not a
 * native enum. Keeping this validator generic lets a compatible OTA add a new
 * sound without teaching the installed Android binary its name.
 */
object TimerSoundIds {
  private val validId = Regex("^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$")
  private val legacyAliases = mapOf(
    "soft-bowl" to "handpan",
    "wood-block" to "instamatic",
    "bright-chime" to "bloom",
  )

  fun isValid(id: String): Boolean = validId.matches(id)

  fun canonical(id: String): String = legacyAliases[id] ?: id
}
