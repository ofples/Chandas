package expo.modules.chandastimerservice

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TimerRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == NotificationManager.ACTION_NOTIFICATION_POLICY_ACCESS_GRANTED_CHANGED) {
      FocusModeController.reconcile(context)
      return
    }
    if (intent.action == NotificationManager.ACTION_AUTOMATIC_ZEN_RULE_STATUS_CHANGED) {
      FocusModeController.handleRuleStatus(
        context,
        intent.getStringExtra(NotificationManager.EXTRA_AUTOMATIC_ZEN_RULE_ID),
        intent.getIntExtra(NotificationManager.EXTRA_AUTOMATIC_ZEN_RULE_STATUS, NotificationManager.AUTOMATIC_RULE_STATUS_UNKNOWN),
      )
      return
    }
    val resetRinging = intent.action == Intent.ACTION_BOOT_COMPLETED ||
      intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
    TimerScheduler.restore(context, resetRinging, wallClockChanged = intent.action == Intent.ACTION_TIME_CHANGED)
  }
}
