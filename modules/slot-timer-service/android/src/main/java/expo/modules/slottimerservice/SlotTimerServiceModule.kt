package expo.modules.slottimerservice

import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * JS-facing bridge for SlotTimerFgService — a `mediaPlayback` Android foreground
 * service that owns tick scheduling, gong/bell/bg-music playback, and the ongoing
 * "Next gong at HH:MM" notification while a session is running (plus a
 * continuous, dismissable alarm when alarm mode is on).
 *
 * `start`/`update`/`stop`/`stopAlarm` just translate into Intents; all state and
 * timing logic lives in the service itself so it keeps running independently of
 * the JS/React Native lifecycle (see src/hooks/useTimer.ts and
 * src/native/SlotTimerService.ts for the JS side of this contract).
 */
class TimerConfigRecord : Record {
  @Field var mainMs: Long? = null
  @Field var subMs: Long? = null
  @Field var phase: Long? = null
  @Field var subEnabled: Boolean? = null
  @Field var volume: Float? = null
  @Field var bgTrack: Int? = null
  @Field var bgVolume: Float? = null
  @Field var notificationsEnabled: Boolean? = null
  @Field var alarmModeEnabled: Boolean? = null
}

class SlotTimerServiceModule : Module() {
  // Bridges SlotTimerFgService's in-process listener registry to this
  // module's JS event emitter. Held as a field so OnStopObserving can remove
  // the exact same instance that OnStartObserving registered.
  private val ringingListener: (Boolean) -> Unit = { ringing ->
    sendEvent("onAlarmStateChanged", bundleOf("ringing" to ringing))
  }

  override fun definition() = ModuleDefinition {
    Name("SlotTimerService")

    Events("onAlarmStateChanged")

    Function("start") { config: TimerConfigRecord ->
      sendCommand(SlotTimerFgService.ACTION_START, config)
    }

    Function("update") { config: TimerConfigRecord ->
      sendCommand(SlotTimerFgService.ACTION_UPDATE, config)
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function
      context.startService(Intent(context, SlotTimerFgService::class.java).apply {
        action = SlotTimerFgService.ACTION_STOP
      })
    }

    Function("stopAlarm") {
      val context = appContext.reactContext ?: return@Function
      context.startService(Intent(context, SlotTimerFgService::class.java).apply {
        action = SlotTimerFgService.ACTION_STOP_ALARM
      })
    }

    Function("isRinging") {
      SlotTimerFgService.isRingingNow
    }

    OnStartObserving("onAlarmStateChanged") {
      SlotTimerFgService.addRingingListener(ringingListener)
    }

    OnStopObserving("onAlarmStateChanged") {
      SlotTimerFgService.removeRingingListener(ringingListener)
    }
  }

  private fun sendCommand(action: String, config: TimerConfigRecord) {
    val context = appContext.reactContext ?: return
    val intent = Intent(context, SlotTimerFgService::class.java).apply {
      this.action = action
      config.mainMs?.let { putExtra(SlotTimerFgService.EXTRA_MAIN_MS, it) }
      config.subMs?.let { putExtra(SlotTimerFgService.EXTRA_SUB_MS, it) }
      config.phase?.let { putExtra(SlotTimerFgService.EXTRA_PHASE, it) }
      config.subEnabled?.let { putExtra(SlotTimerFgService.EXTRA_SUB_ENABLED, it) }
      config.volume?.let { putExtra(SlotTimerFgService.EXTRA_VOLUME, it) }
      config.bgTrack?.let { putExtra(SlotTimerFgService.EXTRA_BG_TRACK, it) }
      config.bgVolume?.let { putExtra(SlotTimerFgService.EXTRA_BG_VOLUME, it) }
      config.notificationsEnabled?.let { putExtra(SlotTimerFgService.EXTRA_NOTIFICATIONS_ENABLED, it) }
      config.alarmModeEnabled?.let { putExtra(SlotTimerFgService.EXTRA_ALARM_MODE_ENABLED, it) }
    }
    ContextCompat.startForegroundService(context, intent)
  }
}
