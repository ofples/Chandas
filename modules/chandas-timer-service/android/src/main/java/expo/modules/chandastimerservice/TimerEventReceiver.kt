package expo.modules.chandastimerservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.atomic.AtomicBoolean

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
      ACTION_FOCUS_END -> FocusModeController.reconcile(context)
      ACTION_FIRE -> {
        val type = TimerEventType.fromValue(intent.getStringExtra(EXTRA_EVENT_TYPE)) ?: return
        val triggerAt = intent.getLongExtra(EXTRA_TRIGGER_AT, -1L)
        val logicalId = intent.getStringExtra(EXTRA_LOGICAL_ID) ?: return
        val generation = intent.getStringExtra(EXTRA_GENERATION) ?: return
        if (triggerAt <= 0L) return
        val pendingResult = goAsync()
        val finished = AtomicBoolean(false)
        val finishOnce = { if (finished.compareAndSet(false, true)) pendingResult.finish() }
        try {
          TimerScheduler.handleTriggered(context, triggerAt, type, logicalId, generation, finishOnce)
        } catch (_: Exception) {
          // A receiver must always release goAsync. Attempt to reconstruct the
          // one-future-event invariant before yielding; restore itself fails
          // closed if the persisted program or exact-alarm access is invalid.
          runCatching { TimerScheduler.restore(context, resetRinging = false) }
          finishOnce()
        }
      }
    }
  }
}
