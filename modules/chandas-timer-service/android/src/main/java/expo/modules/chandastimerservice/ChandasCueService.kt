package expo.modules.chandastimerservice

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/** Keeps one-shot cue playback alive after the exact-alarm receiver returns. */
class ChandasCueService : Service() {
  companion object {
    private const val ACTION_PLAY = "expo.modules.chandastimerservice.action.PLAY_CUE"
    private const val EXTRA_SOUND_ID = "soundId"
    private const val EXTRA_FALLBACK_RES_ID = "fallbackResId"
    private const val EXTRA_VOLUME = "volume"
    private const val EXTRA_EVENT_TYPE = "eventType"
    private const val EXTRA_PRESENTATION = "notificationPresentation"

    fun play(
      context: Context,
      soundId: String,
      fallbackResId: Int,
      volume: Float,
      type: TimerEventType,
      notificationPresentation: String?,
    ): Boolean = runCatching {
      ContextCompat.startForegroundService(
        context,
        Intent(context, ChandasCueService::class.java).apply {
          action = ACTION_PLAY
          putExtra(EXTRA_SOUND_ID, soundId)
          putExtra(EXTRA_FALLBACK_RES_ID, fallbackResId)
          putExtra(EXTRA_VOLUME, volume)
          putExtra(EXTRA_EVENT_TYPE, type.value)
          putExtra(EXTRA_PRESENTATION, notificationPresentation)
        },
      )
      true
    }.getOrDefault(false)

    fun stop(context: Context) {
      runCatching { context.stopService(Intent(context, ChandasCueService::class.java)) }
    }
  }

  private val players = linkedSetOf<MediaPlayer>()
  private var destroyed = false
  private var latestStartId = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    latestStartId = startId
    if (intent?.action != ACTION_PLAY) {
      finishService()
      return START_NOT_STICKY
    }
    val type = TimerEventType.fromValue(intent.getStringExtra(EXTRA_EVENT_TYPE)) ?: run {
      finishService()
      return START_NOT_STICKY
    }
    val soundId = intent.getStringExtra(EXTRA_SOUND_ID).orEmpty()
    val fallbackResId = intent.getIntExtra(EXTRA_FALLBACK_RES_ID, R.raw.bell)
    val volume = intent.getFloatExtra(EXTRA_VOLUME, 1f)
    if (soundId.isBlank() || !volume.isFinite() || volume <= 0f) {
      finishService()
      return START_NOT_STICKY
    }

    TimerNotifications.ensureChannels(this)
    val notification = TimerNotifications.buildEvent(
      this,
      intent.getStringExtra(EXTRA_PRESENTATION),
      type,
      playbackOngoing = true,
    )
    val promoted = runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceCompat.startForeground(
          this,
          TimerNotifications.EVENT_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
      } else {
        startForeground(TimerNotifications.EVENT_ID, notification)
      }
    }.isSuccess
    if (!promoted) {
      finishService()
      return START_NOT_STICKY
    }

    startPlayback(soundId, fallbackResId, volume.coerceIn(0f, 1f), mayFallback = true)
    return START_NOT_STICKY
  }

  private fun startPlayback(source: String, fallbackResId: Int, volume: Float, mayFallback: Boolean) {
    if (destroyed) return
    val player = MediaPlayer()
    players.add(player)

    fun fail() {
      release(player)
      if (!destroyed && mayFallback) {
        startPlayback("builtin:$fallbackResId", fallbackResId, volume, mayFallback = false)
      } else {
        finishIfIdle()
      }
    }

    try {
      player.setAudioAttributes(TimerSoundPlayer.alarmAttributes())
      player.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
      TimerSoundPlayer.setDataSource(this, player, source)
      player.setVolume(volume, volume)
      player.setOnPreparedListener { prepared ->
        if (destroyed) release(prepared) else prepared.start()
      }
      player.setOnCompletionListener { completed ->
        release(completed)
        finishIfIdle()
      }
      player.setOnErrorListener { _, _, _ -> fail(); true }
      player.prepareAsync()
    } catch (_: Exception) {
      fail()
    }
  }

  private fun release(player: MediaPlayer) {
    players.remove(player)
    runCatching { player.release() }
  }

  private fun finishIfIdle() {
    if (players.isEmpty()) finishService()
  }

  private fun finishService() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    if (latestStartId > 0) stopSelfResult(latestStartId) else stopSelf()
  }

  override fun onDestroy() {
    destroyed = true
    players.toList().forEach(::release)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
