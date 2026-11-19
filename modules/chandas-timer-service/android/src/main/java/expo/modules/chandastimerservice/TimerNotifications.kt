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
  internal const val EVENT_ID = 1003

  const val RUNNING_CHANNEL = "chandas-running"
  private const val PLAYBACK_CHANNEL = "chandas-cue-playback"
  const val ALARM_CHANNEL = "chandas-alarm"

  /** Shared compact status contract for promoted notifications and the overlay pill. */
  fun compactStatus(config: TimerConfig, now: Long = System.currentTimeMillis()): String? {
    if (config.timerV2PausedAt > 0L) return "Paused"
    val program = config.timerV2Program
    val event = program?.let { TimerV2Timeline.nextVisible(it, config.timerV2Anchor, now, config.timerV2StartedAt, config.timerV2EndsAt, config.timerV2RandomSeed.takeIf { seed -> seed != 0L } ?: config.timerV2Anchor) }
    if (program != null && event == null) return if (TimerV2Timeline.noMainInterval(program) && config.timerV2EndsAt == 0L) "∞" else null
    val current = program?.let { TimerV2Timeline.notificationContext(it, config.timerV2Anchor, now) }
    val next = event?.at ?: TimerMath.nextTick(now, config.mainMs, config.phase)
    val activeNow = ActiveHours.isActive(config, now)
    val activeAtNext = next > now && ActiveHours.allowsCue(config, next)
    val resumesAt = if (!activeNow || !activeAtNext) ActiveHours.nextStart(config, if (activeNow) next else now) else 0L
    val endsBeforeResume = config.timerV2EndsAt > 0L && resumesAt >= config.timerV2EndsAt && resumesAt > 0L
    val countdownAt = when {
      event?.completesRun == true -> next
      endsBeforeResume -> config.timerV2EndsAt
      activeNow && activeAtNext -> next
      else -> resumesAt
    }
    if (countdownAt <= now) return if (!activeNow) "Quiet" else null
    val formatted = TimerCountdownText.forProgram(
      identity = current?.compactIdentity.orEmpty(),
      sequence = program?.let(TimerV2Timeline::isSequence) == true,
      currentAt = countdownAt,
      finalAt = current?.currentEndsAt ?: 0L,
      currentIsFinal = event?.completesRun == true || countdownAt == current?.currentEndsAt,
      now = now,
    )
    return if (activeNow) formatted else formatted?.let { "Quiet · $it" } ?: "Quiet"
  }

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
      PLAYBACK_CHANNEL,
      "Chandas cue playback",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Supports cue playback in the background"
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

  fun postRunning(context: Context, @Suppress("UNUSED_PARAMETER") config: TimerConfig) = refreshRunning(context)

  fun refreshRunning(base: Context) {
    val context = TimerRuns.presentation(base)
    val config = TimerRuns.presentationConfig(context)
    if (config == null) {
      ChandasCountdownService.stop(base, removeNotification = true)
      (base.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(RUNNING_ID)
      return
    }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!config.notificationsEnabled) {
      if (FloatingTimerOverlay.needsService(context)) {
        ensureChannels(context)
        ChandasCountdownService.reconcile(context)
      }
      else { ChandasCountdownService.stop(context, removeNotification = true); manager.cancel(RUNNING_ID) }
      return
    }
    ensureChannels(context)
    val promotedAvailable = Build.VERSION.SDK_INT >= 36 &&
      NotificationManagerCompat.from(context).areNotificationsEnabled() &&
      manager.canPostPromotedNotifications()
    val notification = buildRunning(context, config, includeCompactStatus = promotedAvailable)
    runCatching { manager.notify(RUNNING_ID, notification) }
    if (promotedAvailable || FloatingTimerOverlay.needsService(context)) {
      ChandasCountdownService.reconcile(context)
    } else {
      ChandasCountdownService.stop(context)
    }
  }

  /** Builds the same notification used by normal posts and the live updater. */
  fun buildRunning(
    context: Context,
    config: TimerConfig,
    now: Long = System.currentTimeMillis(),
    includeCompactStatus: Boolean = false,
  ): Notification {
    val effectiveNow = config.timerV2PausedAt.takeIf { it > 0L } ?: now
    val copy = TimerNotificationCopy.from(config.notificationPresentation)
    val program = config.timerV2Program
    val event = program?.let { TimerV2Timeline.nextVisible(it, config.timerV2Anchor, effectiveNow, config.timerV2StartedAt, config.timerV2EndsAt, config.timerV2RandomSeed.takeIf { seed -> seed != 0L } ?: config.timerV2Anchor) }
    val notificationContext = program?.let { TimerV2Timeline.notificationContext(it, config.timerV2Anchor, effectiveNow) }
    val waitingForBell = event == null && TimerV2Timeline.noMainInterval(program) && config.timerV2EndsAt == 0L
    val completedProgram = program != null && event == null && !waitingForBell
    val next = event?.at ?: if (program != null) 0L else TimerMath.nextTick(now, config.mainMs, config.phase)
    val activeNow = ActiveHours.isActive(config, now)
    val activeAtNext = next > now && ActiveHours.allowsCue(config, next)
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
      config.timerV2PausedAt > 0L -> "Paused · ${event?.let { TimerCountdownText.forProgram("", false, it.at, 0L, false, effectiveNow) } ?: "--:--"} to next cue"
      completedProgram -> copy.sessionEnds(formatTime(config.timerV2EndsAt.takeIf { it > 0L } ?: now))
      waitingForBell && activeNow -> "No upcoming bells"
      event?.completesRun == true -> copy.sessionEnds(formatTime(next))
      endsBeforeResume -> copy.sessionEnds(formatTime(config.timerV2EndsAt))
      activeNow && activeAtNext -> notificationContext?.label ?: copy.nextCue(formatTime(next))
      else -> if (resumesAt > 0L) copy.resumes(formatTime(resumesAt)) else "No active time"
    }
    val title = TimerRuns.name(context) ?: program?.let(TimerV2Timeline::notificationTitle) ?: copy.runningTitle
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launchIntent?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      TimerRuns.id(context)?.let { id -> it.putExtra(TimerRuns.EXTRA_RUN_ID, id) }
      TimerRuns.route(it, context)
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
      TimerRuns.route(Intent(context, TimerEventReceiver::class.java), context).setAction(TimerEventReceiver.ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val activeRuns = TimerRuns.contexts(context).filter { TimerStateStore.load(it) != null }
    val activeCount = activeRuns.size
    val summary = if (activeCount > 1) "$content · $activeCount active timers" else content
    val expandedContent = buildString {
      append(summary)
      if (config.timerV2PausedAt == 0L && config.timerV2EndsAt > now && event?.completesRun != true) append("\n").append(copy.sessionEnds(formatTime(config.timerV2EndsAt)))
      for (peer in activeRuns.filter { TimerRuns.id(it) != TimerRuns.id(context) }) {
        val peerConfig = TimerStateStore.load(peer) ?: continue
        val peerName = TimerRuns.name(peer) ?: peerConfig.timerV2Program?.let(TimerV2Timeline::notificationTitle) ?: "Timer"
        append("\n").append(peerName).append(" · ").append(compactStatus(peerConfig, now) ?: "Running")
      }
    }
    val builder = NotificationCompat.Builder(context, RUNNING_CHANNEL)
        .setContentTitle(title)
        .setContentText(summary)
        .setStyle(NotificationCompat.BigTextStyle().setBigContentTitle(title).bigText(expandedContent))
        .setSmallIcon(smallIcon())
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setContentIntent(contentIntent)
        .addAction(0, copy.stopTimerAction, stopIntent)
        .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_LOW)
    // The old per-configuration liveCountdownEnabled flag is retained for
    // storage compatibility; ongoing status follows notificationsEnabled.
    if (config.notificationsEnabled) {
      builder.setRequestPromotedOngoing(true)
      val compact = compactStatus(config, now) ?: "Running"
      if (includeCompactStatus || countdownAt <= now || config.timerV2PausedAt > 0L) builder.setShortCriticalText(compact)
    }
    if (config.notificationsEnabled && config.timerV2PausedAt == 0L && countdownAt > now) {
      builder
        .setWhen(countdownAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
        // Android 16+ may promote this user-started, time-sensitive timer to a
        // status-bar chip. The notification countdown remains useful when the
        // OS or OEM chooses standard presentation instead.
        .setRequestPromotedOngoing(true)
    }
    return builder.build()
  }

  internal fun buildCuePlayback(
    context: Context,
    notificationPresentation: String?,
    completion: Boolean,
  ): Notification {
    val copy = TimerNotificationCopy.from(notificationPresentation)
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launchIntent?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      TimerRuns.id(context)?.let { id -> it.putExtra(TimerRuns.EXTRA_RUN_ID, id) }
      TimerRuns.route(it, context)
      PendingIntent.getActivity(
        context,
        8103,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val title = if (completion) copy.completionEventTitle else "Playing timer sound"
    return NotificationCompat.Builder(context, PLAYBACK_CHANNEL)
      .setContentTitle(title)
      .setContentText(if (completion) copy.completionEventBody else null)
      .setSmallIcon(smallIcon())
      .setContentIntent(contentIntent)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .build()
  }

  fun cancelRunning(context: Context) = refreshRunning(context)

  fun cancelAlarm(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(ALARM_ID)
  }

  private fun formatTime(epochMs: Long): String =
    SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(epochMs))
}

/** Pure compact-countdown formatting kept separate from notification plumbing. */
internal object TimerCountdownText {
  private const val MAX_STATUS_CHIP_CHARACTERS = 7
  private const val SECOND_MS = 1_000L
  private const val MINUTE_MS = 60_000L
  private const val HOUR_SECONDS = 3_600L

  fun compact(currentAt: Long, finalAt: Long, currentIsFinal: Boolean, now: Long): String? {
    val currentRemaining = currentAt - now
    if (currentRemaining <= 0L) return null
    val hasFinalPair = !currentIsFinal && finalAt > currentAt && finalAt > now
    val current = formatCurrent(currentRemaining, compactMinutes = hasFinalPair)
    if (!hasFinalPair) return current
    return "$current·${formatFinal(finalAt - now)}"
  }

  /** Bounded runs prioritize both deadlines; continuous runs use interval identity. */
  fun forProgram(identity: String, sequence: Boolean = false, currentAt: Long, finalAt: Long, currentIsFinal: Boolean, now: Long): String? =
    if (sequence) sequenceCompactStatus(identity, currentAt, now)
    else if (finalAt > 0L) compact(currentAt, finalAt, currentIsFinal, now)
    else formatStatusCountdown(currentAt - now)

  /**
   * Android recommends at most seven characters for promoted-notification
   * critical text. Fit as much interval identity as possible before the live
   * next-cue countdown so the system does not truncate an arbitrary suffix.
   */
  fun compactStatus(identity: String, currentAt: Long, now: Long): String? {
    val remaining = currentAt - now
    if (remaining <= 0L) return null
    val countdown = formatStatusCountdown(remaining)
    val availableIdentityCharacters = MAX_STATUS_CHIP_CHARACTERS - countdown.length - 1
    if (availableIdentityCharacters <= 0 || identity.isBlank()) return countdown.take(MAX_STATUS_CHIP_CHARACTERS)
    val prefix = identity.takeCodePoints(availableIdentityCharacters)
    return if (prefix.isEmpty()) countdown else "$prefix·$countdown"
  }

  /** Keep the current step visible; Android may shorten the trailing countdown on narrow chips. */
  private fun sequenceCompactStatus(identity: String, currentAt: Long, now: Long): String? {
    val countdown = formatStatusCountdown(currentAt - now)
    if (countdown.isBlank() || identity.isBlank()) return countdown.take(MAX_STATUS_CHIP_CHARACTERS)
    return "$countdown·${identity.takeCodePoints(4)}"
  }

  private fun formatCurrent(remainingMs: Long, compactMinutes: Boolean): String {
    val totalSeconds = ceilUnits(remainingMs, SECOND_MS)
    if (totalSeconds < 60L) return "${totalSeconds}s"
    val hours = totalSeconds / HOUR_SECONDS
    val minutes = (totalSeconds % HOUR_SECONDS) / 60L
    val seconds = totalSeconds % 60L
    return if (hours > 0L) {
      "$hours:${minutes.twoDigits()}:${seconds.twoDigits()}"
    } else if (compactMinutes) {
      "${minutes.twoDigits()}:${seconds.twoDigits()}"
    } else {
      "${minutes.twoDigits()}:${seconds.twoDigits()}"
    }
  }

  private fun formatStatusCountdown(remainingMs: Long): String {
    val totalSeconds = ceilUnits(remainingMs, SECOND_MS)
    if (totalSeconds < 60L) return "${totalSeconds}s"
    if (totalSeconds < HOUR_SECONDS) {
      return "${totalSeconds / 60L}:${(totalSeconds % 60L).twoDigits()}"
    }
    return "${ceilUnits(remainingMs, MINUTE_MS)}m"
  }

  private fun formatFinal(remainingMs: Long): String {
    val seconds = ceilUnits(remainingMs, SECOND_MS)
    return if (seconds < 60L) "${seconds}s" else "${seconds / 60L}m"
  }

  private fun ceilUnits(value: Long, unit: Long): Long = ((value - 1L) / unit) + 1L

  private fun Long.twoDigits(): String = toString().padStart(2, '0')

  private fun String.takeCodePoints(count: Int): String {
    if (count <= 0 || isEmpty()) return ""
    val end = offsetByCodePoints(0, minOf(count, codePointCount(0, length)))
    return substring(0, end)
  }
}
