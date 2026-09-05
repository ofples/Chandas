package expo.modules.chandastimerservice

import org.json.JSONObject
import java.util.Calendar

object ActiveHours {
  private const val MAX_POLICY_CHARACTERS = 262_144
  private const val MAX_WINDOWS = 16
  private const val MAX_OVERRIDES = 256
  private const val EIGHT_DAYS_MS = 8L * 24L * 60L * 60L * 1_000L

  private data class Window(val id: String, val enabled: Boolean, val start: Int, val end: Int, val days: Int)
  private data class Override(val id: String, val startAt: Long, val endAt: Long, val behavior: String)
  private data class Policy(val enabled: Boolean, val windows: List<Window>, val overrides: List<Override>)

  private fun legacy(config: TimerConfig) = Policy(
    config.activeHoursEnabled,
    listOf(Window("legacy-active-hours", true, config.activeHoursStart.coerceIn(0, 1_439), config.activeHoursEnd.coerceIn(0, 1_439), config.activeHoursDays.and(0x7f))),
    emptyList(),
  )

  private fun policy(config: TimerConfig): Policy? {
    val serialized = config.availabilityPolicy ?: return legacy(config)
    if (serialized.length > MAX_POLICY_CHARACTERS) return null
    return runCatching {
      val root = JSONObject(serialized)
      val windowsJson = root.optJSONArray("weeklyWindows") ?: return@runCatching null
      val overridesJson = root.optJSONArray("overrides") ?: return@runCatching null
      if (windowsJson.length() > MAX_WINDOWS || overridesJson.length() > MAX_OVERRIDES) return@runCatching null
      val windowIds = mutableSetOf<String>()
      val windows = (0 until windowsJson.length()).map { index ->
        val item = windowsJson.optJSONObject(index) ?: return@runCatching null
        val id = item.optString("id")
        val start = item.optInt("startMinutes", -1)
        val end = item.optInt("endMinutes", -1)
        val days = item.optInt("days", -1)
        if (id.isBlank() || id.length > 200 || !windowIds.add(id) || start !in 0..1_439 || end !in 0..1_439 || days !in 0..0x7f) return@runCatching null
        Window(id, item.optBoolean("enabled", true), start, end, days)
      }
      val overrideIds = mutableSetOf<String>()
      val overrides = (0 until overridesJson.length()).map { index ->
        val item = overridesJson.optJSONObject(index) ?: return@runCatching null
        val id = item.optString("id")
        val startAt = item.optLong("startAt", -1L)
        val endAt = item.optLong("endAt", -1L)
        val behavior = item.optString("behavior")
        if (id.isBlank() || id.length > 200 || !overrideIds.add(id) || startAt < 0L || endAt <= startAt || behavior !in setOf("active", "mute") || item.optString("source") != "calendar") return@runCatching null
        Override(id, startAt, endAt, behavior)
      }
      Policy(root.optBoolean("enabled", false), windows, overrides)
    }.getOrNull()
  }

  fun isValid(config: TimerConfig): Boolean = policy(config) != null

  fun hasPotentialAvailability(config: TimerConfig, now: Long = System.currentTimeMillis()): Boolean {
    val policy = policy(config) ?: return false
    if (!policy.enabled) return true
    if (policy.windows.any { it.enabled && it.days != 0 }) return true
    return policy.overrides.any { it.behavior == "active" && it.endAt > now }
  }

  private fun isDayEnabled(window: Window, calendarDay: Int): Boolean =
    window.days.and(1 shl (calendarDay - Calendar.SUNDAY)) != 0

  private fun isWithin(window: Window, timestamp: Long): Boolean {
    if (!window.enabled) return false
    val calendar = Calendar.getInstance().apply { timeInMillis = timestamp }
    val minute = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    if (window.start == window.end) return isDayEnabled(window, calendar.get(Calendar.DAY_OF_WEEK))
    if (window.start < window.end) return isDayEnabled(window, calendar.get(Calendar.DAY_OF_WEEK)) && minute >= window.start && minute < window.end
    if (minute >= window.start) return isDayEnabled(window, calendar.get(Calendar.DAY_OF_WEEK))
    if (minute < window.end) {
      calendar.add(Calendar.DAY_OF_MONTH, -1)
      return isDayEnabled(window, calendar.get(Calendar.DAY_OF_WEEK))
    }
    return false
  }

  private fun matches(overrides: List<Override>, timestamp: Long, behavior: String): Boolean =
    overrides.any { it.behavior == behavior && it.startAt <= timestamp && timestamp < it.endAt }

  private fun isActive(policy: Policy, timestamp: Long): Boolean {
    val weeklyActive = !policy.enabled || policy.windows.any { isWithin(it, timestamp) }
    val active = weeklyActive || matches(policy.overrides, timestamp, "active")
    return active && !matches(policy.overrides, timestamp, "mute")
  }

  fun isActive(config: TimerConfig, timestamp: Long = System.currentTimeMillis()): Boolean =
    policy(config)?.let { isActive(it, timestamp) } ?: false

  private fun weeklyBoundary(window: Window, timestamp: Long, dayOffset: Int, startBoundary: Boolean): Long {
    val minute = if (startBoundary) {
      if (window.start == window.end) 0 else window.start
    } else {
      if (window.start == window.end) 0 else window.end
    }
    return Calendar.getInstance().apply {
      timeInMillis = timestamp
      set(Calendar.HOUR_OF_DAY, minute / 60)
      set(Calendar.MINUTE, minute % 60)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_MONTH, dayOffset)
    }.timeInMillis
  }

  private fun boundaries(policy: Policy, timestamp: Long): List<Long> {
    val values = mutableSetOf<Long>()
    policy.overrides.forEach {
      if (it.startAt > timestamp) values.add(it.startAt)
      if (it.endAt > timestamp) values.add(it.endAt)
    }
    if (policy.enabled) policy.windows.filter { it.enabled && it.days != 0 }.forEach { window ->
      for (dayOffset in 0..8) {
        val start = weeklyBoundary(window, timestamp, dayOffset, true)
        if (start > timestamp && isDayEnabled(window, Calendar.getInstance().apply { timeInMillis = start }.get(Calendar.DAY_OF_WEEK))) values.add(start)
        val end = weeklyBoundary(window, timestamp, dayOffset, false)
        // Cross-midnight end belongs to the civil day after its selected start.
        val endStartDay = Calendar.getInstance().apply { timeInMillis = end; if (window.start >= window.end) add(Calendar.DAY_OF_MONTH, -1) }
        if (end > timestamp && isDayEnabled(window, endStartDay.get(Calendar.DAY_OF_WEEK))) values.add(end)
      }
    }
    return values.sorted()
  }

  fun nextStart(config: TimerConfig, timestamp: Long = System.currentTimeMillis()): Long {
    val policy = policy(config) ?: return timestamp + EIGHT_DAYS_MS
    if (isActive(policy, timestamp)) return timestamp
    return boundaries(policy, timestamp).firstOrNull { isActive(policy, it) } ?: timestamp + EIGHT_DAYS_MS
  }

  /** End of the connected active union, not merely the first window's end. */
  fun currentWindowEnd(config: TimerConfig, timestamp: Long = System.currentTimeMillis()): Long? {
    val policy = policy(config) ?: return null
    if (!isActive(policy, timestamp)) return null
    return boundaries(policy, timestamp).firstOrNull { !isActive(policy, it) }
  }
}
