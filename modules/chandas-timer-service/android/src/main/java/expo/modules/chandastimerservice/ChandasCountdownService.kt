package expo.modules.chandastimerservice

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Owns continuous timer presentation: optional promoted copy and floating surface.
 * Bell delivery remains entirely AlarmManager-owned; stopping this best-effort
 * presentation service cannot stop, delay, or duplicate timer events.
 */
class ChandasCountdownService : Service() {
  companion object {
    private const val ACTION_START = "expo.modules.chandastimerservice.action.START_COUNTDOWN"
    private const val TICK_MS = 1_000L

    @Volatile private var live = false
    @Volatile private var instance: ChandasCountdownService? = null

    fun reconcile(context: Context) {
      if (live) {
        instance?.let { FloatingTimerOverlay.reconcile(it) }
        return
      }
      val config = TimerStateStore.load(context) ?: return
      val overlay = FloatingTimerOverlay.needsService(context)
      val promoted = config.liveCountdownEnabled && Build.VERSION.SDK_INT >= 36
      if (!overlay && !promoted) return
      runCatching {
        ContextCompat.startForegroundService(
          context,
          Intent(context, ChandasCountdownService::class.java).setAction(ACTION_START),
        )
      }.onFailure { FloatingTimerOverlay.serviceStartFailed(context) }
    }

    fun ensureRunning(context: Context) = reconcile(context)

    fun stop(context: Context) {
      instance?.fallbackOnDestroy = false
      runCatching { context.stopService(Intent(context, ChandasCountdownService::class.java)) }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var fallbackOnDestroy = true
  private val refresh = object : Runnable {
    override fun run() {
      if (!render(promote = false)) return
      val now = System.currentTimeMillis()
      handler.postDelayed(this, TICK_MS - (now % TICK_MS))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    FloatingTimerOverlay.reconcile(this)
    FloatingTimerOverlay.refreshBounds(this)
  }

  override fun onCreate() {
    super.onCreate()
    live = true
    instance = this
    FloatingTimerOverlay.attachService(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A null intent is Android restoring this START_STICKY service after
    // process reclamation; persisted timer state remains authoritative.
    val action = intent?.action
    if (action != null && action != ACTION_START) {
      finish(removeNotification = false)
      return START_NOT_STICKY
    }
    if (!render(promote = true)) return START_NOT_STICKY
    handler.removeCallbacks(refresh)
    val now = System.currentTimeMillis()
    handler.postDelayed(refresh, TICK_MS - (now % TICK_MS))
    return START_STICKY
  }

  private fun render(promote: Boolean): Boolean {
    val config = TimerStateStore.load(this)
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val overlay = FloatingTimerOverlay.needsService(this)
    val promotedAvailable = config?.liveCountdownEnabled == true && Build.VERSION.SDK_INT >= 36 &&
      NotificationManagerCompat.from(this).areNotificationsEnabled() && manager.canPostPromotedNotifications()
    if (
      config == null ||
      (!overlay && !promotedAvailable)
    ) {
      finish(removeNotification = config?.notificationsEnabled != true)
      return false
    }
    FloatingTimerOverlay.reconcile(this)
    val notification = TimerNotifications.buildRunning(this, config, includeCompactStatus = promotedAvailable)
    // Paused schedules intentionally have no ticking target. Drop the updater
    // until the exact resume event posts the notification and starts it again.
    if (!overlay && NotificationCompat.getShortCriticalText(notification) == null) {
      finish(removeNotification = false)
      return false
    }
    if (promote) {
      val promoted = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          ServiceCompat.startForeground(
            this,
            TimerNotifications.RUNNING_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
          )
        } else {
          startForeground(TimerNotifications.RUNNING_ID, notification)
        }
      }.isSuccess
      if (!promoted) {
        finish(removeNotification = false)
        return false
      }
    } else {
      runCatching { manager.notify(TimerNotifications.RUNNING_ID, notification) }
    }
    if (overlay) FloatingTimerOverlay.emitSnapshot(this)
    return true
  }

  private fun finish(removeNotification: Boolean) {
    handler.removeCallbacks(refresh)
    ServiceCompat.stopForeground(
      this,
      if (removeNotification) ServiceCompat.STOP_FOREGROUND_REMOVE else ServiceCompat.STOP_FOREGROUND_DETACH,
    )
    stopSelf()
  }

  override fun onDestroy() {
    live = false
    instance = null
    handler.removeCallbacks(refresh)
    FloatingTimerOverlay.detachService(this)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
    // If Android tears down this presentation helper, immediately replace a
    // potentially frozen custom label with the OS-owned single chronometer.
    TimerStateStore.load(this)
      ?.takeIf { fallbackOnDestroy }
      ?.takeIf { it.notificationsEnabled && it.liveCountdownEnabled }
      ?.let { config ->
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        runCatching {
          manager.notify(
            TimerNotifications.RUNNING_ID,
            TimerNotifications.buildRunning(this, config, includeCompactStatus = false),
          )
        }
      }
    super.onDestroy()
  }
}
