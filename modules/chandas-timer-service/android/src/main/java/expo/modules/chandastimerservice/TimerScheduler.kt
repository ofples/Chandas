package expo.modules.chandastimerservice

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import kotlin.math.min

object TimerScheduler {
  private const val TIMER_REQUEST = 8201
  private const val MAX_NATIVE_INTERVAL_MS = NativeTimerContract.MAX_PROGRAM_CYCLE_MS

  fun canScheduleExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return manager.canScheduleExactAlarms()
  }

  /** Serializes each persisted-state/alarm transaction across JS, receivers, and services. */
  @Synchronized
  fun start(
    context: Context,
    config: TimerConfig,
    initialControls: TimerControlState = TimerControlState(false, 0L, 0, null, 0L),
  ): Boolean {
    if (!canScheduleExactAlarms(context)) return false
    if (!isValidConfig(config)) return false
    ChandasCueService.stop(context)
    TimerSoundPlayer.stopAll()
    TimerHaptics.stop(context)
    cancelScheduledEvent(context)
    TimerStateStore.save(context, config)
    TimerStateStore.beginSession(context)
    TimerStateStore.restoreControls(
      context,
      initialControls.alarmOnceArmed,
      initialControls.mutedUntil,
      initialControls.mutedIterationEndId,
      initialControls.mutedIterationEndAt,
      initialControls.mutedIterationsRemaining.coerceAtLeast(1),
    )
    TimerStateStore.setRinging(context, false)
    TimerStateStore.setAlarmVisible(context, false)
    TimerNotifications.ensureChannels(context)
    FocusModeController.reconcile(context, config)
    val scheduled = scheduleNext(context)
    if (!scheduled) {
      TimerStateStore.clear(context)
      FocusModeController.deactivate(context)
      TimerNotifications.cancelRunning(context)
    }
    return scheduled
  }

  @Synchronized
  fun update(context: Context, config: TimerConfig) {
    if (TimerStateStore.load(context) == null) return
    // Never replace a valid persisted schedule with a malformed program. The
    // JavaScript editor validates too, but the native service is the runtime
    // authority and must defend its own recovery state.
    if (!isValidConfig(config)) return
    TimerStateStore.save(context, config)
    FocusModeController.reconcile(context, config)
    if (TimerStateStore.isRinging(context)) {
      context.startService(Intent(context, ChandasAlarmService::class.java).apply {
        action = ChandasAlarmService.ACTION_UPDATE_VOLUME
      })
    }
    cancelScheduledEvent(context)
    scheduleNext(context)
  }

  @Synchronized
  fun stop(context: Context) {
    cancelScheduledEvent(context)
    ChandasCueService.stop(context)
    TimerSoundPlayer.stopAll()
    TimerHaptics.stop(context)
    TimerStateStore.clear(context)
    FocusModeController.deactivate(context)
    TimerNotifications.cancelRunning(context)
    TimerNotifications.cancelAlarm(context)
    context.stopService(Intent(context, ChandasAlarmService::class.java))
    AlarmStateRegistry.notify(false)
    TimerStateRegistry.notify(TimerScheduleState(false, 0L, 0L, null, canScheduleExactAlarms(context)))
  }

  @Synchronized
  fun restore(context: Context, resetRinging: Boolean, wallClockChanged: Boolean = false) {
    var stored = TimerStateStore.load(context) ?: return
    if (!isValidConfig(stored)) {
      stop(context)
      return
    }
    if (wallClockChanged) {
      val delta = TimerStateStore.wallClockDelta(context)
      if (delta != 0L) {
        val elapsedProgram = stored.timerV2Program?.let(TimerV2Timeline::isLocalClock) != true
        stored = stored.copy(
          phase = if (elapsedProgram) stored.phase + delta else stored.phase,
          timerV2Anchor = if (elapsedProgram) stored.timerV2Anchor + delta else stored.timerV2Anchor,
          timerV2StartedAt = stored.timerV2StartedAt + delta,
          timerV2EndsAt = if (stored.timerV2EndsAt > 0L) stored.timerV2EndsAt + delta else 0L,
        )
        TimerStateStore.save(context, stored)
      }
    }
    if (resetRinging) {
      TimerStateStore.setRinging(context, false)
      TimerStateStore.setAlarmVisible(context, false)
      AlarmStateRegistry.notify(false)
    }
    cancelScheduledEvent(context)
    TimerNotifications.ensureChannels(context)
    FocusModeController.reconcile(context, stored)
    scheduleNext(context, stored)
  }

  @Synchronized
  fun scheduleNext(context: Context, config: TimerConfig? = TimerStateStore.load(context)): Boolean {
    val initial = config ?: return false
    if (!isValidConfig(initial)) return false
    if (!canScheduleExactAlarms(context)) {
      stopForExactAccess(context)
      return false
    }

    val now = System.currentTimeMillis()
    val active = reconcileLocalClock(context, initial, now).config
    var v2Event = active.timerV2Program?.let { TimerV2Timeline.next(it, active.timerV2Anchor, now, active.timerV2StartedAt, active.timerV2EndsAt) }
    if (active.timerV2Program != null && v2Event == null) {
      completeSession(context)
      return false
    }
    val nextMain = TimerMath.nextTick(now, active.mainMs, active.phase)
    val nextSub = if (active.subEnabled && active.subMs > 0L) TimerMath.nextSubTick(now, active.mainMs, active.subMs, active.phase) else Long.MAX_VALUE
    val initialTriggerAt = v2Event?.at ?: min(nextMain, nextSub)
    val activeNow = ActiveHours.isActive(active, now)
    val waitsForAvailability = v2Event?.completesRun != true &&
      (!activeNow || !ActiveHours.allowsCue(active, initialTriggerAt))
    // If the current window is active but closes before the next cue, search
    // from that skipped cue. Searching from now would return now and spin.
    val resumesAt = if (waitsForAvailability) ActiveHours.nextStart(active, if (activeNow) initialTriggerAt else now) else 0L
    if (v2Event?.completesRun != true && active.timerV2EndsAt > 0L && resumesAt >= active.timerV2EndsAt) {
      // Weekly/calendar availability gates sound, never the terminal clock.
      // Replace a skipped intermediate cue with the exact final event.
      v2Event = active.timerV2Program?.let {
        TimerV2Timeline.next(it, active.timerV2Anchor, active.timerV2EndsAt - 1L, active.timerV2StartedAt, active.timerV2EndsAt)
      } ?: v2Event
    }
    var triggerAt = v2Event?.at ?: initialTriggerAt
    var type = if (v2Event != null) TimerEventType.V2 else if (triggerAt == nextMain) TimerEventType.MAIN else TimerEventType.SUB
    var logicalId = v2Event?.logicalId ?: "legacy:${type.value}:$triggerAt"
    if (v2Event?.completesRun != true && (!ActiveHours.isActive(active, now) || !ActiveHours.allowsCue(active, triggerAt))) {
      triggerAt = resumesAt
      type = TimerEventType.ACTIVE_START
      logicalId = "active-start:$triggerAt"
    }
    val transition = active.timerV2Program
      ?.takeIf(TimerV2Timeline::isLocalClock)
      ?.let {
        val midnight = TimerV2Timeline.nextLocalDateBoundary(now)
        TimerV2Timeline.nextTimezoneTransition(now, midnight)?.let { minOf(it, midnight) } ?: midnight
      }
    if (transition != null && transition > now && transition < triggerAt) {
      triggerAt = transition
      type = TimerEventType.REALIGN
      logicalId = "realign:$transition"
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
    if (!runCatching { TimerStateStore.setNext(context, triggerAt, type, logicalId, generation) }.getOrDefault(false)) {
      stop(context)
      return false
    }
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      val showIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launchIntent ->
        PendingIntent.getActivity(
          context,
          8202,
          launchIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }
      if (type in setOf(TimerEventType.V2, TimerEventType.MAIN, TimerEventType.SUB) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && showIntent != null) {
        // Interval cues are explicitly user-scheduled alarms. Alarm-clock alarms
        // are not batched or rate-limited in Doze, which preserves a main gong
        // even when it follows a closely spaced sub-bell while the screen is off.
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showIntent), operation)
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
      } else {
        @Suppress("DEPRECATION")
        alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, operation)
      }
    } catch (_: RuntimeException) {
      // Permission revocation, OS alarm limits, and persistence/platform
      // failures must never leave an apparently active timer without an alarm.
      stop(context)
      return false
    }
    TimerNotifications.postRunning(context, active)
    TimerStateRegistry.notify(TimerScheduleState(true, active.timerV2Anchor, triggerAt, logicalId, true))
    return true
  }

  @Synchronized
  fun handleTriggered(
    context: Context,
    triggerAt: Long,
    type: TimerEventType,
    logicalId: String,
    generation: String,
    onFinished: () -> Unit,
  ) {
    val stored = TimerStateStore.load(context)
    if (stored == null || !TimerStateStore.matchesNext(context, triggerAt, type, logicalId, generation)) {
      onFinished()
      return
    }

    TimerStateStore.clearNext(context)
    val realignment = reconcileLocalClock(context, stored, System.currentTimeMillis())
    if (type == TimerEventType.REALIGN) {
      scheduleNext(context, realignment.config)
      onFinished()
      return
    }
    val config = realignment.config
    val now = System.currentTimeMillis()
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
    if (!ActiveHours.allowsCueDelivery(config, triggerAt, now)) {
      scheduleNext(context, config)
      onFinished()
      return
    }
    val controls = TimerStateStore.getControlState(context, now)
    val continuousAlarmRequested = type == TimerEventType.MAIN &&
      (config.alarmModeEnabled || controls.alarmOnceArmed)
    // A user-armed continuous alarm still follows Android alarm/audio-focus
    // policy; it is not downgraded into an ordinary call-muted chime.
    if (config.muteDuringCallsEnabled && CallState.isActive(context) && !continuousAlarmRequested) {
      scheduleNext(context, config)
      onFinished()
      return
    }
    val temporarilyMuted = TimerStateStore.consumeMuteForEvent(context, type, now)
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
      launchAlarmOrFallback(context, config, type, onFinished)
      return
    }

    TimerHaptics.cue(context, config.haptics, primary = type == TimerEventType.MAIN)
    scheduleNext(context, config)
    val sound = if (type == TimerEventType.MAIN) R.raw.gong else R.raw.bell
    playCue(
      context,
      config,
      type,
      if (type == TimerEventType.MAIN) "temple-gong" else "clear-bell",
      sound,
      config.volume,
      onFinished,
    )
  }

  private fun handleV2Triggered(context: Context, config: TimerConfig, triggerAt: Long, onFinished: () -> Unit) {
    val event = config.timerV2Program?.let { TimerV2Timeline.next(it, config.timerV2Anchor, triggerAt - 1L, config.timerV2StartedAt, config.timerV2EndsAt) }
    if (event == null || event.at != triggerAt) {
      scheduleNext(context, config)
      onFinished()
      return
    }
    val now = System.currentTimeMillis()
    val isPatternMain = event.boundary == TimerV2Boundary.PATTERN_MAIN
    if (!ActiveHours.allowsCueDelivery(config, event.at, now)) {
      if (event.completesRun) completeSession(context) else scheduleNext(context, config)
      emitV2Event(event, suppressed = true, reason = "outside-active-hours")
      onFinished()
      return
    }
    val controls = TimerStateStore.getControlState(context, now)
    val continuousAlarmRequested = isPatternMain && !event.completesRun &&
      (config.alarmModeEnabled || controls.alarmOnceArmed)
    // Phone calls are an external, transient mute gate. They do not consume
    // one-shot alarm or timed/cycle mute state, and no missed cue is replayed.
    if (config.muteDuringCallsEnabled && CallState.isActive(context) && !continuousAlarmRequested) {
      if (event.completesRun) completeSession(context) else scheduleNext(context, config)
      emitV2Event(event, suppressed = true, reason = "call-active")
      onFinished()
      return
    }
    val temporarilyMuted = TimerStateStore.consumeMuteForEvent(context, TimerEventType.V2, now, event.logicalId)
    val muted = config.volume <= 0f || temporarilyMuted
    TimerNotifications.postEvent(context, config, TimerEventType.V2)
    if (muted) {
      if (event.completesRun) completeSession(context) else scheduleNext(context, config)
      emitV2Event(event, suppressed = true, reason = if (config.volume <= 0f) "master-muted" else "user-mute")
      onFinished()
      return
    }
    val alarmOnce = isPatternMain && !event.completesRun && TimerStateStore.consumeAlarmOnce(context)
    if (isPatternMain && !event.completesRun && (config.alarmModeEnabled || alarmOnce)) {
      scheduleNext(context, config)
      emitV2Event(event, suppressed = false, reason = "none")
      launchAlarmOrFallback(context, config, TimerEventType.V2, onFinished)
      return
    }
    TimerHaptics.cue(context, config.haptics, primary = event.boundary != TimerV2Boundary.PATTERN_OFFSET)
    if (event.completesRun) completeSession(context) else scheduleNext(context, config)
    emitV2Event(event, suppressed = false, reason = "none")
    playCue(
      context,
      config,
      TimerEventType.V2,
      event.winner.soundId,
      resourceForV2Sound(event.winner.soundId),
      (config.volume * event.winner.volume).coerceIn(0f, 1f),
      onFinished,
    )
  }

  private fun playCue(
    context: Context,
    config: TimerConfig,
    type: TimerEventType,
    soundId: String,
    fallbackResId: Int,
    volume: Float,
    onReceiverFinished: () -> Unit,
  ) {
    val handedOff = ChandasCueService.play(
      context,
      soundId,
      fallbackResId,
      volume,
      type,
      config.notificationPresentation,
    )
    if (handedOff) onReceiverFinished()
    else TimerSoundPlayer.play(context, soundId, fallbackResId, volume, onReceiverFinished)
  }

  private fun launchAlarmOrFallback(
    context: Context,
    config: TimerConfig,
    type: TimerEventType,
    onReceiverFinished: () -> Unit,
  ) {
    TimerStateStore.setRinging(context, true)
    TimerStateStore.setAlarmVisible(context, true)
    AlarmStateRegistry.notify(true)
    TimerNotifications.cancelRunning(context)
    if (ChandasAlarmService.start(context, config)) {
      onReceiverFinished()
      return
    }

    // Never leave an alarm overlay/state behind when Android rejects the
    // foreground launch. Restore the running surface and preserve one audible
    // alarm cue through the ordinary cue service.
    TimerStateStore.setRinging(context, false)
    TimerStateStore.setAlarmVisible(context, false)
    AlarmStateRegistry.notify(false)
    TimerNotifications.postRunning(context, config)
    TimerHaptics.cue(context, config.haptics, primary = true)
    playCue(
      context,
      config,
      type,
      config.alarmSoundId,
      R.raw.alarm,
      (config.volume * config.alarmVolume).coerceIn(0f, 1f),
      onReceiverFinished,
    )
  }

  private fun emitV2Event(event: TimerV2Event, suppressed: Boolean, reason: String) {
    TimerEventRegistry.notify(
      TimerEventSignal(
        at = event.at,
        firedAt = System.currentTimeMillis(),
        logicalId = event.logicalId,
        boundary = event.boundary.value,
        winnerCueId = event.winner.cueId,
        collision = event.candidates.size > 1,
        suppressed = suppressed,
        suppressionReason = reason,
        completesRun = event.completesRun,
      ),
    )
  }

  private data class LocalClockResult(val config: TimerConfig, val changed: Boolean)

  /**
   * A stored anchor may be many complete cycles behind and still represent the
   * same local lattice. Only a non-integral phase difference is a real timezone,
   * DST, date-boundary, or clock-offset change.
   */
  private fun reconcileLocalClock(context: Context, config: TimerConfig, now: Long): LocalClockResult {
    val program = config.timerV2Program ?: return LocalClockResult(config, false)
    if (!TimerV2Timeline.isLocalClock(program)) return LocalClockResult(config, false)
    val aligned = TimerV2Timeline.alignedAnchor(program, now) ?: return LocalClockResult(config, false)
    val duration = TimerV2Timeline.cycleDuration(program) ?: return LocalClockResult(config, false)
    if (Math.floorMod(aligned - config.timerV2Anchor, duration) == 0L) return LocalClockResult(config, false)

    val controls = TimerStateStore.getControlState(context, now)
    val next = config.copy(timerV2Anchor = aligned)
    TimerStateStore.save(context, next)
    if (controls.mutedIterationEndId != null && controls.mutedIterationEndAt > 0L) {
      // Realignment gives cycle boundaries new logical identities. Clear only
      // cycle mute; timestamp mute and Alarm Once remain meaningful.
      TimerStateStore.restoreControls(context, controls.alarmOnceArmed, controls.mutedUntil, null, 0L, 1)
    }
    return LocalClockResult(next, true)
  }

  private fun resourceForV2Sound(soundId: String): Int = TimerSoundPlayer.builtInResource(soundId) ?: R.raw.bell

  private fun isValidConfig(config: TimerConfig): Boolean {
    if (config.mainMs !in 1L..MAX_NATIVE_INTERVAL_MS || config.subMs !in 1L..MAX_NATIVE_INTERVAL_MS) return false
    if (!config.volume.isFinite() || config.volume !in 0f..1f) return false
    if (!config.alarmVolume.isFinite() || config.alarmVolume !in 0f..1f) return false
    if (!TimerSoundSource.isRuntimeSoundId(config.alarmSoundId)) return false
    if (!ActiveHours.isValid(config) || !ActiveHours.hasPotentialAvailability(config)) return false
    val program = config.timerV2Program ?: return true
    if (!TimerV2Timeline.isValid(program)) return false
    val duration = TimerV2Timeline.cycleDuration(program) ?: return false
    if (duration > NativeTimerContract.MAX_PROGRAM_CYCLE_MS || config.mainMs != duration) return false
    if (config.timerV2Anchor !in 1L..(Long.MAX_VALUE - duration)) return false
    if (config.timerV2StartedAt <= 0L) return false
    if (config.timerV2EndsAt > 0L && config.timerV2EndsAt <= config.timerV2StartedAt) return false
    if (!TimerV2Timeline.hasMatchingRunEnd(program, config.timerV2Anchor, config.timerV2StartedAt, config.timerV2EndsAt)) return false
    return true
  }

  /** Durably ends a bounded session before its final one-shot begins. */
  private fun completeSession(context: Context) {
    cancelScheduledEvent(context)
    ChandasCueService.stop(context)
    TimerSoundPlayer.stopAll()
    TimerStateStore.clear(context)
    FocusModeController.deactivate(context)
    TimerNotifications.cancelRunning(context)
    TimerNotifications.cancelAlarm(context)
    context.stopService(Intent(context, ChandasAlarmService::class.java))
    AlarmStateRegistry.notify(false)
    TimerStateRegistry.notify(TimerScheduleState(false, 0L, 0L, null, canScheduleExactAlarms(context)))
  }

  private fun stopForExactAccess(context: Context) {
    // A persisted `active` state without an exact PendingIntent is a limbo
    // timer: the UI can reconnect to it after process death even though it can
    // never ring. Exact-alarm access is a hard runtime requirement, so fail
    // closed and make the inactive state authoritative everywhere.
    cancelScheduledEvent(context)
    ChandasCueService.stop(context)
    TimerSoundPlayer.stopAll()
    TimerHaptics.stop(context)
    TimerStateStore.clear(context)
    FocusModeController.deactivate(context)
    TimerNotifications.cancelRunning(context)
    TimerNotifications.cancelAlarm(context)
    context.stopService(Intent(context, ChandasAlarmService::class.java))
    AlarmStateRegistry.notify(false)
    TimerStateRegistry.notify(TimerScheduleState(false, 0L, 0L, null, false))
  }

  @Synchronized
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
