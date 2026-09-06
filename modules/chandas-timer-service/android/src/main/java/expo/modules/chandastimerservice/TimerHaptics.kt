package expo.modules.chandastimerservice

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Owns foreground previews, exact cue accents, and repeat-until-dismissed alarm haptics. */
object TimerHaptics {
  fun cue(context: Context, settings: TimerHapticsConfig, primary: Boolean) {
    if (!settings.enabled) return
    vibrate(context, if (primary) settings.main else settings.subBell, repeat = false, alarmUsage = false)
  }

  fun startAlarm(context: Context, settings: TimerHapticsConfig) {
    stop(context)
    if (!settings.enabled) return
    vibrate(context, settings.alarm, repeat = true, alarmUsage = true)
  }

  fun preview(context: Context, profile: HapticProfileConfig): Boolean =
    vibrate(context, profile, repeat = false, alarmUsage = false)

  fun stop(context: Context) {
    vibrator(context)?.let { runCatching { it.cancel() } }
  }

  private fun vibrate(context: Context, profile: HapticProfileConfig, repeat: Boolean, alarmUsage: Boolean): Boolean {
    val vibrator = vibrator(context) ?: return false
    if (!vibrator.hasVibrator()) return false
    val timings = timings(profile.pattern, repeat)
    val amplitudes = amplitudes(profile.pattern, profile.strength, repeat)
    val repeatIndex = if (repeat) 0 else -1
    return runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val effect = if (vibrator.hasAmplitudeControl()) {
          VibrationEffect.createWaveform(timings, amplitudes, repeatIndex)
        } else {
          VibrationEffect.createWaveform(timings, repeatIndex)
        }
        val attributes = AudioAttributes.Builder()
          .setUsage(if (alarmUsage) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_NOTIFICATION_EVENT)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        vibrator.vibrate(effect, attributes)
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(timings, repeatIndex)
      }
      true
    }.getOrDefault(false)
  }

  private fun vibrator(context: Context): Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    context.getSystemService(VibratorManager::class.java)?.defaultVibrator
  } else {
    @Suppress("DEPRECATION")
    context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
  }

  /** Waveforms begin with an explicit zero-duration OFF phase as required by Android. */
  private fun timings(pattern: String, repeating: Boolean): LongArray {
    val group = when (pattern) {
      "double" -> longArrayOf(0L, 70L, 100L, 70L)
      "triple" -> longArrayOf(0L, 60L, 85L, 60L, 85L, 60L)
      else -> longArrayOf(0L, 75L)
    }
    return if (repeating) group + 650L else group
  }

  private fun amplitudes(pattern: String, strength: String, repeating: Boolean): IntArray {
    val amplitude = when (strength) {
      "gentle" -> 90
      "balanced" -> 170
      else -> 255
    }
    val group = when (pattern) {
      "double" -> intArrayOf(0, amplitude, 0, amplitude)
      "triple" -> intArrayOf(0, amplitude, 0, amplitude, 0, amplitude)
      else -> intArrayOf(0, amplitude)
    }
    return if (repeating) group + 0 else group
  }
}
