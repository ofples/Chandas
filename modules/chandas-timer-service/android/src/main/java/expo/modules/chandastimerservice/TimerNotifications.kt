package expo.modules.chandastimerservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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

  /** Android renders this transparent monochrome mask in the status bar and notification header. */
  fun smallIcon(): Int = R.drawable.chandas_notification

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
      enableVibration(false)
      setShowBadge(false)
    })
    manager.createNotificationChannel(NotificationChannel(
      EVENT_CHANNEL,
      "Chandas chimes",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Shows bell and gong events"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    })
    manager.createNotificationChannel(NotificationChannel(
      ALARM_CHANNEL,
      "Chandas alarm",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Shown while a Chandas alarm is ringing"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    })
  }

  fun postRunning(context: Context, config: TimerConfig) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!config.notificationsEnabled) {
      ChandasCountdownService.stop(context)
      manager.cancel(RUNNING_ID)
      return
    }
    ensureChannels(context)
    val now = System.currentTimeMillis()
    // Keep the platform chronometer as the no-service fallback. The live
    // updater replaces this with dual compact text once it is foreground.
    val notification = buildRunning(context, config, now, includeDualCountdown = false)
    runCatching { manager.notify(RUNNING_ID, notification) }
    if (
      config.liveCountdownEnabled &&
      Build.VERSION.SDK_INT >= 36 &&
      NotificationManagerCompat.from(context).areNotificationsEnabled() &&
      manager.canPostPromotedNotifications() &&
      NotificationCompat.getUsesChronometer(notification)
    ) {
      ChandasCountdownService.ensureRunning(context)
    } else {
      ChandasCountdownService.stop(context)
    }
  }

  /** Builds the same notification used by normal posts and the live updater. */
  fun buildRunning(
    context: Context,
    config: TimerConfig,
    now: Long = System.currentTimeMillis(),
    includeDualCountdown: Boolean = false,
  ): Notification {
    val copy = TimerNotificationCopy.from(config.notificationPresentation)
    val event = config.timerV2Program?.let { TimerV2Timeline.next(it, config.timerV2Anchor, now, config.timerV2StartedAt, config.timerV2EndsAt) }
    val completedProgram = config.timerV2Program != null && event == null
    val next = event?.at ?: if (completedProgram) 0L else TimerMath.nextTick(now, config.mainMs, config.phase)
    val activeNow = ActiveHours.isActive(config, now)
    val activeAtNext = next > now && ActiveHours.isActive(config, next)
    val resumesAt = if (!completedProgram && (!activeNow || !activeAtNext)) ActiveHours.nextStart(config, if (activeNow) next else now) else 0L
    val endsBeforeResume = config.timerV2EndsAt > 0L && resumesAt > 0L && resumesAt >= config.timerV2EndsAt
    val countdownAt = when {
      completedProgram -> 0L
      event?.completesRun == true -> next
      endsBeforeResume -> config.timerV2EndsAt
      activeNow && activeAtNext -> next
      else -> 0L
    }
    val content = when {
      completedProgram -> copy.sessionEnds(formatTime(config.timerV2EndsAt.takeIf { it > 0L } ?: now))
      event?.completesRun == true -> copy.sessionEnds(formatTime(next))
      endsBeforeResume -> copy.sessionEnds(formatTime(config.timerV2EndsAt))
      activeNow && activeAtNext -> copy.nextCue(formatTime(next))
      else -> copy.resumes(formatTime(resumesAt))
    }
    val title = config.timerV2Program?.let(TimerV2Timeline::notificationTitle) ?: copy.runningTitle
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
    val builder = NotificationCompat.Builder(context, RUNNING_CHANNEL)
        .setContentTitle(title)
        .setContentText(content)
        .setStyle(NotificationCompat.BigTextStyle().setBigContentTitle(title).bigText(content))
        .setSmallIcon(smallIcon())
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setContentIntent(contentIntent)
        .addAction(0, copy.stopTimerAction, stopIntent)
        .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_LOW)
    if (config.liveCountdownEnabled && countdownAt > now) {
      val compactCountdown = TimerCountdownText.compact(
        currentAt = countdownAt,
        finalAt = config.timerV2EndsAt,
        currentIsFinal = event?.completesRun == true || endsBeforeResume,
        now = now,
      )
      builder
        .setWhen(countdownAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
        // Android 16+ may promote this user-started, time-sensitive timer to a
        // status-bar chip. The notification countdown remains useful when the
        // OS or OEM chooses standard presentation instead.
        .setRequestPromotedOngoing(true)
      if (includeDualCountdown) compactCountdown?.let(builder::setShortCriticalText)
    }
    return builder.build()
  }

  fun postEvent(context: Context, config: TimerConfig, type: TimerEventType) {
    if (type == TimerEventType.ACTIVE_START || type == TimerEventType.REALIGN) return
    if (!config.notificationsEnabled) return
    ensureChannels(context)
    val copy = TimerNotificationCopy.from(config.notificationPresentation)
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
    val title = if (type == TimerEventType.MAIN) copy.mainEventTitle else if (type == TimerEventType.V2) copy.cueEventTitle else copy.bellEventTitle
    runCatching { manager.notify(
      EVENT_ID,
      NotificationCompat.Builder(context, EVENT_CHANNEL)
        .setContentTitle(title)
        .setContentText(copy.eventBody)
        .setSmallIcon(smallIcon())
        .setAutoCancel(true)
        .setTimeoutAfter(8_000L)
        .setContentIntent(contentIntent)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setVibrate(longArrayOf(0L))
        .build(),
    ) }
  }

  fun cancelRunning(context: Context) {
    ChandasCountdownService.stop(context)
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

/** Pure compact-countdown formatting kept separate from notification plumbing. */
internal object TimerCountdownText {
  private const val SECOND_MS = 1_000L
  private const val MINUTE_MS = 60_000L
  private const val HOUR_SECONDS = 3_600L

  fun compact(currentAt: Long, finalAt: Long, currentIsFinal: Boolean, now: Long): String? {
    val currentRemaining = currentAt - now
    if (currentRemaining <= 0L) return null
    val current = formatCurrent(currentRemaining)
    if (currentIsFinal || finalAt <= currentAt || finalAt <= now) return current
    return "$current | ${ceilUnits(finalAt - now, MINUTE_MS)}m"
  }

  private fun formatCurrent(remainingMs: Long): String {
    val totalSeconds = ceilUnits(remainingMs, SECOND_MS)
    if (totalSeconds < 60L) return "${totalSeconds}s"
    val hours = totalSeconds / HOUR_SECONDS
    val minutes = (totalSeconds % HOUR_SECONDS) / 60L
    val seconds = totalSeconds % 60L
    return if (hours > 0L) {
      "$hours:${minutes.twoDigits()}:${seconds.twoDigits()}"
    } else {
      "${minutes.twoDigits()}:${seconds.twoDigits()}"
    }
  }

  private fun ceilUnits(value: Long, unit: Long): Long = ((value - 1L) / unit) + 1L

  private fun Long.twoDigits(): String = toString().padStart(2, '0')
}
