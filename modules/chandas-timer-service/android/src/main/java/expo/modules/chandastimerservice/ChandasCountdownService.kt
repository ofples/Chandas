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
import java.io.FileDescriptor
import java.io.PrintWriter

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

    private fun promotedAvailable(context: Context, config: TimerConfig?): Boolean {
      // Timer status is automatic now. Retained legacy live-countdown preferences
      // must not silently hide it for newly started or restored timers.
      if (config?.notificationsEnabled != true || Build.VERSION.SDK_INT < 36) return false
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      return NotificationManagerCompat.from(context).areNotificationsEnabled() && manager.canPostPromotedNotifications()
    }

    fun reconcile(context: Context) {
      val config = TimerRuns.presentationConfig(TimerRuns.presentation(context))
      val overlay = FloatingTimerOverlay.needsService(context)
      val promoted = promotedAvailable(context, config)
      if (live) {
        if (!overlay && !promoted) { stop(context); return }
        instance?.let { service ->
          service.handler.post {
            if (service.render(promote = false, forceUpdate = true)) service.refreshTicker()
          }
        }
        return
      }
      if (config == null) return
      if (!overlay && !promoted) return
      runCatching {
        ContextCompat.startForegroundService(
          context,
          Intent(context, ChandasCountdownService::class.java).setAction(ACTION_START),
        )
      }.onFailure { FloatingTimerOverlay.serviceStartFailed(context) }
    }

    fun ensureRunning(context: Context) = reconcile(context)

    fun stop(context: Context, removeNotification: Boolean = false) {
      val service = instance
      if (service != null) {
        service.handler.post {
          service.fallbackOnDestroy = false
          service.finish(removeNotification)
        }
      } else {
        runCatching { context.stopService(Intent(context, ChandasCountdownService::class.java)) }
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var fallbackOnDestroy = true
  private var lastCompactText: String? = null
  private val refresh = object : Runnable {
    override fun run() {
      if (!render(promote = false)) return
      refreshTicker()
    }
  }

  private fun refreshTicker() {
    handler.removeCallbacks(refresh)
    val config = TimerRuns.presentationConfig(TimerRuns.presentation(this))
    // A paused compact status has no changing time. Resume reconciles the
    // service and restarts its display ticker when a countdown exists again.
    if (config?.timerV2PausedAt != 0L || !promotedAvailable(this, config)) return
    val now = System.currentTimeMillis()
    handler.postDelayed(refresh, TICK_MS - (now % TICK_MS))
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun dump(fd: FileDescriptor, writer: PrintWriter, args: Array<out String>?) {
    if (args?.contentEquals(arrayOf("playback")) == true) TimerPlaybackTrace.dump(this, writer)
    else super.dump(fd, writer, args)
  }

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
    refreshTicker()
    return START_STICKY
  }

  private fun render(promote: Boolean, forceUpdate: Boolean = false): Boolean {
    val run = TimerRuns.presentation(this)
    val config = TimerRuns.presentationConfig(run)
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val overlay = FloatingTimerOverlay.needsService(this)
    val promotedAvailable = promotedAvailable(this, config)
    if (
      config == null ||
      (!overlay && !promotedAvailable)
    ) {
      finish(removeNotification = config?.notificationsEnabled != true)
      return false
    }
    FloatingTimerOverlay.reconcile(this)
    val compactText = if (promotedAvailable) TimerNotifications.compactStatus(config) ?: "Running" else null
    val updateNotification = promote || forceUpdate || (promotedAvailable && compactText != lastCompactText)
    val notification = if (updateNotification) TimerNotifications.buildRunning(run, config, includeCompactStatus = promotedAvailable) else null
    if (promote) {
      if (notification == null) return false
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
    } else if (notification != null) {
      runCatching { manager.notify(TimerNotifications.RUNNING_ID, notification) }
    }
    lastCompactText = compactText
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
    TimerRuns.presentationConfig(TimerRuns.presentation(this))
      ?.takeIf { fallbackOnDestroy }
      ?.takeIf { it.notificationsEnabled && it.liveCountdownEnabled }
      ?.let { config ->
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        runCatching {
          manager.notify(
            TimerNotifications.RUNNING_ID,
            TimerNotifications.buildRunning(TimerRuns.presentation(this), config, includeCompactStatus = false),
          )
        }
      }
    super.onDestroy()
  }
}
