package expo.modules.chandastimerservice

/** Pure allow-list for sound references that may cross the JS/native boundary. */
internal object TimerSoundSource {
  fun isPersistentUri(kind: String, uri: String): Boolean = when (kind) {
    "android" -> uri.startsWith("content://", ignoreCase = true) ||
      uri.startsWith("android.resource://", ignoreCase = true)
    "document" -> uri.startsWith("content://", ignoreCase = true)
    else -> false
  }

  fun isRuntimeSoundId(soundId: String): Boolean =
    if (soundId.contains("://")) isPersistentUri("android", soundId)
    else TimerSoundIds.isValid(soundId)
}
