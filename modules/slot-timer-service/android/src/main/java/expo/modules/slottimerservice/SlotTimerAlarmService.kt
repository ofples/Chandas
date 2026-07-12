package expo.modules.slottimerservice

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
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class SlotTimerAlarmService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.slottimerservice.action.START_ALARM"
    const val ACTION_STOP = "expo.modules.slottimerservice.action.STOP_ALARM"
    const val ACTION_UPDATE_VOLUME = "expo.modules.slottimerservice.action.UPDATE_ALARM_VOLUME"
    const val EXTRA_VOLUME = "volume"
  }

  private var player: MediaPlayer? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { }
  private var stopHandled = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> dismissAndResume()
      ACTION_UPDATE_VOLUME -> {
        val volume = intent.getFloatExtra(EXTRA_VOLUME, 0.8f).coerceIn(0f, 1f)
        if (player == null && TimerStateStore.isRinging(this)) {
          startRinging()
        } else {
          player?.setVolume(volume, volume)
        }
      }
      ACTION_START -> startRinging()
      else -> stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun startRinging() {
    val config = TimerStateStore.load(this) ?: run {
      stopSelf()
      return
    }
    TimerNotifications.ensureChannels(this)
    promoteForeground(buildNotification())
    TimerStateStore.setRinging(this, true)
    AlarmStateRegistry.notify(true)

    try {
      val alarmAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      requestAudioFocus(alarmAttributes)
      player?.release()
      player = MediaPlayer().apply {
        setAudioAttributes(alarmAttributes)
        setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
        val afd = resources.openRawResourceFd(R.raw.alarm)
        setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
        afd.close()
        isLooping = true
        val volume = config.volume.coerceIn(0f, 1f)
        setVolume(volume, volume)
        setOnPreparedListener { it.start() }
        setOnErrorListener { _, _, _ ->
          dismissAndResume()
          true
        }
        prepareAsync()
      }
    } catch (_: Exception) {
      dismissAndResume()
    }
  }

  private fun dismissAndResume() {
    if (stopHandled) return
    stopHandled = true
    player?.release()
    player = null
    abandonAudioFocus()
    TimerStateStore.setRinging(this, false)
    AlarmStateRegistry.notify(false)
    TimerNotifications.cancelAlarm(this)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    TimerScheduler.scheduleNext(this)
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
    val stopIntent = Intent(this, SlotTimerAlarmService::class.java).setAction(ACTION_STOP)
    val stopPendingIntent = PendingIntent.getService(
      this,
      8302,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = NotificationCompat.Builder(this, TimerNotifications.ALARM_CHANNEL)
      .setContentTitle("SlotTimer - Time's up")
      .setContentText("Alarm is ringing")
      .setSmallIcon(applicationInfo.icon)
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

  private fun requestAudioFocus(attributes: AudioAttributes) {
    val manager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(audioFocusListener)
        .build()
      manager.requestAudioFocus(audioFocusRequest!!)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(
        audioFocusListener,
        AudioManager.STREAM_ALARM,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE,
      )
    }
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
    player?.release()
    player = null
    abandonAudioFocus()
    if (!stopHandled && TimerStateStore.isRinging(this)) {
      TimerStateStore.setRinging(this, false)
      AlarmStateRegistry.notify(false)
      TimerScheduler.scheduleNext(this)
    }
    super.onDestroy()
  }
}
