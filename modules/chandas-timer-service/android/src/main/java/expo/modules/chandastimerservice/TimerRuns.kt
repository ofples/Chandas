package expo.modules.chandastimerservice

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri

/** Shares the scheduling implementation while isolating each run's durable state and intents. */
internal object TimerRuns {
  private const val INDEX = "chandas-native-runs"
  private const val ACTIVE = "active"
  const val EXTRA_RUN_ID = "expo.modules.chandastimerservice.RUN_ID"
  const val EXTRA_RUN_PANEL = "expo.modules.chandastimerservice.RUN_PANEL"
  private const val NAME = "runName"
  private const val FOCUSED = "focused"
  private val validId = Regex("[a-zA-Z0-9_-]{1,80}")

  private class RunContext(base: Context, val id: String) : ContextWrapper(base) {
    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
      super.getSharedPreferences(if (name == TimerStateStore.PREFS) "$name-$id" else name, mode)
  }

  fun id(context: Context): String? = (context as? RunContext)?.id
  fun scope(context: Context, id: String): Context? =
    if (validId.matches(id)) RunContext(context.applicationContext, id) else null

  fun route(intent: Intent, context: Context): Intent = intent.apply {
    id(context)?.let { data = Uri.Builder().scheme("chandas-timer").authority("run").appendPath(it).build() }
  }

  fun fromIntent(context: Context, intent: Intent): Context? {
    val uri = intent.data ?: return context
    if (uri.scheme != "chandas-timer" || uri.authority != "run") return null
    return uri.lastPathSegment?.let { scope(context, it) }
  }

  private fun index(context: Context) = context.getSharedPreferences(INDEX, Context.MODE_PRIVATE)
  fun ids(context: Context): Set<String> = index(context).getStringSet(ACTIVE, emptySet()).orEmpty().toSet()

  @Synchronized
  fun register(context: Context): Boolean {
    val id = id(context) ?: return true
    return index(context).edit().putStringSet(ACTIVE, ids(context) + id).commit()
  }

  @Synchronized
  fun unregister(context: Context) {
    val id = id(context) ?: return
    val edit = index(context).edit().putStringSet(ACTIVE, ids(context) - id)
    edit.putString(FOCUSED, focusHistory(context).filterNot { it == id }.joinToString(","))
    edit.commit()
  }

  fun contexts(context: Context): List<Context> =
    listOf(context.applicationContext) + ids(context).sorted().mapNotNull { scope(context, it) }

  fun name(context: Context): String? = id(context)?.let {
    context.getSharedPreferences(TimerStateStore.PREFS, Context.MODE_PRIVATE).getString(NAME, null)
  }

  fun setName(context: Context, name: String) {
    context.getSharedPreferences(TimerStateStore.PREFS, Context.MODE_PRIVATE).edit()
      .putString(NAME, name.trim().take(80)).commit()
  }

  @Synchronized
  fun focus(context: Context, id: String) {
    if (id in ids(context)) {
      val history = focusHistory(context)
      index(context).edit().putString(FOCUSED, (listOf(id) + history.filterNot { it == id }).take(64).joinToString(",")).apply()
    }
  }

  private fun focusHistory(context: Context): List<String> =
    index(context).getString(FOCUSED, null).orEmpty().split(',').filter(validId::matches)

  fun presentationConfig(context: Context): TimerConfig? {
    val config = TimerStateStore.load(context) ?: return null
    return config.copy(
      notificationsEnabled = true,
      liveCountdownEnabled = true,
    )
  }

  fun presentation(context: Context): Context {
    val base = context.applicationContext
    val focused = focusHistory(base)
    val active = contexts(base).filter { TimerStateStore.load(it) != null }
    return focused.firstNotNullOfOrNull { id -> active.firstOrNull { TimerRuns.id(it) == id } }
      ?: active.filter { TimerStateStore.load(it)?.timerV2PausedAt == 0L }.minByOrNull { TimerStateStore.nextAt(it).takeIf { at -> at > 0L } ?: Long.MAX_VALUE }
      ?: active.firstOrNull()
      ?: base
  }

  fun focusConfig(context: Context): TimerConfig? {
    val active = contexts(context).mapNotNull(TimerStateStore::load)
    return active.firstOrNull { it.focusModeEnabled && it.timerV2PausedAt == 0L && ActiveHours.isActive(it) }
      ?: active.firstOrNull { it.focusModeEnabled } ?: active.firstOrNull()
  }

  fun setFocusForAll(context: Context, enabled: Boolean) {
    contexts(context).forEach { run ->
      TimerStateStore.load(run)?.let { TimerStateStore.save(run, it.copy(focusModeEnabled = enabled)) }
    }
  }

  fun reconcileFocus(context: Context, forceApply: Boolean = false) {
    FocusModeController.reconcile(context.applicationContext, focusConfig(context), forceApply)
  }
}
