package expo.modules.slottimerservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TimerEventReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_FIRE = "expo.modules.slottimerservice.action.FIRE"
    const val ACTION_STOP = "expo.modules.slottimerservice.action.STOP"
    const val EXTRA_TRIGGER_AT = "triggerAt"
    const val EXTRA_EVENT_TYPE = "eventType"
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_STOP -> TimerScheduler.stop(context)
      ACTION_FIRE -> {
        val type = TimerEventType.fromValue(intent.getStringExtra(EXTRA_EVENT_TYPE)) ?: return
        val triggerAt = intent.getLongExtra(EXTRA_TRIGGER_AT, -1L)
        if (triggerAt <= 0L) return
        val pendingResult = goAsync()
        TimerScheduler.handleTriggered(context, triggerAt, type) { pendingResult.finish() }
      }
    }
  }
}
