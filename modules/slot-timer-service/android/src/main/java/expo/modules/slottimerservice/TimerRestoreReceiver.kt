package expo.modules.slottimerservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TimerRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val resetRinging = intent.action == Intent.ACTION_BOOT_COMPLETED ||
      intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
    TimerScheduler.restore(context, resetRinging)
  }
}
