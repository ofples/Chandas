package expo.modules.chandastimerservice

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.PowerManager
import java.util.concurrent.atomic.AtomicBoolean

object TimerSoundPlayer {
  private val players = mutableSetOf<MediaPlayer>()

  fun play(
    context: Context,
    resId: Int,
    volume: Float,
    useAlarmUsage: Boolean,
    onFinished: () -> Unit,
  ) {
    if (volume <= 0f) {
      onFinished()
      return
    }

    val player = MediaPlayer()
    val released = AtomicBoolean(false)
    synchronized(players) { players.add(player) }

    fun release() {
      if (!released.compareAndSet(false, true)) return
      synchronized(players) { players.remove(player) }
      runCatching { player.release() }
      onFinished()
    }

    try {
      player.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(if (useAlarmUsage) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_NOTIFICATION_EVENT)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      player.setWakeMode(context.applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
      val afd = context.resources.openRawResourceFd(resId)
      player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      afd.close()
      val level = volume.coerceIn(0f, 1f)
      player.setVolume(level, level)
      player.setOnCompletionListener { release() }
      player.setOnErrorListener { _, _, _ ->
        release()
        true
      }
      player.setOnPreparedListener { it.start() }
      player.prepareAsync()
    } catch (_: Exception) {
      release()
    }
  }
}
