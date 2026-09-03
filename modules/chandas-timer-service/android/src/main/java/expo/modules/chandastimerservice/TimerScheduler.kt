package expo.modules.chandastimerservice

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import kotlin.math.min

object TimerScheduler {
  private const val TIMER_REQUEST = 8201

  fun canScheduleExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return manager.canScheduleExactAlarms()
  }

  fun start(context: Context, config: TimerConfig): Boolean {
    if (!canScheduleExactAlarms(context)) return false
    if (config.timerV2Program != null && !TimerV2Timeline.isValid(config.timerV2Program)) return false
    cancelScheduledEvent(context)
    TimerStateStore.save(context, config)
    TimerStateStore.beginSession(context)
    TimerStateStore.setRinging(context, false)
    TimerStateStore.setAlarmVisible(context, false)
    TimerNotifications.ensureChannels(context)
    FocusModeController.reconcile(context, config)
    val scheduled = scheduleNext(context)
    if (!scheduled) {
      FocusModeController.deactivate(context)
      TimerStateStore.clear(context)
      TimerNotifications.cancelRunning(context)
    }
    return scheduled
  }

  fun update(context: Context, config: TimerConfig) {
    if (TimerStateStore.load(context) == null) return
    TimerStateStore.save(context, config)
    FocusModeController.reconcile(context, config)
    if (TimerStateStore.isRinging(context)) {
      context.startService(Intent(context, ChandasAlarmService::class.java).apply {
        action = ChandasAlarmService.ACTION_UPDATE_VOLUME
        putExtra(ChandasAlarmService.EXTRA_VOLUME, config.volume)
        putExtra(ChandasAlarmService.EXTRA_DURATION_SECONDS, config.alarmDurationSeconds)
      })
    }
    cancelScheduledEvent(context)
    scheduleNext(context)
  }

  fun stop(context: Context) {
    cancelScheduledEvent(context)
    FocusModeController.deactivate(context)
    TimerStateStore.clear(context)
    TimerNotifications.cancelRunning(context)
    TimerNotifications.cancelAlarm(context)
    context.stopService(Intent(context, ChandasAlarmService::class.java))
    AlarmStateRegistry.notify(false)
  }

  fun restore(context: Context, resetRinging: Boolean) {
    val stored = TimerStateStore.load(context) ?: return
    if (stored.timerV2Program != null && !TimerV2Timeline.isValid(stored.timerV2Program)) {
      stop(context)
      return
    }
    val config = stored.timerV2Program?.let { program ->
      TimerV2Timeline.alignedAnchor(program, System.currentTimeMillis())?.let { anchor -> stored.copy(timerV2Anchor = anchor) } ?: stored
    } ?: stored
    if (config !== stored) TimerStateStore.save(context, config)
    if (resetRinging) {
      TimerStateStore.setRinging(context, false)
      TimerStateStore.setAlarmVisible(context, false)
      AlarmStateRegistry.notify(false)
    }
    cancelScheduledEvent(context)
    TimerNotifications.ensureChannels(context)
    FocusModeController.reconcile(context, config)
    scheduleNext(context, config)
  }

  fun scheduleNext(context: Context, config: TimerConfig? = TimerStateStore.load(context)): Boolean {
    val active = config ?: return false
    if (active.timerV2Program != null && !TimerV2Timeline.isValid(active.timerV2Program)) return false
    if (!canScheduleExactAlarms(context)) {
      TimerStateStore.clearNext(context)
      return false
    }

    val now = System.currentTimeMillis()
    val v2Event = active.timerV2Program?.let { TimerV2Timeline.next(it, active.timerV2Anchor, now) }
    val nextMain = TimerMath.nextTick(now, active.mainMs, active.phase)
    val nextSub = if (active.subEnabled && active.subMs > 0L) TimerMath.nextSubTick(now, active.mainMs, active.subMs, active.phase) else Long.MAX_VALUE
    var triggerAt = v2Event?.at ?: min(nextMain, nextSub)
    var type = if (v2Event != null) TimerEventType.V2 else if (triggerAt == nextMain) TimerEventType.MAIN else TimerEventType.SUB
    var logicalId = v2Event?.logicalId ?: "legacy:${type.value}:$triggerAt"
    if (!ActiveHours.isActive(active, now) || !ActiveHours.isActive(active, triggerAt)) {
      triggerAt = ActiveHours.nextStart(active, now)
      type = TimerEventType.ACTIVE_START
      logicalId = "active-start:$triggerAt"
    }
    val generation = TimerStateStore.ensureSessionGeneration(context)

    val operation = PendingIntent.getBroadcast(
      context,
      TIMER_REQUEST,
      Intent(context, TimerEventReceiver::class.java).apply {
        action = TimerEventReceiver.ACTION_FIRE
        putExtra(TimerEventReceiver.EXTRA_TRIGGER_AT, triggerAt)
        putExtra(TimerEventReceiver.EXTRA_EVENT_TYPE, type.value)
        putExtra(TimerEventReceiver.EXTRA_LOGICAL_ID, logicalId)
        putExtra(TimerEventReceiver.EXTRA_GENERATION, generation)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    TimerStateStore.setNext(context, triggerAt, type, logicalId, generation)
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
      } else {
        @Suppress("DEPRECATION")
        alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, operation)
      }
    } catch (_: SecurityException) {
      TimerStateStore.clearNext(context)
      return false
    }
    TimerNotifications.postRunning(context, active)
    return true
  }

  fun handleTriggered(
    context: Context,
    triggerAt: Long,
    type: TimerEventType,
    logicalId: String,
    generation: String,
    onFinished: () -> Unit,
  ) {
    val config = TimerStateStore.load(context)
    if (config == null || !TimerStateStore.matchesNext(context, triggerAt, type, logicalId, generation)) {
      onFinished()
      return
    }

    TimerStateStore.clearNext(context)
    if (type == TimerEventType.ACTIVE_START) {
      FocusModeController.reconcile(context, config)
      scheduleNext(context, config)
      onFinished()
      return
    }
    if (type == TimerEventType.V2) {
      handleV2Triggered(context, config, triggerAt, onFinished)
      return
    }
    if (CallState.isActive(context)) {
      scheduleNext(context, config)
      onFinished()
      return
    }
    val temporarilyMuted = TimerStateStore.consumeMuteForEvent(context, type, System.currentTimeMillis())
    val muted = config.volume <= 0f || temporarilyMuted

    TimerNotifications.postEvent(context, config, type)
    if (muted) {
      scheduleNext(context, config)
      onFinished()
      return
    }

    val alarmOnce = type == TimerEventType.MAIN && TimerStateStore.consumeAlarmOnce(context)

    if (type == TimerEventType.MAIN && (config.alarmModeEnabled || alarmOnce)) {
      scheduleNext(context, config)
      TimerStateStore.setRinging(context, true)
      TimerStateStore.setAlarmVisible(context, true)
      AlarmStateRegistry.notify(true)
      TimerNotifications.cancelRunning(context)
      ContextCompat.startForegroundService(
        context,
        Intent(context, ChandasAlarmService::class.java).setAction(ChandasAlarmService.ACTION_START),
      )
      onFinished()
      return
    }

    scheduleNext(context, config)
    val sound = if (type == TimerEventType.MAIN) R.raw.gong else R.raw.bell
    TimerSoundPlayer.play(
      context,
      if (type == TimerEventType.MAIN) "temple-gong" else "clear-bell",
      sound,
      config.volume,
      onFinished,
    )
  }

  private fun handleV2Triggered(context: Context, config: TimerConfig, triggerAt: Long, onFinished: () -> Unit) {
    val event = config.timerV2Program?.let { TimerV2Timeline.next(it, config.timerV2Anchor, triggerAt - 1L) }
    if (event == null || event.at != triggerAt) {
      scheduleNext(context, config)
      onFinished()
      return
    }
    val now = System.currentTimeMillis()
    // Phone calls are an external, transient mute gate. They do not consume
    // one-shot alarm or timed/cycle mute state, and no missed cue is replayed.
    if (CallState.isActive(context)) {
      scheduleNext(context, config)
      emitV2Event(event, suppressed = true, reason = "call-active")
      onFinished()
      return
    }
    val temporarilyMuted = TimerStateStore.consumeMuteForEvent(context, TimerEventType.V2, now, event.logicalId)
    val muted = config.volume <= 0f || temporarilyMuted
    TimerNotifications.postEvent(context, config, TimerEventType.V2)
    if (muted) {
      scheduleNext(context, config)
      emitV2Event(event, suppressed = true, reason = if (config.volume <= 0f) "master-muted" else "user-mute")
      onFinished()
      return
    }
    val isPatternMain = event.boundary == TimerV2Boundary.PATTERN_MAIN
    val alarmOnce = isPatternMain && TimerStateStore.consumeAlarmOnce(context)
    if (isPatternMain && (config.alarmModeEnabled || alarmOnce)) {
      scheduleNext(context, config)
      TimerStateStore.setRinging(context, true)
      TimerStateStore.setAlarmVisible(context, true)
      AlarmStateRegistry.notify(true)
      TimerNotifications.cancelRunning(context)
      emitV2Event(event, suppressed = false, reason = "none")
      ContextCompat.startForegroundService(context, Intent(context, ChandasAlarmService::class.java).apply {
        action = ChandasAlarmService.ACTION_START
        putExtra(ChandasAlarmService.EXTRA_SOUND_ID, event.winner.soundId)
        putExtra(ChandasAlarmService.EXTRA_CUE_VOLUME, event.winner.volume)
      })
      onFinished()
      return
    }
    scheduleNext(context, config)
    emitV2Event(event, suppressed = false, reason = "none")
    TimerSoundPlayer.play(
      context,
      event.winner.soundId,
      resourceForV2Sound(event.winner.soundId),
      (config.volume * event.winner.volume).coerceIn(0f, 1f),
      onFinished,
      event.winner.soundId.takeIf { it.contains("://") },
    )
  }

  private fun emitV2Event(event: TimerV2Event, suppressed: Boolean, reason: String) {
    TimerEventRegistry.notify(
      TimerEventSignal(
        at = event.at,
        logicalId = event.logicalId,
        boundary = event.boundary.value,
        winnerCueId = event.winner.cueId,
        collision = event.candidates.size > 1,
        suppressed = suppressed,
        suppressionReason = reason,
      ),
    )
  }

  private fun resourceForV2Sound(soundId: String): Int = when (soundId) {
    "temple-gong" -> R.raw.gong
    else -> R.raw.bell
  }

  fun cancelScheduledEvent(context: Context) {
    val operation = PendingIntent.getBroadcast(
      context,
      TIMER_REQUEST,
      Intent(context, TimerEventReceiver::class.java).setAction(TimerEventReceiver.ACTION_FIRE),
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
    )
    if (operation != null) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.cancel(operation)
      operation.cancel()
    }
    TimerStateStore.clearNext(context)
  }
}
