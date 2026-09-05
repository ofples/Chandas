package expo.modules.chandastimerservice

/**
 * Stable bridge contract exposed to the OTA layer.
 *
 * Product limits belong in JavaScript. These deliberately generous ceilings
 * are only native safety bounds, so ordinary product-limit changes do not need
 * a replacement binary.
 */
object NativeTimerContract {
  const val CONTRACT_VERSION = 5
  const val PROGRAM_SCHEMA_MIN = 2
  const val PROGRAM_SCHEMA_MAX = 2
  const val MAX_PATTERN_TRACKS = 32
  const val MAX_SEQUENCE_STEPS = 64
  const val MAX_CUE_DURATION_MINUTES = 10_080 // Seven days.
  const val MAX_PROGRAM_CYCLE_MS = 38_707_200_000L // 64 seven-day steps.
  const val MAX_RUN_CYCLES = 100_000
  const val MAX_RUN_DURATION_SECONDS = 31_536_000L // One year.
  const val MAX_PROGRAM_CHARACTERS = 1_048_576
  const val MAX_SOUND_ID_CHARACTERS = 8_192
  const val MAX_MUTE_ITERATIONS = 9_999
  const val MAX_MUTE_MINUTES = 10_080
}
