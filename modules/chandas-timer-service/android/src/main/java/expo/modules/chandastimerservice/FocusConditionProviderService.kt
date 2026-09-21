@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package expo.modules.chandastimerservice

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.service.notification.Condition
import android.service.notification.ConditionProviderService

class FocusConditionProviderService : ConditionProviderService() {
  companion object {
    @Volatile private var connectedService: FocusConditionProviderService? = null

    fun publish(context: Context, condition: Condition) {
      val service = connectedService
      if (service != null) {
        service.notifyCondition(condition)
      } else {
        requestRebind(ComponentName(context, FocusConditionProviderService::class.java))
      }
    }
  }

  override fun onConnected() {
    connectedService = this
    notifyCondition(FocusModeController.currentCondition(this))
  }

  override fun onSubscribe(conditionId: Uri) {
    if (FocusModeController.matchesCondition(this, conditionId)) {
      notifyCondition(FocusModeController.currentCondition(this))
    }
  }

  override fun onUnsubscribe(conditionId: Uri) = Unit

  override fun onDestroy() {
    if (connectedService === this) connectedService = null
    super.onDestroy()
  }
}
