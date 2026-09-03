package expo.modules.chandastimerservice

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
import android.service.notification.ZenPolicy

/** Owns only the Chandas automatic rule. Querying never changes Android state. */
object FocusModeController {
  private const val PREFS = "chandas-focus-mode"
  private const val RULE_ID = "ruleId"
  private const val AUTOMATION_ENABLED = "automationEnabled"
  private const val REQUESTED_ACTIVE = "requestedActive"
  private const val PAUSED_BY_ANDROID = "pausedByAndroid"
  private const val RULE_WAS_REMOVED = "ruleWasRemoved"
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

  /** Read-only foreground/startup refresh. */
  fun query(context: Context): NativeFocusState = queryInternal(context).also(FocusStateRegistry::notify)

  /** Applies a real timer, active-hours, or preference transition. */
  fun reconcile(context: Context, config: TimerConfig? = TimerStateStore.load(context)) {
    if (config != null) setAutomationEnabled(context, config.focusModeEnabled)
    val desired = config != null && automationEnabled(context) && ActiveHours.isActive(config)
    val previous = requestedActive(context)

    cancelActiveHoursEnd(context)
    if (desired) config?.let { ActiveHours.currentWindowEnd(it)?.let { end -> scheduleActiveHoursEnd(context, end) } }

    if (desired != previous) {
      setRequestedActive(context, desired)
      if (!desired) {
        setPausedByAndroid(context, false)
        publishCondition(context, false, createIfMissing = false)
      } else {
        // A genuine false -> true transition is the point at which Android's
        // one-cycle manual snooze may be cleared and requested again.
        setPausedByAndroid(context, false)
        publishCondition(context, true, createIfMissing = true)
      }
    }
    query(context)
  }

  fun deactivate(context: Context) {
    val wasRequested = requestedActive(context)
    setRequestedActive(context, false)
    setPausedByAndroid(context, false)
    cancelActiveHoursEnd(context)
    if (wasRequested) publishCondition(context, false, createIfMissing = false)
    query(context)
  }

  fun setAutomationFromApp(context: Context, enabled: Boolean) {
    setAutomationEnabled(context, enabled)
    if (enabled) {
      setRuleWasRemoved(context, false)
      setPausedByAndroid(context, false)
    }
    TimerStateStore.load(context)?.let { TimerStateStore.save(context, it.copy(focusModeEnabled = enabled)) }
    reconcile(context)
  }

  fun handleRuleStatus(context: Context, ruleId: String?, status: Int) {
    val ownedId = storedRuleId(context) ?: return
    if (ruleId != null && ruleId != ownedId) return
    when (status) {
      NotificationManager.AUTOMATIC_RULE_STATUS_ACTIVATED -> {
        setPausedByAndroid(context, false)
        setAutomationEnabled(context, true)
        TimerStateStore.load(context)?.let { TimerStateStore.save(context, it.copy(focusModeEnabled = true)) }
      }
      NotificationManager.AUTOMATIC_RULE_STATUS_DEACTIVATED -> setPausedByAndroid(context, true)
      NotificationManager.AUTOMATIC_RULE_STATUS_DISABLED -> disableAutomationFromAndroid(context)
      NotificationManager.AUTOMATIC_RULE_STATUS_REMOVED -> {
        clearStoredRule(context)
        setRuleWasRemoved(context, true)
        disableAutomationFromAndroid(context)
      }
      NotificationManager.AUTOMATIC_RULE_STATUS_ENABLED -> {
        setAutomationEnabled(context, true)
        TimerStateStore.load(context)?.let { TimerStateStore.save(context, it.copy(focusModeEnabled = true)) }
        reconcile(context)
        return
      }
    }
    query(context)
  }

  fun isActive(context: Context): Boolean = queryInternal(context).actual == "active"

  internal fun currentCondition(context: Context): Condition = condition(context, requestedActive(context))

  private fun queryInternal(context: Context): NativeFocusState {
    val access = hasPolicyAccess(context)
    val automation = automationEnabled(context)
    val config = TimerStateStore.load(context)
    if (!access) return NativeFocusState(false, automation, false, false, "unknown", if (automation) "access-required" else "off")

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val id = storedRuleId(context)
    val rule = id?.let { runCatching { manager.getAutomaticZenRule(it) }.getOrNull() }
    if (id != null && rule == null) clearStoredRule(context)
    val exists = rule != null
    val enabled = rule?.isEnabled == true
    val actual = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM && id != null && enabled) {
      when (runCatching { manager.getAutomaticZenRuleState(id) }.getOrNull()) {
        Condition.STATE_TRUE -> "active"
        Condition.STATE_FALSE -> "inactive"
        else -> "unknown"
      }
    } else if (!enabled) {
      "inactive"
    } else {
      // Older releases do not expose the actual state of an owned rule.
      "unknown"
    }

    val reason = when {
      ruleWasRemoved(context) -> "rule-disabled"
      exists && !enabled -> "rule-disabled"
      !automation -> "off"
      !exists && config == null -> "timer-stopped"
      !exists -> "unknown"
      pausedByAndroid(context) -> "paused-by-android"
      actual == "active" -> "active"
      config == null -> "timer-stopped"
      !ActiveHours.isActive(config) -> "outside-active-hours"
      else -> "unknown"
    }
    return NativeFocusState(access, automation, exists, enabled, actual, reason)
  }

  private fun disableAutomationFromAndroid(context: Context) {
    setAutomationEnabled(context, false)
    setRequestedActive(context, false)
    TimerStateStore.load(context)?.let { TimerStateStore.save(context, it.copy(focusModeEnabled = false)) }
  }

  private fun publishCondition(context: Context, active: Boolean, createIfMissing: Boolean) {
    if (!hasPolicyAccess(context)) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val ruleId = if (createIfMissing) ensureRule(context, manager) else existingRuleId(context, manager)
    ruleId ?: return
    val next = condition(context, active)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      runCatching { manager.setAutomaticZenRuleState(ruleId, next) }
    } else {
      FocusConditionProviderService.publish(context, next)
    }
  }

  private fun ensureRule(context: Context, manager: NotificationManager): String? {
    existingRuleId(context, manager)?.let { return it }
    if (ruleWasRemoved(context)) return null
    val owner = ComponentName(context, FocusConditionProviderService::class.java)
    return runCatching { manager.addAutomaticZenRule(buildRule(context, owner)) }.getOrNull()?.also { id ->
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(RULE_ID, id).apply()
    }
  }

  private fun existingRuleId(context: Context, manager: NotificationManager): String? {
    val id = storedRuleId(context) ?: return null
    if (runCatching { manager.getAutomaticZenRule(id) }.getOrNull() != null) return id
    clearStoredRule(context)
    return null
  }

  @Suppress("DEPRECATION")
  private fun buildRule(context: Context, owner: ComponentName): AutomaticZenRule {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      return AutomaticZenRule.Builder("Chandas Focus", conditionId(context))
        .setOwner(owner)
        .setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        .setZenPolicy(focusPolicy())
        .setType(AutomaticZenRule.TYPE_OTHER)
        .setEnabled(true)
        .build()
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      return AutomaticZenRule(
        "Chandas Focus",
        owner,
        null,
        conditionId(context),
        focusPolicy(),
        NotificationManager.INTERRUPTION_FILTER_PRIORITY,
        true,
      )
    }
    return AutomaticZenRule(
      "Chandas Focus",
      owner,
      conditionId(context),
      NotificationManager.INTERRUPTION_FILTER_PRIORITY,
      true,
    )
  }

  private fun focusPolicy(): ZenPolicy = ZenPolicy.Builder().allowAlarms(true).build()

  private fun condition(context: Context, active: Boolean): Condition = Condition(
    conditionId(context),
    "Chandas Focus",
    if (active) Condition.STATE_TRUE else Condition.STATE_FALSE,
  )

  private fun scheduleActiveHoursEnd(context: Context, triggerAt: Long) {
    if (!TimerScheduler.canScheduleExactAlarms(context)) return
    val operation = PendingIntent.getBroadcast(
      context,
      FOCUS_END_REQUEST,
      Intent(context, TimerEventReceiver::class.java).setAction(TimerEventReceiver.ACTION_FOCUS_END),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    runCatching { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation) }
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

  private fun storedRuleId(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(RULE_ID, null)
  private fun clearStoredRule(context: Context) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(RULE_ID).apply() }
  private fun automationEnabled(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(AUTOMATION_ENABLED, false)
  private fun setAutomationEnabled(context: Context, value: Boolean) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(AUTOMATION_ENABLED, value).apply() }
  private fun requestedActive(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(REQUESTED_ACTIVE, false)
  private fun setRequestedActive(context: Context, value: Boolean) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(REQUESTED_ACTIVE, value).apply() }
  private fun pausedByAndroid(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PAUSED_BY_ANDROID, false)
  private fun setPausedByAndroid(context: Context, value: Boolean) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PAUSED_BY_ANDROID, value).apply() }
  private fun ruleWasRemoved(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(RULE_WAS_REMOVED, false)
  private fun setRuleWasRemoved(context: Context, value: Boolean) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(RULE_WAS_REMOVED, value).apply() }
}
