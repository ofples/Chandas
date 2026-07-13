package expo.modules.slottimerservice

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import kotlin.math.min

object TimerScheduler {
  private const val TIMER_REQUEST = 8201
  private const val SHOW_REQUEST = 8202

  fun start(context: Context, config: TimerConfig) {
    cancelScheduledEvent(context)
    TimerStateStore.save(context, config)
    TimerStateStore.setRinging(context, false)
    TimerStateStore.setAlarmVisible(context, false)
    TimerNotifications.ensureChannels(context)
    FocusModeController.sync(context, config)
    scheduleNext(context)
  }

  fun update(context: Context, config: TimerConfig) {
    if (TimerStateStore.load(context) == null) return
    TimerStateStore.save(context, config)
    FocusModeController.sync(context, config)
    if (TimerStateStore.isRinging(context)) {
      context.startService(Intent(context, SlotTimerAlarmService::class.java).apply {
        action = SlotTimerAlarmService.ACTION_UPDATE_VOLUME
        putExtra(SlotTimerAlarmService.EXTRA_VOLUME, config.volume)
        putExtra(SlotTimerAlarmService.EXTRA_DURATION_SECONDS, config.alarmDurationSeconds)
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
    context.stopService(Intent(context, SlotTimerAlarmService::class.java))
    AlarmStateRegistry.notify(false)
  }

  fun restore(context: Context, resetRinging: Boolean) {
    val config = TimerStateStore.load(context) ?: return
    if (resetRinging) {
      TimerStateStore.setRinging(context, false)
      TimerStateStore.setAlarmVisible(context, false)
      AlarmStateRegistry.notify(false)
    }
    cancelScheduledEvent(context)
    TimerNotifications.ensureChannels(context)
    FocusModeController.sync(context, config)
    scheduleNext(context, config)
  }

  fun scheduleNext(context: Context, config: TimerConfig? = TimerStateStore.load(context)) {
    val active = config ?: return

    val now = System.currentTimeMillis()
    val nextMain = TimerMath.nextTick(now, active.mainMs, active.phase)
    val nextSub = if (active.subEnabled && active.subMs > 0L) {
      TimerMath.nextSubTick(now, active.mainMs, active.subMs, active.phase)
    } else {
      Long.MAX_VALUE
    }
    var triggerAt = min(nextMain, nextSub)
    var type = if (triggerAt == nextMain) TimerEventType.MAIN else TimerEventType.SUB
    if (!ActiveHours.isActive(active, now) || !ActiveHours.isActive(active, triggerAt)) {
      triggerAt = ActiveHours.nextStart(active, now)
      type = TimerEventType.ACTIVE_START
    }

    val operation = PendingIntent.getBroadcast(
      context,
      TIMER_REQUEST,
      Intent(context, TimerEventReceiver::class.java).apply {
        action = TimerEventReceiver.ACTION_FIRE
        putExtra(TimerEventReceiver.EXTRA_TRIGGER_AT, triggerAt)
        putExtra(TimerEventReceiver.EXTRA_EVENT_TYPE, type.value)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val showIntent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    val showPendingIntent = PendingIntent.getActivity(
      context,
      SHOW_REQUEST,
      showIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    TimerStateStore.setNext(context, triggerAt, type)
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()) {
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPendingIntent), operation)
      } else {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
      }
    } catch (_: SecurityException) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
    }
    TimerNotifications.postRunning(context, active)
  }

  fun handleTriggered(
    context: Context,
    triggerAt: Long,
    type: TimerEventType,
    onFinished: () -> Unit,
  ) {
    val config = TimerStateStore.load(context)
    if (config == null || !TimerStateStore.matchesNext(context, triggerAt, type)) {
      onFinished()
      return
    }

    TimerStateStore.clearNext(context)
    if (type == TimerEventType.ACTIVE_START) {
      FocusModeController.sync(context, config)
      scheduleNext(context, config)
      onFinished()
      return
    }
    val alarmOnce = type == TimerEventType.MAIN && TimerStateStore.consumeAlarmOnce(context)
    val temporarilyMuted = TimerStateStore.consumeMuteForEvent(context, type, System.currentTimeMillis())
    val muted = config.volume <= 0f || temporarilyMuted

    TimerNotifications.postEvent(context, config, type)
    if (muted) {
      scheduleNext(context, config)
      onFinished()
      return
    }

    if (type == TimerEventType.MAIN && (config.alarmModeEnabled || alarmOnce)) {
      scheduleNext(context, config)
      TimerStateStore.setRinging(context, true)
      TimerStateStore.setAlarmVisible(context, true)
      AlarmStateRegistry.notify(true)
      TimerNotifications.cancelRunning(context)
      ContextCompat.startForegroundService(
        context,
        Intent(context, SlotTimerAlarmService::class.java).setAction(SlotTimerAlarmService.ACTION_START),
      )
      onFinished()
      return
    }

    scheduleNext(context, config)
    val sound = if (type == TimerEventType.MAIN) R.raw.gong else R.raw.bell
    TimerSoundPlayer.play(
      context,
      sound,
      config.volume,
      FocusModeController.shouldUseAlarmAudio(context, config),
      onFinished,
    )
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
