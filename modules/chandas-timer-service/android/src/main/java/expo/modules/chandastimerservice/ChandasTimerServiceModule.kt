package expo.modules.chandastimerservice

import android.app.AlarmManager
import android.app.Activity
import android.media.RingtoneManager
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.provider.OpenableColumns
import androidx.core.os.bundleOf
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class TimerConfigRecord : Record {
  @Field var mainMs: Long? = null
  @Field var subMs: Long? = null
  @Field var phase: Long? = null
  @Field var subEnabled: Boolean? = null
  @Field var volume: Float? = null
  @Field var notificationsEnabled: Boolean? = null
  @Field var focusModeEnabled: Boolean? = null
  @Field var alarmModeEnabled: Boolean? = null
  @Field var activeHoursEnabled: Boolean? = null
  @Field var activeHoursStart: Int? = null
  @Field var activeHoursEnd: Int? = null
  @Field var activeHoursDays: Int? = null
  @Field var alarmDurationSeconds: Int? = null
  @Field var timerV2Program: String? = null
  @Field var timerV2Anchor: Long? = null
  @Field var alarmOnceArmed: Boolean? = null
  @Field var mutedUntil: Long? = null
  @Field var mutedIterationEndId: String? = null
  @Field var mutedIterationEndAt: Long? = null
  @Field var mutedIterationCount: Int? = null
}

class ChandasTimerServiceModule : Module() {
  private var soundPickerPromise: Promise? = null
  private val ringingListener: (Boolean) -> Unit = { ringing ->
    sendEvent("onAlarmStateChanged", bundleOf("ringing" to ringing))
  }
  private val controlListener: (TimerControlState) -> Unit = { state ->
    sendEvent("onControlStateChanged", controlBundle(state))
  }
  private val timerEventListener: (TimerEventSignal) -> Unit = { event ->
    sendEvent("onTimerEventFired", bundleOf(
      "at" to event.at,
      "logicalId" to event.logicalId,
      "boundary" to event.boundary,
      "winnerCueId" to event.winnerCueId,
      "collision" to event.collision,
      "suppressed" to event.suppressed,
      "suppressionReason" to event.suppressionReason,
    ))
  }
  private val focusListener: (NativeFocusState) -> Unit = { state ->
    sendEvent("onFocusStateChanged", focusBundle(state))
  }
  private val stateListener: (TimerScheduleState) -> Unit = { state ->
    sendEvent("onTimerStateChanged", bundleOf(
      "active" to state.active,
      "timerV2Anchor" to state.timerV2Anchor,
      "nextEventAt" to state.nextEventAt,
      "nextLogicalId" to state.nextLogicalId,
      "exactTimingAvailable" to state.exactTimingAvailable,
    ))
  }

  override fun definition() = ModuleDefinition {
    Name("ChandasTimerService")
    Events("onAlarmStateChanged", "onControlStateChanged", "onTimerEventFired", "onFocusStateChanged", "onTimerStateChanged")

    Function("start") { record: TimerConfigRecord ->
      val context = appContext.reactContext ?: return@Function false
      val config = merge(record, null) ?: return@Function false
      val started = TimerScheduler.start(context, config)
      if (started) {
        TimerStateStore.restoreControls(
          context,
          record.alarmOnceArmed == true,
          record.mutedUntil ?: 0L,
          record.mutedIterationEndId,
          record.mutedIterationEndAt ?: 0L,
          record.mutedIterationCount ?: 1,
        )
      }
      started
    }

    Function("update") { record: TimerConfigRecord ->
      val context = appContext.reactContext ?: return@Function
      val previous = TimerStateStore.load(context) ?: return@Function
      val config = merge(record, previous) ?: return@Function
      TimerScheduler.update(context, config)
    }

    Function("stop") {
      val context = appContext.reactContext
      if (context != null) TimerScheduler.stop(context)
      appContext.activityProvider?.currentActivity?.let(AlarmWindowHelper::clearAlarmWindowFlags)
    }

    Function("stopAlarm") {
      val context = appContext.reactContext
      if (context != null) {
        if (TimerStateStore.isRinging(context)) {
          context.startService(Intent(context, ChandasAlarmService::class.java).apply {
            action = ChandasAlarmService.ACTION_STOP
          })
        } else {
          TimerStateStore.setAlarmVisible(context, false)
          AlarmStateRegistry.notify(false)
        }
      }
      appContext.activityProvider?.currentActivity?.let(AlarmWindowHelper::clearAlarmWindowFlags)
    }

    Function("isRinging") {
      val context = appContext.reactContext
      context != null && TimerStateStore.isAlarmVisible(context)
    }

    Function("getState") {
      val context = appContext.reactContext
      val config = context?.let { TimerStateStore.load(it) }
      if (config == null) {
        bundleOf(
          "active" to false,
          "ringing" to false,
          "alarmOnceArmed" to false,
          "mutedUntil" to 0L,
          "mutedIterationsRemaining" to 0,
        )
      } else {
        if (TimerStateStore.isRinging(context) && TimerStateStore.isAlarmVisible(context)) {
          ChandasAlarmService.ensureRunning(context, config)
        }
        val controls = TimerStateStore.getControlState(context)
        bundleOf(
          "active" to true,
          "ringing" to TimerStateStore.isAlarmVisible(context),
          "mainMs" to config.mainMs,
          "subMs" to config.subMs,
          "phase" to config.phase,
          "subEnabled" to config.subEnabled,
          "volume" to config.volume,
          "notificationsEnabled" to config.notificationsEnabled,
          "focusModeEnabled" to config.focusModeEnabled,
          "alarmModeEnabled" to config.alarmModeEnabled,
          "activeHoursEnabled" to config.activeHoursEnabled,
          "activeHoursStart" to config.activeHoursStart,
          "activeHoursEnd" to config.activeHoursEnd,
          "activeHoursDays" to config.activeHoursDays,
          "alarmDurationSeconds" to config.alarmDurationSeconds,
          "timerV2Program" to config.timerV2Program,
          "timerV2Anchor" to config.timerV2Anchor,
          "alarmOnceArmed" to controls.alarmOnceArmed,
          "mutedUntil" to controls.mutedUntil,
          "mutedIterationsRemaining" to controls.mutedIterationsRemaining,
          "mutedIterationEndId" to controls.mutedIterationEndId,
          "mutedIterationEndAt" to controls.mutedIterationEndAt,
          "nextEventAt" to TimerStateStore.nextAt(context),
          "nextLogicalId" to TimerStateStore.nextLogicalId(context),
          "sessionGeneration" to TimerStateStore.sessionGeneration(context),
        )
      }
    }

    Function("toggleAlarmOnce") {
      val context = appContext.reactContext
      if (context != null && TimerStateStore.load(context) != null) {
        TimerStateStore.toggleAlarmOnce(context)
      }
    }

    Function("muteForIterations") { count: Int ->
      val context = appContext.reactContext ?: return@Function
      if (TimerStateStore.load(context) != null) TimerStateStore.muteForIterations(context, count)
    }

    Function("muteForMinutes") { minutes: Int ->
      val context = appContext.reactContext ?: return@Function
      if (TimerStateStore.load(context) != null) TimerStateStore.muteForMinutes(context, minutes)
    }

    Function("clearMute") {
      val context = appContext.reactContext
      if (context != null) TimerStateStore.clearMute(context)
    }

    AsyncFunction("pickDeviceSound") { kind: String, promise: Promise ->
      val activity = appContext.activityProvider?.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      soundPickerPromise?.resolve(null)
      soundPickerPromise = promise
      val type = when (kind) {
        "alarm" -> RingtoneManager.TYPE_ALARM
        "notification" -> RingtoneManager.TYPE_NOTIFICATION
        else -> RingtoneManager.TYPE_ALL
      }
      activity.startActivityForResult(Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
        putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, type)
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, false)
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
      }, DEVICE_SOUND_PICKER_REQUEST)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pickAudioDocument") { promise: Promise ->
      val activity = appContext.activityProvider?.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      soundPickerPromise?.resolve(null)
      soundPickerPromise = promise
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "audio/*"
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }, AUDIO_DOCUMENT_PICKER_REQUEST)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("previewSound") { soundId: String, fallbackSoundId: String, volume: Float ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val available = TimerSoundPlayer.canOpen(context, soundId)
      val fallback = TimerSoundPlayer.builtInResource(fallbackSoundId) ?: R.raw.bell
      TimerSoundPlayer.preview(context, soundId, fallback, volume.coerceIn(0f, 1f))
      available
    }

    Function("stopSoundPreview") {
      TimerSoundPlayer.stopPreview()
    }

    Function("isSoundAvailable") { soundId: String ->
      val context = appContext.reactContext ?: return@Function false
      TimerSoundPlayer.canOpen(context, soundId)
    }

    Function("canScheduleExactAlarms") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        true
      } else {
        TimerScheduler.canScheduleExactAlarms(context)
      }
    }

    Function("openExactAlarmSettings") {
      val context = appContext.reactContext
      if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        runCatching { context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }) }
      }
    }

    Function("canUseFullScreenIntent") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        true
      } else {
        val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.canUseFullScreenIntent()
      }
    }

    Function("areNotificationsEnabled") {
      val context = appContext.reactContext
      context != null && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    Function("openFullScreenIntentSettings") {
      val context = appContext.reactContext
      if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        runCatching { context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }) }
      }
    }

    Function("openNotificationSettings") {
      val context = appContext.reactContext ?: return@Function
      runCatching { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }) }
    }

    Function("hasNotificationPolicyAccess") {
      val context = appContext.reactContext
      context != null && FocusModeController.hasPolicyAccess(context)
    }

    Function("isFocusModeActive") {
      val context = appContext.reactContext
      context != null && FocusModeController.isActive(context)
    }

    Function("getFocusState") {
      val context = appContext.reactContext
      if (context == null) focusBundle(NativeFocusState(false, false, false, false, "unknown", "unknown"))
      else focusBundle(FocusModeController.query(context))
    }

    Function("openNotificationPolicySettings") {
      val context = appContext.reactContext
      if (context != null) FocusModeController.openPolicySettings(context)
    }

    Function("refreshFocusMode") {
      val context = appContext.reactContext
      if (context != null) FocusModeController.query(context)
    }

    Function("setFocusModeEnabled") { enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function
      FocusModeController.setAutomationFromApp(context, enabled)
    }

    OnStartObserving("onAlarmStateChanged") {
      AlarmStateRegistry.add(ringingListener)
    }

    OnStopObserving("onAlarmStateChanged") {
      AlarmStateRegistry.remove(ringingListener)
    }

    OnStartObserving("onControlStateChanged") {
      TimerControlRegistry.add(controlListener)
    }

    OnStopObserving("onControlStateChanged") {
      TimerControlRegistry.remove(controlListener)
    }

    OnStartObserving("onTimerEventFired") {
      TimerEventRegistry.add(timerEventListener)
    }

    OnStopObserving("onTimerEventFired") {
      TimerEventRegistry.remove(timerEventListener)
    }

    OnStartObserving("onFocusStateChanged") {
      FocusStateRegistry.add(focusListener)
    }

    OnStartObserving("onTimerStateChanged") {
      TimerStateRegistry.add(stateListener)
    }

    OnStopObserving("onTimerStateChanged") {
      TimerStateRegistry.remove(stateListener)
    }

    OnStopObserving("onFocusStateChanged") {
      FocusStateRegistry.remove(focusListener)
    }

    OnActivityResult { _, result ->
      if (result.requestCode != DEVICE_SOUND_PICKER_REQUEST && result.requestCode != AUDIO_DOCUMENT_PICKER_REQUEST) return@OnActivityResult
      val promise = soundPickerPromise ?: return@OnActivityResult
      soundPickerPromise = null
      if (result.resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return@OnActivityResult
      }
      if (result.requestCode == DEVICE_SOUND_PICKER_REQUEST) {
        val uri = result.data?.getParcelableExtra<android.net.Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        if (uri == null) {
          promise.resolve(null)
          return@OnActivityResult
        }
        val context = appContext.reactContext
        val title = context?.let { RingtoneManager.getRingtone(it, uri)?.getTitle(it) } ?: "Device sound"
        promise.resolve(bundleOf("uri" to uri.toString(), "title" to title))
        return@OnActivityResult
      }
      val data = result.data
      val uri = data?.data
      val context = appContext.reactContext
      if (uri == null || context == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      runCatching {
        val grantedFlags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        context.contentResolver.takePersistableUriPermission(uri, grantedFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val title = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) cursor.getString(0) else null
        }
      }.getOrNull() ?: "Audio file"
      promise.resolve(bundleOf("uri" to uri.toString(), "title" to title, "mimeType" to context.contentResolver.getType(uri)))
    }

    OnDestroy {
      soundPickerPromise?.resolve(null)
      soundPickerPromise = null
      TimerSoundPlayer.stopPreview()
    }
  }

  private fun merge(record: TimerConfigRecord, previous: TimerConfig?): TimerConfig? {
    val mainMs = record.mainMs ?: previous?.mainMs ?: return null
    val subMs = record.subMs ?: previous?.subMs ?: return null
    if (mainMs <= 0L || subMs <= 0L) return null
    return TimerConfig(
      mainMs = mainMs,
      subMs = subMs,
      phase = record.phase ?: previous?.phase ?: 0L,
      subEnabled = record.subEnabled ?: previous?.subEnabled ?: true,
      volume = (record.volume ?: previous?.volume ?: 0.8f).coerceIn(0f, 1f),
      notificationsEnabled = record.notificationsEnabled ?: previous?.notificationsEnabled ?: true,
      focusModeEnabled = record.focusModeEnabled ?: previous?.focusModeEnabled ?: false,
      alarmModeEnabled = record.alarmModeEnabled ?: previous?.alarmModeEnabled ?: false,
      activeHoursEnabled = record.activeHoursEnabled ?: previous?.activeHoursEnabled ?: false,
      activeHoursStart = (record.activeHoursStart ?: previous?.activeHoursStart ?: 480).coerceIn(0, 1_439),
      activeHoursEnd = (record.activeHoursEnd ?: previous?.activeHoursEnd ?: 1_320).coerceIn(0, 1_439),
      activeHoursDays = (record.activeHoursDays ?: previous?.activeHoursDays ?: 0x7f)
        .and(0x7f),
      alarmDurationSeconds = (record.alarmDurationSeconds ?: previous?.alarmDurationSeconds ?: 60)
        .coerceIn(5, 3_600),
      timerV2Program = record.timerV2Program ?: previous?.timerV2Program,
      timerV2Anchor = record.timerV2Anchor ?: previous?.timerV2Anchor ?: 0L,
    )
  }

  private fun controlBundle(state: TimerControlState) = bundleOf(
    "alarmOnceArmed" to state.alarmOnceArmed,
    "mutedUntil" to state.mutedUntil,
    "mutedIterationsRemaining" to state.mutedIterationsRemaining,
    "mutedIterationEndId" to state.mutedIterationEndId,
    "mutedIterationEndAt" to state.mutedIterationEndAt,
  )

  private fun focusBundle(state: NativeFocusState) = bundleOf(
    "policyAccess" to state.policyAccess,
    "automationEnabled" to state.automationEnabled,
    "ruleExists" to state.ruleExists,
    "ruleEnabled" to state.ruleEnabled,
    "actual" to state.actual,
    "reason" to state.reason,
  )

  private companion object {
    const val DEVICE_SOUND_PICKER_REQUEST = 8452
    const val AUDIO_DOCUMENT_PICKER_REQUEST = 8453
  }
}
