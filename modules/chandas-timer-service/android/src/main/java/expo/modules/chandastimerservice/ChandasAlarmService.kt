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
    const val EXTRA_SOUND_ID = "soundId"
    private const val EXTRA_LEASE = "alarmLease"
    @Volatile private var instance: ChandasAlarmService? = null

    fun expireAtBoundary(context: Context, at: Long) {
      val expiresAt = TimerStateStore.alarmExpiresAt(context)
      if (expiresAt in 1..at) {
        val service = instance
        if (service?.owns(context) == true) service.finishAlarm(keepOverlay = false)
        else {
          TimerStateStore.setRinging(context, false)
          TimerStateStore.setAlarmVisible(context, false)
          AlarmStateRegistry.notify(context, false)
          advance(context)
        }
      }
    }

    private fun launch(context: Context, config: TimerConfig): Boolean = runCatching {
      ContextCompat.startForegroundService(context, TimerRuns.route(Intent(context, ChandasAlarmService::class.java), context).apply {
        action = ACTION_START
        putExtra(EXTRA_SOUND_ID, config.alarmSoundId)
        putExtra(EXTRA_LEASE, TimerStateStore.alarmLease(context))
      })
      true
    }.getOrDefault(false)

    private fun owner(context: Context): Context? = TimerRuns.contexts(context).firstOrNull(TimerStateStore::isRinging)

    @Synchronized
    fun start(context: Context, config: TimerConfig, expiresAt: Long = 0L): Boolean {
      if (alarmExpired(expiresAt)) return false
      if (owner(context) != null) {
        if (!TimerStateStore.isRinging(context) || alarmExpired(TimerStateStore.alarmExpiresAt(context))) {
          TimerStateStore.enqueueAlarm(context, expiresAt)
        }
        return true
      }
      TimerStateStore.setRinging(context, true, expiresAt)
      TimerStateStore.setAlarmVisible(context, true)
      if (!launch(context, config)) {
        TimerStateStore.setRinging(context, false)
        TimerStateStore.setAlarmVisible(context, false)
        return false
      }
      AlarmStateRegistry.notify(context, true)
      return true
    }

    @Synchronized
    private fun advance(context: Context): Boolean {
      if (owner(context) != null) return true
      val waiting = TimerRuns.contexts(context).filter { TimerStateStore.alarmQueuedAt(it) > 0L }
      for (run in waiting.sortedBy(TimerStateStore::alarmQueuedAt)) {
        val expiresAt = TimerStateStore.queuedAlarmExpiresAt(run)
        TimerStateStore.clearQueuedAlarm(run)
        val config = TimerStateStore.load(run) ?: continue
        if (start(run, config, expiresAt)) return true
      }
      return false
    }

    fun dismiss(context: Context): Boolean {
      val expected = TimerStateStore.alarmLease(context)
      if (Looper.myLooper() == Looper.getMainLooper()) {
        dismissIfCurrent(context, expected, clearQueue = true)
        return true
      }
      return Handler(Looper.getMainLooper()).post { dismissIfCurrent(context, expected, clearQueue = true) }
    }

    private fun dismissIfCurrent(context: Context, expected: String?, clearQueue: Boolean = false) {
      val service = instance
      if (service?.owns(context) == true && service.lease == expected) {
        if (clearQueue) TimerStateStore.clearQueuedAlarm(context)
        service.dismissAndResume()
        return
      }
      // A notification can be tapped before the player is prepared or while
      // Android is recreating the service. Clear the scoped claim even then.
      if (expected != TimerStateStore.alarmLease(context)) return
      if (clearQueue) TimerStateStore.clearQueuedAlarm(context)
      val claimed = TimerStateStore.isRinging(context)
      val visible = TimerStateStore.isAlarmVisible(context)
      if (!claimed && !visible) return
      TimerStateStore.setRinging(context, false)
      TimerStateStore.setAlarmVisible(context, false)
      TimerPlaybackTrace.record(context) { "dismiss stored alarm player=absent" }
      AlarmStateRegistry.notify(context, false)
      if (claimed) {
        TimerNotifications.cancelAlarm(context)
        advance(context)
      }
    }

    fun cancel(context: Context) = dismiss(context)

    fun updateVolume(context: Context) = send(context, ACTION_UPDATE_VOLUME)

    private fun send(context: Context, action: String): Boolean = runCatching {
      context.startService(TimerRuns.route(Intent(context, ChandasAlarmService::class.java), context)
        .setAction(action).putExtra(EXTRA_LEASE, TimerStateStore.alarmLease(context)))
      true
    }.getOrDefault(false)

    /** Repairs a ringing alarm after process recreation without restarting a live player. */
    fun ensureRunning(context: Context, config: TimerConfig) {
      if (instance == null && TimerStateStore.isRinging(context)) launch(context, config)
    }
  }

  private var run: Context = this
  private var latestStartId = 0
  private var lease: String? = null
  private fun owns(context: Context): Boolean = player != null && TimerRuns.id(run) == TimerRuns.id(context)
  private fun leaseIsCurrent(): Boolean = TimerStateStore.isRinging(run) && TimerStateStore.alarmLease(run) == lease
  private fun canPlay(): Boolean = leaseIsCurrent() && !alarmExpired(TimerStateStore.alarmExpiresAt(run))

  private var player: MediaPlayer? = null
  private var audioOutput: TimerAudioOutput.Playback? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_GAIN -> if (canPlay()) runCatching { audioOutput?.start() } else Unit
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> runCatching { player?.pause() }
      AudioManager.AUDIOFOCUS_LOSS -> silenceAndResume()
    }
  }
  private val handler = Handler(Looper.getMainLooper())
  private val autoSilence = Runnable { silenceAndResume() }
  private val expireStepAlarm = Runnable { finishAlarm(keepOverlay = false) }
  private var stopHandled = false
  private var soundId = "alarm-tone"

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    latestStartId = startId
    // START_STICKY restarts arrive without the original Intent. Persisted
    // ringing state is authoritative, so reconstruct the alarm instead of
    // silently ending a repeat-until-dismissed alarm after process reclaim.
    if (intent == null) {
      run = owner(this) ?: this
      val config = TimerStateStore.load(run)
      if (config != null && TimerStateStore.isRinging(run) && TimerStateStore.isAlarmVisible(run)) {
        lease = TimerStateStore.alarmLease(run)
        soundId = config.alarmSoundId
        startRinging()
        return if (TimerStateStore.isRinging(run)) START_STICKY else START_NOT_STICKY
      }
      stopSelf()
      return START_NOT_STICKY
    }
    val target = TimerRuns.fromIntent(this, intent) ?: return START_NOT_STICKY
    val requestedLease = intent.getStringExtra(EXTRA_LEASE)
    if (intent.action == ACTION_STOP) {
      dismissIfCurrent(target, requestedLease, clearQueue = true)
      if (player == null && owner(this) == null) stopSelfResult(startId)
      return if (canPlay()) START_STICKY else START_NOT_STICKY
    }
    if (intent.action == ACTION_START) {
      if (!TimerStateStore.isRinging(target) || requestedLease != TimerStateStore.alarmLease(target)) {
        if (player == null && owner(this) == null) stopSelfResult(startId)
        return if (canPlay()) START_STICKY else START_NOT_STICKY
      }
      if (owns(target) && lease == requestedLease) return START_STICKY
      run = target
      lease = requestedLease
    } else if (TimerRuns.id(target) != TimerRuns.id(run) || (requestedLease != null && requestedLease != lease)) {
      return if (canPlay()) START_STICKY else START_NOT_STICKY
    }
    when (intent.action) {
      ACTION_UPDATE_VOLUME -> {
        if (!canPlay()) return START_NOT_STICKY
        val config = TimerStateStore.load(run) ?: run {
          stopSelf()
          return START_NOT_STICKY
        }
        if (player == null && TimerStateStore.isRinging(run)) {
          soundId = config.alarmSoundId
          startRinging()
        } else {
          val effective = (config.volume * config.alarmVolume).coerceIn(0f, 1f)
          audioOutput?.setVolume(effective)
          TimerHaptics.startAlarm(this, config.haptics)
          if (config.timerV2Program == null) scheduleAutoSilence(config.alarmDurationSeconds)
        }
      }
      ACTION_START -> {
        if (!TimerStateStore.isRinging(run)) {
          if (!advance(run)) stopSelfResult(startId)
          return START_NOT_STICKY
        }
        soundId = intent.getStringExtra(EXTRA_SOUND_ID) ?: "alarm-tone"
        startRinging()
      }
      else -> stopSelf()
    }
    return if (TimerStateStore.isRinging(run)) START_STICKY else START_NOT_STICKY
  }

  private fun startRinging() {
    val config = TimerStateStore.load(run) ?: run {
      stopSelf()
      return
    }
    stopHandled = false
    val expiresAt = TimerStateStore.alarmExpiresAt(run)
    if (alarmExpired(expiresAt)) {
      finishAlarm(keepOverlay = false)
      return
    }
    val promoted = runCatching {
      TimerNotifications.ensureChannels(this)
      promoteForeground(buildNotification(config))
    }.isSuccess
    if (!promoted) {
      failStartWithoutLimbo(config)
      return
    }
    TimerStateStore.setAlarmVisible(run, true)
    AlarmStateRegistry.notify(run, true)
    TimerHaptics.startAlarm(this, config.haptics)
    // V2 Alarm Once/Locked is repeat-until-dismissed. Keep the configurable
    // timeout only for the legacy timer where that duration is user-facing.
    if (config.timerV2Program == null) scheduleAutoSilence(config.alarmDurationSeconds)
    handler.removeCallbacks(expireStepAlarm)
    if (expiresAt > 0L) handler.postDelayed(expireStepAlarm, (expiresAt - System.currentTimeMillis()).coerceAtLeast(0L))

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
          .getOrElse {
            soundId = "builtin:${R.raw.alarm}"
            TimerSoundPlayer.setDataSource(this@ChandasAlarmService, this, soundId)
          }
        isLooping = true
        val volume = (config.volume * config.alarmVolume).coerceIn(0f, 1f)
        val output = TimerAudioOutput.Playback(this@ChandasAlarmService, this, volume)
        audioOutput = output
        setOnPreparedListener {
          if (it === player && canPlay()) runCatching {
            output.start()
            TimerPlaybackTrace.record(run) { "start looping-alarm sound=${TimerPlaybackTrace.sound(soundId)} expires=$expiresAt" }
          }.onFailure { silenceAndResume() }
        }
        setOnErrorListener { failed, _, _ ->
          if (failed !== player || !canPlay()) return@setOnErrorListener true
          if (soundId != "builtin:${R.raw.alarm}") {
            player?.release()
            player = null
            audioOutput = null
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

  private fun failStartWithoutLimbo(config: TimerConfig) {
    stopHandled = true
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    TimerStateStore.setRinging(run, false)
    TimerStateStore.setAlarmVisible(run, false)
    AlarmStateRegistry.notify(run, false)
    TimerNotifications.postRunning(run, config)
    TimerHaptics.cue(this, config.haptics, primary = true)
    if (!advance(run)) stopSelfResult(latestStartId)
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
        TimerStateStore.setAlarmVisible(run, false)
        AlarmStateRegistry.notify(run, false)
      }
      return
    }
    stopHandled = true
    handler.removeCallbacks(autoSilence)
    handler.removeCallbacks(expireStepAlarm)
    player?.release()
    player = null
    audioOutput = null
    TimerHaptics.stop(this)
    abandonAudioFocus()
    val replaced = TimerStateStore.isRinging(run) && TimerStateStore.alarmLease(run) != lease
    if (replaced) return
    TimerPlaybackTrace.record(run) { "stop looping-alarm keepOverlay=$keepOverlay" }
    TimerStateStore.setRinging(run, false)
    if (!keepOverlay || TimerRuns.contexts(run).any { TimerStateStore.alarmQueuedAt(it) > 0L }) {
      TimerStateStore.setAlarmVisible(run, false)
      AlarmStateRegistry.notify(run, false)
    }
    TimerNotifications.cancelAlarm(this)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    TimerStateStore.load(run)?.let { TimerNotifications.postRunning(run, it) }
    if (!advance(run)) stopSelfResult(latestStartId)
  }

  private fun buildNotification(config: TimerConfig): Notification {
    val copy = TimerNotificationCopy.from(config.notificationPresentation)
    val launchIntent = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent())
      .apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        putExtra(AlarmWindowHelper.EXTRA_ALARM_RINGING, true)
      }
    val fullScreenIntent = PendingIntent.getActivity(
      this,
      8301,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val stopIntent = TimerRuns.route(Intent(this, ChandasAlarmService::class.java), run).setAction(ACTION_STOP).putExtra(EXTRA_LEASE, lease)
    val stopPendingIntent = PendingIntent.getService(
      this,
      8302,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = NotificationCompat.Builder(this, TimerNotifications.ALARM_CHANNEL)
      .setContentTitle(TimerRuns.name(run) ?: config.timerV2Program?.let(TimerV2Timeline::notificationTitle) ?: copy.alarmTitle)
      .setContentText(copy.alarmBody)
      .setSmallIcon(TimerNotifications.smallIcon())
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVibrate(longArrayOf(0L))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(fullScreenIntent)
      .addAction(0, copy.stopAlarmAction, stopPendingIntent)

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
    instance = null
    handler.removeCallbacks(autoSilence)
    handler.removeCallbacks(expireStepAlarm)
    player?.release()
    player = null
    audioOutput = null
    TimerHaptics.stop(this)
    abandonAudioFocus()
    if (!stopHandled && leaseIsCurrent()) {
      TimerStateStore.setRinging(run, false)
      TimerStateStore.setAlarmVisible(run, false)
      AlarmStateRegistry.notify(run, false)
      TimerNotifications.cancelAlarm(this)
    }
    super.onDestroy()
  }
}
