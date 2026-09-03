package expo.modules.chandastimerservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object TimerNotifications {
  const val RUNNING_ID = 1001
  const val ALARM_ID = 1002
  private const val EVENT_ID = 1003

  const val RUNNING_CHANNEL = "chandas-running"
  const val EVENT_CHANNEL = "chandas-events"
  const val ALARM_CHANNEL = "chandas-alarm"

  /** Prefer Expo's monochrome notification resource; never assume an adaptive launcher icon is valid here. */
  fun smallIcon(context: Context): Int {
    val generated = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (generated != 0) generated else context.applicationInfo.icon
  }

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(NotificationChannel(
      RUNNING_CHANNEL,
      "Chandas running",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shows the active timer and next gong time"
      setSound(null, null)
      setShowBadge(false)
    })
    manager.createNotificationChannel(NotificationChannel(
      EVENT_CHANNEL,
      "Chandas chimes",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Shows bell and gong events"
      setSound(null, null)
      setShowBadge(false)
    })
    manager.createNotificationChannel(NotificationChannel(
      ALARM_CHANNEL,
      "Chandas alarm",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Shown while a Chandas alarm is ringing"
      setSound(null, null)
      setShowBadge(false)
    })
  }

  fun postRunning(context: Context, config: TimerConfig) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!config.notificationsEnabled) {
      manager.cancel(RUNNING_ID)
      return
    }
    ensureChannels(context)
    val now = System.currentTimeMillis()
    val content = if (ActiveHours.isActive(config, now)) {
      val next = config.timerV2Program?.let { TimerV2Timeline.next(it, config.timerV2Anchor, now)?.at }
        ?: TimerMath.nextTick(now, config.mainMs, config.phase)
      "Next cue at ${formatTime(next)}"
    } else {
      "Resumes at ${formatTime(ActiveHours.nextStart(config, now))}"
    }
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        context,
        8101,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val stopIntent = PendingIntent.getBroadcast(
      context,
      8102,
      Intent(context, TimerEventReceiver::class.java).setAction(TimerEventReceiver.ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    runCatching { manager.notify(
      RUNNING_ID,
      NotificationCompat.Builder(context, RUNNING_CHANNEL)
        .setContentTitle("Chandas")
        .setContentText(content)
        .setSmallIcon(smallIcon(context))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(contentIntent)
        .addAction(0, "Stop timer", stopIntent)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build(),
    ) }
  }

  fun postEvent(context: Context, config: TimerConfig, type: TimerEventType) {
    if (type == TimerEventType.ACTIVE_START || type == TimerEventType.REALIGN) return
    if (!config.notificationsEnabled) return
    ensureChannels(context)
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        context,
        8103,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val label = if (type == TimerEventType.MAIN) "Gong" else if (type == TimerEventType.V2) "Cue" else "Bell"
    runCatching { manager.notify(
      EVENT_ID,
      NotificationCompat.Builder(context, EVENT_CHANNEL)
        .setContentTitle("Chandas $label")
        .setContentText("Timer interval reached")
        .setSmallIcon(smallIcon(context))
        .setAutoCancel(true)
        .setTimeoutAfter(8_000L)
        .setContentIntent(contentIntent)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build(),
    ) }
  }

  fun cancelRunning(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(RUNNING_ID)
    manager.cancel(EVENT_ID)
  }

  fun cancelAlarm(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(ALARM_ID)
  }

  private fun formatTime(epochMs: Long): String =
    SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(epochMs))
}
