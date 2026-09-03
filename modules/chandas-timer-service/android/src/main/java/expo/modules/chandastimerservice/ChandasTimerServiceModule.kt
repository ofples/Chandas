package expo.modules.chandastimerservice

import android.app.AlarmManager
import android.app.Activity
import android.media.RingtoneManager
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.os.bundleOf
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
}

class ChandasTimerServiceModule : Module() {
  private var soundPickerPromise: Promise? = null
  private val ringingListener: (Boolean) -> Unit = { ringing ->
    sendEvent("onAlarmStateChanged", bundleOf("ringing" to ringing))
  }
  private val controlListener: (TimerControlState) -> Unit = { state ->
    sendEvent("onControlStateChanged", controlBundle(state))
  }

  override fun definition() = ModuleDefinition {
    Name("ChandasTimerService")
    Events("onAlarmStateChanged", "onControlStateChanged")

    Function("start") { record: TimerConfigRecord ->
      val context = appContext.reactContext ?: return@Function
      val config = merge(record, null) ?: return@Function
      TimerScheduler.start(context, config)
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

    Function("canScheduleExactAlarms") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        true
      } else {
        val manager = context.getSystemService(android.content.Context.ALARM_SERVICE) as AlarmManager
        manager.canScheduleExactAlarms()
      }
    }

    Function("openExactAlarmSettings") {
      val context = appContext.reactContext
      if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
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

    Function("openFullScreenIntentSettings") {
      val context = appContext.reactContext
      if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
      }
    }

    Function("hasNotificationPolicyAccess") {
      val context = appContext.reactContext
      context != null && FocusModeController.hasPolicyAccess(context)
    }

    Function("isFocusModeActive") {
      val context = appContext.reactContext
      context != null && FocusModeController.isActive(context)
    }

    Function("openNotificationPolicySettings") {
      val context = appContext.reactContext
      if (context != null) FocusModeController.openPolicySettings(context)
    }

    Function("refreshFocusMode") {
      val context = appContext.reactContext
      if (context != null) FocusModeController.sync(context)
    }

    Function("setFocusModeEnabled") { enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function
      val previous = TimerStateStore.load(context) ?: return@Function
      val config = previous.copy(focusModeEnabled = enabled)
      TimerStateStore.save(context, config)
      FocusModeController.sync(context, config)
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

    OnActivityResult { _, result ->
      if (result.requestCode != DEVICE_SOUND_PICKER_REQUEST) return@OnActivityResult
      val promise = soundPickerPromise ?: return@OnActivityResult
      soundPickerPromise = null
      val uri = result.data?.getParcelableExtra<android.net.Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
      if (result.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
      } else {
        val context = appContext.reactContext
        val title = context?.let { RingtoneManager.getRingtone(it, uri)?.getTitle(it) } ?: "Device sound"
        promise.resolve(bundleOf("uri" to uri.toString(), "title" to title))
      }
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
        .and(0x7f)
        .let { if (it == 0) 0x7f else it },
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
  )

  private companion object {
    const val DEVICE_SOUND_PICKER_REQUEST = 8452
  }
}
