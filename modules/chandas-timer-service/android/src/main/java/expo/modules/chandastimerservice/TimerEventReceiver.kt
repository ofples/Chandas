package expo.modules.chandastimerservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TimerEventReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_FIRE = "expo.modules.chandastimerservice.action.FIRE"
    const val ACTION_STOP = "expo.modules.chandastimerservice.action.STOP"
    const val ACTION_FOCUS_END = "expo.modules.chandastimerservice.action.FOCUS_END"
    const val EXTRA_TRIGGER_AT = "triggerAt"
    const val EXTRA_EVENT_TYPE = "eventType"
    const val EXTRA_LOGICAL_ID = "logicalId"
    const val EXTRA_GENERATION = "generation"
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_STOP -> TimerScheduler.stop(context)
      ACTION_FOCUS_END -> FocusModeController.sync(context)
      ACTION_FIRE -> {
        val type = TimerEventType.fromValue(intent.getStringExtra(EXTRA_EVENT_TYPE)) ?: return
        val triggerAt = intent.getLongExtra(EXTRA_TRIGGER_AT, -1L)
        val logicalId = intent.getStringExtra(EXTRA_LOGICAL_ID) ?: return
        val generation = intent.getStringExtra(EXTRA_GENERATION) ?: return
        if (triggerAt <= 0L) return
        val pendingResult = goAsync()
        TimerScheduler.handleTriggered(context, triggerAt, type, logicalId, generation) { pendingResult.finish() }
      }
    }
  }
}
