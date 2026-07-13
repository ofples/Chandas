package expo.modules.slottimerservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object TimerNotifications {
  const val RUNNING_ID = 1001
  const val ALARM_ID = 1002
  private const val EVENT_ID = 1003

  const val RUNNING_CHANNEL = "slottimer-running-v2"
  const val EVENT_CHANNEL = "slottimer-events-v2"
  const val ALARM_CHANNEL = "slottimer-alarm-v2"

  fun ensureChannels(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(NotificationChannel(
      RUNNING_CHANNEL,
      "SlotTimer running",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shows the active timer and next gong time"
      setSound(null, null)
      setShowBadge(false)
    })
    manager.createNotificationChannel(NotificationChannel(
      EVENT_CHANNEL,
      "SlotTimer chimes",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Shows bell and gong events"
      setSound(null, null)
      setShowBadge(false)
    })
    manager.createNotificationChannel(NotificationChannel(
      ALARM_CHANNEL,
      "SlotTimer alarm",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Shown while a SlotTimer alarm is ringing"
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
      val nextMain = TimerMath.nextTick(now, config.mainMs, config.phase)
      "Next gong at ${formatTime(nextMain)}"
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
    manager.notify(
      RUNNING_ID,
      NotificationCompat.Builder(context, RUNNING_CHANNEL)
        .setContentTitle("SlotTimer")
        .setContentText(content)
        .setSmallIcon(context.applicationInfo.icon)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(contentIntent)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build(),
    )
  }

  fun postEvent(context: Context, config: TimerConfig, type: TimerEventType) {
    if (type == TimerEventType.ACTIVE_START) return
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
    val label = if (type == TimerEventType.MAIN) "Gong" else "Bell"
    manager.notify(
      EVENT_ID,
      NotificationCompat.Builder(context, EVENT_CHANNEL)
        .setContentTitle("SlotTimer $label")
        .setContentText("Timer interval reached")
        .setSmallIcon(context.applicationInfo.icon)
        .setAutoCancel(true)
        .setTimeoutAfter(8_000L)
        .setContentIntent(contentIntent)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build(),
    )
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
