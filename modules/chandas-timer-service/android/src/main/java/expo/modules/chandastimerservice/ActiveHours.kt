package expo.modules.chandastimerservice

import java.util.Calendar

object ActiveHours {
  private fun activeDays(config: TimerConfig): Int =
    config.activeHoursDays.and(0x7f).let { if (it == 0) 0x7f else it }

  private fun isDayEnabled(config: TimerConfig, calendarDay: Int): Boolean =
    activeDays(config).and(1 shl (calendarDay - Calendar.SUNDAY)) != 0

  fun isActive(config: TimerConfig, timestamp: Long = System.currentTimeMillis()): Boolean {
    if (!config.activeHoursEnabled) return true
    val start = config.activeHoursStart.coerceIn(0, 1_439)
    val end = config.activeHoursEnd.coerceIn(0, 1_439)
    val calendar = Calendar.getInstance().apply { timeInMillis = timestamp }
    val minute = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    if (start == end) return isDayEnabled(config, calendar.get(Calendar.DAY_OF_WEEK))
    if (start < end) {
      return isDayEnabled(config, calendar.get(Calendar.DAY_OF_WEEK)) && minute >= start && minute < end
    }
    if (minute >= start) return isDayEnabled(config, calendar.get(Calendar.DAY_OF_WEEK))
    if (minute < end) {
      calendar.add(Calendar.DAY_OF_MONTH, -1)
      return isDayEnabled(config, calendar.get(Calendar.DAY_OF_WEEK))
    }
    return false
  }

  fun nextStart(config: TimerConfig, timestamp: Long = System.currentTimeMillis()): Long {
    val start = config.activeHoursStart.coerceIn(0, 1_439)
    val candidate = Calendar.getInstance().apply {
      timeInMillis = timestamp
      set(Calendar.HOUR_OF_DAY, start / 60)
      set(Calendar.MINUTE, start % 60)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    repeat(8) {
      if (candidate.timeInMillis > timestamp && isDayEnabled(config, candidate.get(Calendar.DAY_OF_WEEK))) {
        return candidate.timeInMillis
      }
      candidate.add(Calendar.DAY_OF_MONTH, 1)
    }
    return candidate.timeInMillis
  }

  fun currentWindowEnd(config: TimerConfig, timestamp: Long = System.currentTimeMillis()): Long? {
    if (!config.activeHoursEnabled || !isActive(config, timestamp)) return null
    val start = config.activeHoursStart.coerceIn(0, 1_439)
    val end = config.activeHoursEnd.coerceIn(0, 1_439)
    if (start == end) {
      return Calendar.getInstance().apply {
        timeInMillis = timestamp
        add(Calendar.DAY_OF_MONTH, 1)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }.timeInMillis
    }

    val endTime = Calendar.getInstance().apply {
      timeInMillis = timestamp
      set(Calendar.HOUR_OF_DAY, end / 60)
      set(Calendar.MINUTE, end % 60)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (endTime.timeInMillis <= timestamp) endTime.add(Calendar.DAY_OF_MONTH, 1)
    return endTime.timeInMillis
  }
}
