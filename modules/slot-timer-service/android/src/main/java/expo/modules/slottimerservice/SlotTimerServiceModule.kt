package expo.modules.slottimerservice

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class TimerConfigRecord : Record {
  @Field var mainMs: Long? = null
  @Field var subMs: Long? = null
  @Field var phase: Long? = null
  @Field var subEnabled: Boolean? = null
  @Field var volume: Float? = null
  @Field var notificationsEnabled: Boolean? = null
  @Field var alarmModeEnabled: Boolean? = null
}

class SlotTimerServiceModule : Module() {
  private val ringingListener: (Boolean) -> Unit = { ringing ->
    sendEvent("onAlarmStateChanged", bundleOf("ringing" to ringing))
  }

  override fun definition() = ModuleDefinition {
    Name("SlotTimerService")
    Events("onAlarmStateChanged")

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
        context.startService(Intent(context, SlotTimerAlarmService::class.java).apply {
          action = SlotTimerAlarmService.ACTION_STOP
        })
      }
    }

    Function("isRinging") {
      val context = appContext.reactContext
      context != null && TimerStateStore.isRinging(context)
    }

    Function("getState") {
      val context = appContext.reactContext
      val config = context?.let { TimerStateStore.load(it) }
      if (config == null) {
        bundleOf("active" to false, "ringing" to false)
      } else {
        bundleOf(
          "active" to true,
          "ringing" to TimerStateStore.isRinging(context),
          "mainMs" to config.mainMs,
          "subMs" to config.subMs,
          "phase" to config.phase,
          "subEnabled" to config.subEnabled,
          "volume" to config.volume,
          "notificationsEnabled" to config.notificationsEnabled,
          "alarmModeEnabled" to config.alarmModeEnabled,
        )
      }
    }

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

    OnStartObserving("onAlarmStateChanged") {
      AlarmStateRegistry.add(ringingListener)
    }

    OnStopObserving("onAlarmStateChanged") {
      AlarmStateRegistry.remove(ringingListener)
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
      alarmModeEnabled = record.alarmModeEnabled ?: previous?.alarmModeEnabled ?: false,
    )
  }
}
