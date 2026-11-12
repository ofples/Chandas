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
    @Volatile private var instance: ChandasCueService? = null
    private const val ACTION_PLAY = "expo.modules.chandastimerservice.action.PLAY_CUE"
    private const val EXTRA_SOUND_ID = "soundId"
    private const val EXTRA_FALLBACK_RES_ID = "fallbackResId"
    private const val EXTRA_VOLUME = "volume"
    private const val EXTRA_PRESENTATION = "notificationPresentation"
    private const val EXTRA_COMPLETION = "completion"

    fun play(
      context: Context,
      soundId: String,
      fallbackResId: Int,
      volume: Float,
      notificationPresentation: String?,
      completion: Boolean = false,
    ): Boolean = runCatching {
      ContextCompat.startForegroundService(
        context,
        TimerRuns.route(Intent(context, ChandasCueService::class.java), context).apply {
          action = ACTION_PLAY
          putExtra(EXTRA_SOUND_ID, soundId)
          putExtra(EXTRA_FALLBACK_RES_ID, fallbackResId)
          putExtra(EXTRA_VOLUME, volume)
          putExtra(EXTRA_PRESENTATION, notificationPresentation)
          putExtra(EXTRA_COMPLETION, completion)
        },
      )
      true
    }.getOrDefault(false)

    fun stop(context: Context) {
      instance?.cancel(TimerRuns.id(context))
    }
  }

  private val players = linkedMapOf<MediaPlayer, String?>()
  private val handler = android.os.Handler(android.os.Looper.getMainLooper())

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  private fun cancel(runId: String?) {
    handler.post {
      players.filterValues { it == runId }.keys.toList().forEach(::release)
      if (!destroyed) finishIfIdle()
    }
  }
  private var destroyed = false
  private var latestStartId = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    latestStartId = startId
    if (intent?.action != ACTION_PLAY) {
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
    val notification = TimerNotifications.buildCuePlayback(
      this,
      intent.getStringExtra(EXTRA_PRESENTATION),
      completion = intent.getBooleanExtra(EXTRA_COMPLETION, false),
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

    val run = TimerRuns.fromIntent(this, intent) ?: this
    startPlayback(run, soundId, fallbackResId, volume.coerceIn(0f, 1f), mayFallback = true)
    return START_NOT_STICKY
  }

  private fun startPlayback(run: Context, source: String, fallbackResId: Int, volume: Float, mayFallback: Boolean) {
    if (destroyed) return
    val player = MediaPlayer()
    players[player] = TimerRuns.id(run)

    fun fail() {
      if (player !in players) return
      release(player)
      if (!destroyed && mayFallback) {
        startPlayback(run, "builtin:$fallbackResId", fallbackResId, volume, mayFallback = false)
      } else {
        finishIfIdle()
      }
    }

    try {
      player.setAudioAttributes(TimerSoundPlayer.alarmAttributes())
      player.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
      val wasLooping = TimerSoundPlayer.setDataSource(run, player, source, oneShot = true)
      val output = TimerAudioOutput.Playback(this, player, volume)
      player.setOnPreparedListener { prepared ->
        if (!destroyed && prepared in players) runCatching {
          TimerSoundPlayer.startOneShot(run, prepared, output, source, "one-shot", wasLooping) {
            release(prepared)
            finishIfIdle()
          }
        }.onFailure { fail() }
      }
      player.setOnCompletionListener { completed ->
        TimerPlaybackTrace.record(run) { "stop one-shot reason=completed sound=${TimerPlaybackTrace.sound(source)}" }
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
    TimerSoundPlayer.releaseOneShot(player)
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
    instance = null
    players.keys.toList().forEach(::release)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
