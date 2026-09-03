package expo.modules.chandastimerservice

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.os.Build
import android.view.WindowManager

/**
 * Makes MainActivity wake the screen and show over the lock screen when it was
 * launched/resumed for a ringing alarm — the same behavior a real alarm-clock
 * app uses. Called from a small injected snippet in MainActivity.kt (see this
 * module's config plugin, plugin/withAlarmMainActivity.js) so the generated
 * MainActivity itself only needs two one-line calls out to here.
 */
object AlarmWindowHelper {
  const val EXTRA_ALARM_RINGING = "chandas_alarm_ringing"

  fun applyAlarmWindowFlags(activity: Activity, intent: Intent?) {
    val ringing = intent?.getBooleanExtra(EXTRA_ALARM_RINGING, false) == true
    if (!ringing) {
      clearAlarmWindowFlags(activity)
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(true)
      activity.setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      activity.window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      )
    }

    val keyguardManager = activity.getSystemService(Activity.KEYGUARD_SERVICE) as? KeyguardManager
    keyguardManager?.requestDismissKeyguard(activity, null)
  }

  fun clearAlarmWindowFlags(activity: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(false)
      activity.setTurnScreenOn(false)
    }
    @Suppress("DEPRECATION")
    activity.window.clearFlags(
      WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
    )
  }
}
