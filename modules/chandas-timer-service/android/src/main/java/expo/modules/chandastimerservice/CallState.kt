package expo.modules.chandastimerservice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telecom.TelecomManager
import android.telephony.TelephonyManager

/** Best-effort call-state gate; absence of permission fails open rather than guessing. */
object CallState {
  fun isActive(context: Context): Boolean {
    if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return false
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
    val aggregate = runCatching { telecom?.isInCall }.getOrNull()
    if (aggregate != null) return aggregate
    @Suppress("DEPRECATION")
    val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return false
    @Suppress("DEPRECATION")
    return runCatching { telephony.callState != TelephonyManager.CALL_STATE_IDLE }.getOrDefault(false)
  }
}
