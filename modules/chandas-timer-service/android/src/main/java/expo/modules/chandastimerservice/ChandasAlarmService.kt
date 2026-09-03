package expo.modules.chandastimerservice

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class ChandasAlarmService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.chandastimerservice.action.START_ALARM"
    const val ACTION_STOP = "expo.modules.chandastimerservice.action.STOP_ALARM"
    const val ACTION_UPDATE_VOLUME = "expo.modules.chandastimerservice.action.UPDATE_ALARM_VOLUME"
    const val EXTRA_VOLUME = "volume"
    const val EXTRA_CUE_VOLUME = "cueVolume"
    const val EXTRA_SOUND_ID = "soundId"
    const val EXTRA_DURATION_SECONDS = "durationSeconds"
    @Volatile private var live = false

    /** Repairs a ringing alarm after process recreation without restarting a live player. */
    fun ensureRunning(context: Context, config: TimerConfig) {
      if (live || !TimerStateStore.isRinging(context)) return
      val sound = config.timerV2Program?.let(TimerV2Timeline::mainCueSound) ?: "temple-gong"
      val cue = config.timerV2Program?.let(TimerV2Timeline::mainCueVolume) ?: 1f
      ContextCompat.startForegroundService(context, Intent(context, ChandasAlarmService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_SOUND_ID, sound)
        putExtra(EXTRA_CUE_VOLUME, cue)
      })
    }
  }

  private var player: MediaPlayer? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_GAIN -> runCatching { player?.start() }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> runCatching { player?.pause() }
      AudioManager.AUDIOFOCUS_LOSS -> silenceAndResume()
    }
  }
  private val handler = Handler(Looper.getMainLooper())
  private val autoSilence = Runnable { silenceAndResume() }
  private var stopHandled = false
  private var soundId = "temple-gong"
  private var cueVolume = 1f

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    live = true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> dismissAndResume()
      ACTION_UPDATE_VOLUME -> {
        val volume = intent.getFloatExtra(EXTRA_VOLUME, 0.8f).coerceIn(0f, 1f)
        cueVolume = intent.getFloatExtra(EXTRA_CUE_VOLUME, cueVolume).coerceIn(0f, 1f)
        val duration = intent.getIntExtra(EXTRA_DURATION_SECONDS, 60).coerceIn(5, 3_600)
        if (player == null && TimerStateStore.isRinging(this)) {
          startRinging()
        } else {
          val effective = (volume * cueVolume).coerceIn(0f, 1f)
          player?.setVolume(effective, effective)
          scheduleAutoSilence(duration)
        }
      }
      ACTION_START -> {
        soundId = intent.getStringExtra(EXTRA_SOUND_ID) ?: "temple-gong"
        cueVolume = intent.getFloatExtra(EXTRA_CUE_VOLUME, 1f).coerceIn(0f, 1f)
        startRinging()
      }
      else -> stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun startRinging() {
    val config = TimerStateStore.load(this) ?: run {
      stopSelf()
      return
    }
    stopHandled = false
    TimerNotifications.ensureChannels(this)
    promoteForeground(buildNotification())
    TimerStateStore.setRinging(this, true)
    TimerStateStore.setAlarmVisible(this, true)
    AlarmStateRegistry.notify(true)
    scheduleAutoSilence(config.alarmDurationSeconds)

    try {
      val alarmAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      if (!requestAudioFocus(alarmAttributes)) {
        silenceAndResume()
        return
      }
      player?.release()
      player = MediaPlayer().apply {
        setAudioAttributes(alarmAttributes)
        setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
        runCatching { TimerSoundPlayer.setDataSource(this@ChandasAlarmService, this, soundId) }
          .getOrElse { TimerSoundPlayer.setDataSource(this@ChandasAlarmService, this, "builtin:${R.raw.alarm}") }
        isLooping = true
        val volume = (config.volume * cueVolume).coerceIn(0f, 1f)
        setVolume(volume, volume)
        setOnPreparedListener { it.start() }
        setOnErrorListener { _, _, _ ->
          if (soundId.contains("://")) {
            player?.release()
            player = null
            abandonAudioFocus()
            soundId = "builtin:${R.raw.alarm}"
            startRinging()
          } else {
            silenceAndResume()
          }
          true
        }
        prepareAsync()
      }
    } catch (_: Exception) {
      silenceAndResume()
    }
  }

  private fun dismissAndResume() {
    finishAlarm(keepOverlay = false)
  }

  private fun scheduleAutoSilence(durationSeconds: Int) {
    handler.removeCallbacks(autoSilence)
    handler.postDelayed(autoSilence, durationSeconds.coerceIn(5, 3_600) * 1_000L)
  }

  private fun silenceAndResume() {
    finishAlarm(keepOverlay = true)
  }

  private fun finishAlarm(keepOverlay: Boolean) {
    if (stopHandled) {
      if (!keepOverlay) {
        TimerStateStore.setAlarmVisible(this, false)
        AlarmStateRegistry.notify(false)
      }
      return
    }
    stopHandled = true
    handler.removeCallbacks(autoSilence)
    player?.release()
    player = null
    abandonAudioFocus()
    TimerStateStore.setRinging(this, false)
    if (!keepOverlay) {
      TimerStateStore.setAlarmVisible(this, false)
      AlarmStateRegistry.notify(false)
    }
    TimerNotifications.cancelAlarm(this)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    TimerStateStore.load(this)?.let { TimerNotifications.postRunning(this, it) }
    stopSelf()
  }

  private fun buildNotification(): Notification {
    val launchIntent = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent())
      .apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(AlarmWindowHelper.EXTRA_ALARM_RINGING, true)
      }
    val fullScreenIntent = PendingIntent.getActivity(
      this,
      8301,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val stopIntent = Intent(this, ChandasAlarmService::class.java).setAction(ACTION_STOP)
    val stopPendingIntent = PendingIntent.getService(
      this,
      8302,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = NotificationCompat.Builder(this, TimerNotifications.ALARM_CHANNEL)
      .setContentTitle("Chandas - Time's up")
      .setContentText("Alarm is ringing")
      .setSmallIcon(TimerNotifications.smallIcon(this))
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setContentIntent(fullScreenIntent)
      .addAction(0, "Stop alarm", stopPendingIntent)

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val canUseFullScreen = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
      manager.canUseFullScreenIntent()
    if (canUseFullScreen) builder.setFullScreenIntent(fullScreenIntent, true)
    return builder.build()
  }

  private fun promoteForeground(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceCompat.startForeground(
        this,
        TimerNotifications.ALARM_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(TimerNotifications.ALARM_ID, notification)
    }
  }

  private fun requestAudioFocus(attributes: AudioAttributes): Boolean {
    val manager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(audioFocusListener)
        .build()
      manager.requestAudioFocus(audioFocusRequest!!)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(
        audioFocusListener,
        AudioManager.STREAM_ALARM,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
      )
    }
    return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  private fun abandonAudioFocus() {
    val manager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(audioFocusListener)
    }
  }

  override fun onDestroy() {
    live = false
    handler.removeCallbacks(autoSilence)
    player?.release()
    player = null
    abandonAudioFocus()
    if (!stopHandled && TimerStateStore.isRinging(this)) {
      TimerStateStore.setRinging(this, false)
      TimerStateStore.setAlarmVisible(this, false)
      AlarmStateRegistry.notify(false)
      TimerNotifications.cancelAlarm(this)
    }
    super.onDestroy()
  }
}
