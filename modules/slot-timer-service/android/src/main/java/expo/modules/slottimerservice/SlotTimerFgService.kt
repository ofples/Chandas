package expo.modules.slottimerservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.min

/**
 * Foreground service (type `mediaPlayback`) that owns SlotTimer's tick scheduling,
 * gong/bell/background-music playback, and the ongoing "Next gong at HH:MM"
 * notification. It runs independently of the JS/React Native side, so the timer
 * keeps chiming accurately whether the app is foregrounded, backgrounded, or the
 * screen is off — no silent-audio keep-alive hack needed, and volume 0 means truly
 * silent.
 *
 * In alarm mode, the main gong tick instead starts a continuous, looping alarm
 * that rings until dismissed — see startAlarmRinging()/stopAlarmRinging() below.
 *
 * The JS side (src/hooks/useTimer.ts) renders the ring/countdown itself, computed
 * from the same deterministic (mainMs, subMs, phase) this service uses — so the two
 * never need to exchange tick events to stay in sync; only start/update/stop calls
 * cross the bridge.
 */
class SlotTimerFgService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.slottimerservice.action.START"
    const val ACTION_UPDATE = "expo.modules.slottimerservice.action.UPDATE"
    const val ACTION_STOP = "expo.modules.slottimerservice.action.STOP"
    const val ACTION_STOP_ALARM = "expo.modules.slottimerservice.action.STOP_ALARM"

    const val EXTRA_MAIN_MS = "mainMs"
    const val EXTRA_SUB_MS = "subMs"
    const val EXTRA_PHASE = "phase"
    const val EXTRA_SUB_ENABLED = "subEnabled"
    const val EXTRA_VOLUME = "volume"
    const val EXTRA_BG_TRACK = "bgTrack"
    const val EXTRA_BG_VOLUME = "bgVolume"
    const val EXTRA_NOTIFICATIONS_ENABLED = "notificationsEnabled"
    const val EXTRA_ALARM_MODE_ENABLED = "alarmModeEnabled"

    private const val CHANNEL_ID = "slottimer-running"
    private const val ALARM_CHANNEL_ID = "slottimer-alarm"
    private const val NOTIF_ID = 1001
    private const val ALARM_NOTIF_ID = 1002

    private const val TICK_TOLERANCE_MS = 1000L
    private const val MINUTE_MS = 60_000L

    // Whether the alarm is ringing right now — read by SlotTimerServiceModule's
    // synchronous isRinging() query (for cold-start/resume) and updated via the
    // listener registry below (for live events while JS is mounted). A plain
    // in-process listener list is enough since the module and service always
    // share the same process.
    @Volatile
    var isRingingNow: Boolean = false
      private set

    private val ringingListeners = mutableListOf<(Boolean) -> Unit>()

    fun addRingingListener(listener: (Boolean) -> Unit) {
      ringingListeners.add(listener)
    }

    fun removeRingingListener(listener: (Boolean) -> Unit) {
      ringingListeners.remove(listener)
    }

    private fun notifyRinging(ringing: Boolean) {
      isRingingNow = ringing
      ringingListeners.toList().forEach { it(ringing) }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var config: TimerConfig? = null

  private var gongPlayer: MediaPlayer? = null
  private var bellPlayer: MediaPlayer? = null
  private var bgPlayer: MediaPlayer? = null
  private var bgPlayerTrack: Int = -1
  private var alarmPlayer: MediaPlayer? = null

  private val tickRunnable = Runnable { onTick() }
  private val minuteRunnable = Runnable { onMinuteBoundary() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START, ACTION_UPDATE -> {
        val next = mergeConfig(intent, config)
        config = next
        if (isRingingNow) {
          // Don't disturb an in-progress alarm — just remember the new config
          // (volume/track/etc.) for when ticking resumes after dismissal.
          return START_NOT_STICKY
        }
        ensureNotificationChannel()
        startForegroundNow(next)
        ensurePlayers(next)
        rescheduleAll(next)
      }
      ACTION_STOP_ALARM -> config?.let { stopAlarmRinging(it) }
      ACTION_STOP -> stopSelfCleanly()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tickRunnable)
    handler.removeCallbacks(minuteRunnable)
    releasePlayers()
    if (isRingingNow) notifyRinging(false)
    super.onDestroy()
  }

  // ── Config ─────────────────────────────────────────────────────
  //
  // ACTION_UPDATE only carries the fields that changed (mirrors JS's
  // Partial<NativeTimerConfig>), so unset extras fall back to the previous value.

  private fun mergeConfig(intent: Intent, previous: TimerConfig?): TimerConfig {
    val extras = intent.extras
    fun long(key: String, fallback: Long) =
      if (extras?.containsKey(key) == true) extras.getLong(key) else fallback
    fun float(key: String, fallback: Float) =
      if (extras?.containsKey(key) == true) extras.getFloat(key) else fallback
    fun int(key: String, fallback: Int) =
      if (extras?.containsKey(key) == true) extras.getInt(key) else fallback
    fun bool(key: String, fallback: Boolean) =
      if (extras?.containsKey(key) == true) extras.getBoolean(key) else fallback

    return TimerConfig(
      mainMs = long(EXTRA_MAIN_MS, previous?.mainMs ?: 0L),
      subMs = long(EXTRA_SUB_MS, previous?.subMs ?: 0L),
      phase = long(EXTRA_PHASE, previous?.phase ?: 0L),
      subEnabled = bool(EXTRA_SUB_ENABLED, previous?.subEnabled ?: true),
      volume = float(EXTRA_VOLUME, previous?.volume ?: 0.8f),
      bgTrack = int(EXTRA_BG_TRACK, previous?.bgTrack ?: 1),
      bgVolume = float(EXTRA_BG_VOLUME, previous?.bgVolume ?: 0.5f),
      notificationsEnabled = bool(EXTRA_NOTIFICATIONS_ENABLED, previous?.notificationsEnabled ?: true),
      alarmModeEnabled = bool(EXTRA_ALARM_MODE_ENABLED, previous?.alarmModeEnabled ?: false),
    )
  }

  // ── Scheduling ────────────────────────────────────────────────

  private fun rescheduleAll(cfg: TimerConfig) {
    handler.removeCallbacks(tickRunnable)
    handler.removeCallbacks(minuteRunnable)
    if (cfg.mainMs <= 0) return

    val now = System.currentTimeMillis()
    val nextMain = TimerMath.nextTick(now, cfg.mainMs, cfg.phase)
    val nextSub = if (cfg.subEnabled && cfg.subMs > 0)
      TimerMath.nextSubTick(now, cfg.mainMs, cfg.subMs, cfg.phase)
    else
      Long.MAX_VALUE
    val delay = (min(nextMain, nextSub) - now).coerceAtLeast(0)
    handler.postDelayed(tickRunnable, delay)

    scheduleMinuteBoundary(cfg)
  }

  private fun scheduleMinuteBoundary(cfg: TimerConfig) {
    handler.removeCallbacks(minuteRunnable)
    if (cfg.mainMs <= 0) return
    val now = System.currentTimeMillis()
    val remaining = TimerMath.nextTick(now, cfg.mainMs, cfg.phase) - now
    val msIntoMinute = remaining % MINUTE_MS
    val delay = if (msIntoMinute == 0L) MINUTE_MS else msIntoMinute
    handler.postDelayed(minuteRunnable, delay)
  }

  private fun onTick() {
    val cfg = config ?: return
    val now = System.currentTimeMillis()
    val nextMain = TimerMath.nextTick(now, cfg.mainMs, cfg.phase)
    val nextSub = if (cfg.subEnabled && cfg.subMs > 0)
      TimerMath.nextSubTick(now, cfg.mainMs, cfg.subMs, cfg.phase)
    else
      Long.MAX_VALUE

    val firedMain = abs(now - nextMain) < TICK_TOLERANCE_MS
    val firedSub = !firedMain && nextSub != Long.MAX_VALUE && abs(now - nextSub) < TICK_TOLERANCE_MS

    if (firedMain && cfg.alarmModeEnabled) {
      // Continuous alarm — pauses scheduling until stopAlarmRinging() resumes it.
      startAlarmRinging(cfg)
      return
    }

    if (firedMain) playOneShot(gongPlayer, cfg.volume)
    else if (firedSub) playOneShot(bellPlayer, cfg.volume)

    updateNotification(cfg)
    rescheduleAll(cfg)
  }

  private fun onMinuteBoundary() {
    val cfg = config ?: return
    updateNotification(cfg)
    scheduleMinuteBoundary(cfg)
  }

  // ── Alarm mode ─────────────────────────────────────────────────

  private fun startAlarmRinging(cfg: TimerConfig) {
    handler.removeCallbacks(tickRunnable)
    handler.removeCallbacks(minuteRunnable)
    notifyRinging(true)

    alarmPlayer?.release()
    alarmPlayer = MediaPlayer().apply {
      setAudioAttributes(alarmAttributes())
      val afd = resources.openRawResourceFd(R.raw.alarm)
      setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      afd.close()
      isLooping = true
      val v = cfg.volume.coerceIn(0f, 1f)
      setVolume(v, v)
      setOnPreparedListener { it.start() }
      prepareAsync()
    }

    ensureAlarmNotificationChannel()
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // Re-point the foreground service at the alarm notification (a new ID). A
    // pinned foreground notification can't be reliably dismissed with
    // NotificationManager.cancel() — startForeground() with a new ID is the
    // correct way to swap it.
    promoteForeground(ALARM_NOTIF_ID, buildAlarmNotification(manager))
  }

  private fun stopAlarmRinging(cfg: TimerConfig) {
    alarmPlayer?.release()
    alarmPlayer = null
    notifyRinging(false)

    ensureNotificationChannel()
    promoteForeground(NOTIF_ID, buildNotification(cfg))
    rescheduleAll(cfg)
  }

  // ── Audio ─────────────────────────────────────────────────────

  private fun ensurePlayers(cfg: TimerConfig) {
    if (gongPlayer == null) gongPlayer = createOneShotPlayer(R.raw.gong)
    if (bellPlayer == null) bellPlayer = createOneShotPlayer(R.raw.bell)

    if (cfg.bgVolume <= 0f) {
      bgPlayer?.release()
      bgPlayer = null
      bgPlayerTrack = -1
      return
    }

    if (bgPlayer == null || bgPlayerTrack != cfg.bgTrack) {
      bgPlayer?.release()
      val resId = bgTrackResId(cfg.bgTrack)
      // Background tracks are a few MB — prepare asynchronously so onStartCommand
      // (main thread) never blocks on decoding a multi-megabyte file.
      bgPlayer = MediaPlayer().apply {
        setAudioAttributes(musicAttributes())
        val afd = resources.openRawResourceFd(resId)
        setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
        afd.close()
        isLooping = true
        setVolume(cfg.bgVolume, cfg.bgVolume)
        setOnPreparedListener { it.start() }
        prepareAsync()
      }
      bgPlayerTrack = cfg.bgTrack
    } else {
      bgPlayer?.setVolume(cfg.bgVolume, cfg.bgVolume)
    }
  }

  private fun createOneShotPlayer(resId: Int): MediaPlayer =
    MediaPlayer.create(this, resId).apply {
      setAudioAttributes(alarmAttributes())
    }

  private fun playOneShot(player: MediaPlayer?, volume: Float) {
    if (player == null || volume <= 0f) return
    val v = volume.coerceIn(0f, 1f)
    player.setVolume(v, v)
    try {
      player.seekTo(0)
      player.start()
    } catch (_: IllegalStateException) {
      // Player was in a bad state (rare) — recreate lazily on the next tick.
    }
  }

  private fun musicAttributes(): AudioAttributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
      .build()

  private fun alarmAttributes(): AudioAttributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

  private fun bgTrackResId(track: Int): Int = when (track) {
    2 -> R.raw.bg2
    3 -> R.raw.bg3
    else -> R.raw.bg1
  }

  private fun releasePlayers() {
    gongPlayer?.release(); gongPlayer = null
    bellPlayer?.release(); bellPlayer = null
    bgPlayer?.release(); bgPlayer = null
    bgPlayerTrack = -1
    alarmPlayer?.release(); alarmPlayer = null
  }

  // ── Notification (ongoing "running" state) ─────────────────────

  private fun ensureNotificationChannel() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "SlotTimer running",
      NotificationManager.IMPORTANCE_LOW, // silent — the service plays the gong itself
    ).apply {
      description = "Shows the running SlotTimer session and its next gong time"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(cfg: TimerConfig): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this, 0, it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    // Android requires an ongoing notification for any foreground service — this is
    // an OS constraint, independent of the in-app "notifications" toggle. When the
    // user has disabled notifications we still show one, but keep it minimal.
    val body = if (cfg.notificationsEnabled && cfg.mainMs > 0) {
      val next = TimerMath.nextTick(System.currentTimeMillis(), cfg.mainMs, cfg.phase)
      "Next gong at ${formatTime(next)}"
    } else {
      "Timer running"
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("SlotTimer")
      .setContentText(body)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(contentIntent)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun updateNotification(cfg: TimerConfig) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIF_ID, buildNotification(cfg))
  }

  private fun startForegroundNow(cfg: TimerConfig) {
    promoteForeground(NOTIF_ID, buildNotification(cfg))
  }

  // Pins the given notification as the foreground service's notification —
  // used both for the initial/ongoing "running" state and to swap to the
  // escalated alarm notification (and back) without stopping the service.
  private fun promoteForeground(id: Int, notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceCompat.startForeground(
        this,
        id,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(id, notification)
    }
  }

  // ── Notification (alarm-ringing state) ──────────────────────────
  //
  // A separate, high-importance channel is required for the full-screen intent
  // (which wakes the screen / shows over the lock screen) and the heads-up
  // "Stop alarm" action — the ongoing "running" channel above is deliberately
  // low-importance/silent since the service already plays the gong itself.

  private fun ensureAlarmNotificationChannel() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      ALARM_CHANNEL_ID,
      "SlotTimer alarm",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Shown while SlotTimer's alarm mode is ringing"
      setSound(null, null) // the service plays the alarm sound itself
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildAlarmNotification(manager: NotificationManager): Notification {
    val launchIntent = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent())
      .apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(AlarmWindowHelper.EXTRA_ALARM_RINGING, true)
      }
    val fullScreenPendingIntent = PendingIntent.getActivity(
      this, 0, launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val stopIntent = Intent(this, SlotTimerFgService::class.java).setAction(ACTION_STOP_ALARM)
    val stopPendingIntent = PendingIntent.getService(
      this, 0, stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = NotificationCompat.Builder(this, ALARM_CHANNEL_ID)
      .setContentTitle("SlotTimer — Time's up")
      .setContentText("Alarm is ringing")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setContentIntent(fullScreenPendingIntent)
      .addAction(0, "Stop alarm", stopPendingIntent)

    // canUseFullScreenIntent() is Android 14+ API — full-screen intents are no
    // longer unconditionally granted there. If it's not available, the
    // notification still rings, shows the Stop action, and heads-ups normally;
    // it just won't force the screen on / draw over the lock screen.
    val canUseFullScreen = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
      manager.canUseFullScreenIntent()
    if (canUseFullScreen) {
      builder.setFullScreenIntent(fullScreenPendingIntent, true)
    }

    return builder.build()
  }

  private fun formatTime(epochMs: Long): String =
    SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(epochMs))

  private fun stopSelfCleanly() {
    handler.removeCallbacks(tickRunnable)
    handler.removeCallbacks(minuteRunnable)
    releasePlayers()
    if (isRingingNow) notifyRinging(false)
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(ALARM_NOTIF_ID)
    config = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }
}
