package expo.modules.chandastimerservice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

internal object TimerAudioFocus {
  private val choices = setOf("default", "mix", "duck", "pause")
  private val cues = mutableMapOf<Any, () -> Unit>()
  private var releaseCueFocus: (() -> Unit)? = null
  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("chandas-audio-focus", Context.MODE_PRIVATE)

  fun get(context: Context): String = prefs(context).getString("mode", null)?.takeIf(choices::contains) ?: "default"

  fun set(context: Context, mode: String): Boolean {
    if (mode !in choices) return false
    prefs(context).edit().putString("mode", mode).apply()
    return true
  }

  @Synchronized
  fun holdForCue(context: Context, attributes: AudioAttributes, player: Any, stop: () -> Unit): Boolean {
    if (get(context) in setOf("default", "mix") || TimerRuns.contexts(context).any(TimerStateStore::isRinging)) return true
    if (releaseCueFocus == null) {
      releaseCueFocus = acquire(context, attributes, alarm = false) { change ->
        if (change < 0) stopFocusedCues()
      } ?: return false
    }
    cues[player] = stop
    return true
  }

  @Synchronized
  fun releaseCue(player: Any) {
    if (cues.remove(player) != null && cues.isEmpty()) {
      releaseCueFocus?.invoke()
      releaseCueFocus = null
    }
  }

  private fun stopFocusedCues() {
    val stops = synchronized(this) { cues.values.toList() }
    stops.forEach { it() }
  }

  /** Returns the release action, or null if Android denied the request. */
  fun acquire(context: Context, attributes: AudioAttributes, alarm: Boolean, onChange: (Int) -> Unit): (() -> Unit)? {
    val gain = when (get(context)) {
      "mix" -> return {}
      "duck" -> AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
      "pause" -> AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      else -> if (alarm) AudioManager.AUDIOFOCUS_GAIN_TRANSIENT else return {}
    }
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    var active = true
    val listener = AudioManager.OnAudioFocusChangeListener { if (active) onChange(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(gain)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(listener, Handler(Looper.getMainLooper()))
        .build()
      if (manager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return null
      return { active = false; manager.abandonAudioFocusRequest(request) }
    }
    @Suppress("DEPRECATION")
    if (manager.requestAudioFocus(listener, AudioManager.STREAM_ALARM, gain) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return null
    return {
      active = false
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(listener)
    }
  }
}
