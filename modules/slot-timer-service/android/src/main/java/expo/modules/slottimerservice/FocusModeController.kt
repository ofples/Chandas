package expo.modules.slottimerservice

import android.app.AlarmManager
import android.app.AutomaticZenRule
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.service.notification.Condition

object FocusModeController {
  private const val PREFS = "slottimer-focus-mode"
  private const val RULE_ID = "ruleId"
  private const val REQUESTED_ACTIVE = "requestedActive"
  private const val FOCUS_END_REQUEST = 8401

  fun conditionId(context: Context): Uri = Uri.Builder()
    .scheme(Condition.SCHEME)
    .authority(context.packageName)
    .appendPath("focus-session")
    .build()

  fun matchesCondition(context: Context, value: Uri): Boolean = value == conditionId(context)

  fun hasPolicyAccess(context: Context): Boolean {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return manager.isNotificationPolicyAccessGranted
  }

  fun openPolicySettings(context: Context) {
    runCatching {
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      })
    }
  }

  fun sync(context: Context, config: TimerConfig? = TimerStateStore.load(context)) {
    val shouldBeActive = config?.focusModeEnabled == true && ActiveHours.isActive(config)
    setRequestedActive(context, shouldBeActive)
    cancelActiveHoursEnd(context)

    if (shouldBeActive) {
      ActiveHours.currentWindowEnd(config)?.let { scheduleActiveHoursEnd(context, it) }
    }
    publish(context, shouldBeActive)
  }

  fun deactivate(context: Context) {
    setRequestedActive(context, false)
    cancelActiveHoursEnd(context)
    publish(context, false)
  }

  fun isActive(context: Context): Boolean {
    if (!hasPolicyAccess(context) || !isRequestedActive(context)) return false
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val ruleId = storedRuleId(context) ?: return false
    val rule = runCatching { manager.getAutomaticZenRule(ruleId) }.getOrNull() ?: return false
    if (!rule.isEnabled) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      val state = runCatching { manager.getAutomaticZenRuleState(ruleId) }.getOrNull()
      if (state == Condition.STATE_TRUE) return true
      if (state == Condition.STATE_FALSE) return false
    }
    return true
  }

  fun shouldUseAlarmAudio(context: Context, config: TimerConfig): Boolean =
    config.focusModeEnabled && ActiveHours.isActive(config) && isActive(context)

  internal fun currentCondition(context: Context): Condition = condition(context, isRequestedActive(context))

  private fun publish(context: Context, active: Boolean) {
    if (!hasPolicyAccess(context)) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val ruleId = (if (active) ensureRule(context, manager) else existingRuleId(context, manager)) ?: return
    val condition = condition(context, active)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      runCatching { manager.setAutomaticZenRuleState(ruleId, condition) }
    } else {
      FocusConditionProviderService.publish(context, condition)
    }
  }

  private fun ensureRule(context: Context, manager: NotificationManager): String? {
    storedRuleId(context)?.let { ruleId ->
      val existing = runCatching { manager.getAutomaticZenRule(ruleId) }.getOrNull()
      if (existing != null) return ruleId
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(RULE_ID).apply()
    }

    val owner = ComponentName(context, FocusConditionProviderService::class.java)
    val rule = buildRule(context, owner)
    return runCatching { manager.addAutomaticZenRule(rule) }.getOrNull()?.also { ruleId ->
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(RULE_ID, ruleId).apply()
    }
  }

  private fun existingRuleId(context: Context, manager: NotificationManager): String? {
    val ruleId = storedRuleId(context) ?: return null
    val existing = runCatching { manager.getAutomaticZenRule(ruleId) }.getOrNull()
    if (existing != null) return ruleId
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(RULE_ID).apply()
    return null
  }

  @Suppress("DEPRECATION")
  private fun buildRule(context: Context, owner: ComponentName): AutomaticZenRule =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      AutomaticZenRule.Builder("SlotTimer Focus", conditionId(context))
        .setOwner(owner)
        .setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
        .setType(AutomaticZenRule.TYPE_OTHER)
        .setEnabled(true)
        .build()
    } else {
      AutomaticZenRule(
        "SlotTimer Focus",
        owner,
        conditionId(context),
        NotificationManager.INTERRUPTION_FILTER_ALARMS,
        true,
      )
    }

  private fun condition(context: Context, active: Boolean): Condition = Condition(
    conditionId(context),
    "SlotTimer Focus",
    if (active) Condition.STATE_TRUE else Condition.STATE_FALSE,
  )

  private fun storedRuleId(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(RULE_ID, null)

  private fun setRequestedActive(context: Context, active: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(REQUESTED_ACTIVE, active)
      .apply()
  }

  private fun isRequestedActive(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(REQUESTED_ACTIVE, false)

  private fun scheduleActiveHoursEnd(context: Context, triggerAt: Long) {
    val operation = PendingIntent.getBroadcast(
      context,
      FOCUS_END_REQUEST,
      Intent(context, TimerEventReceiver::class.java).setAction(TimerEventReceiver.ACTION_FOCUS_END),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
    } catch (_: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
    }
  }

  private fun cancelActiveHoursEnd(context: Context) {
    val operation = PendingIntent.getBroadcast(
      context,
      FOCUS_END_REQUEST,
      Intent(context, TimerEventReceiver::class.java).setAction(TimerEventReceiver.ACTION_FOCUS_END),
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
    ) ?: return
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(operation)
    operation.cancel()
  }
}
