package expo.modules.chandastimerservice

import org.json.JSONObject

/**
 * OTA-owned notification wording with conservative native fallbacks.
 * Notification channel identifiers and platform behavior remain native.
 */
data class TimerNotificationCopy(
  val runningTitle: String,
  val nextCueAt: String,
  val resumesAt: String,
  val sessionEndsAt: String,
  val stopTimerAction: String,
  val mainEventTitle: String,
  val bellEventTitle: String,
  val cueEventTitle: String,
  val eventBody: String,
  val alarmTitle: String,
  val alarmBody: String,
  val stopAlarmAction: String,
) {
  fun nextCue(time: String): String = nextCueAt.replace("{time}", time)
  fun resumes(time: String): String = resumesAt.replace("{time}", time)
  fun sessionEnds(time: String): String = sessionEndsAt.replace("{time}", time)

  companion object {
    const val MAX_SERIALIZED_CHARACTERS = 8_192
    private const val MAX_TEXT_CODE_POINTS = 120

    val DEFAULT = TimerNotificationCopy(
      runningTitle = "Chandas",
      nextCueAt = "Next cue at {time}",
      resumesAt = "Resumes at {time}",
      sessionEndsAt = "Session ends at {time}",
      stopTimerAction = "Stop timer",
      mainEventTitle = "Chandas Gong",
      bellEventTitle = "Chandas Bell",
      cueEventTitle = "Chandas Cue",
      eventBody = "Timer interval reached",
      alarmTitle = "Chandas — Time's up",
      alarmBody = "Alarm is ringing",
      stopAlarmAction = "Stop alarm",
    )

    fun from(serialized: String?): TimerNotificationCopy {
      if (serialized.isNullOrBlank() || serialized.length > MAX_SERIALIZED_CHARACTERS) return DEFAULT
      return runCatching {
        val root = JSONObject(serialized)
        TimerNotificationCopy(
          runningTitle = root.text("runningTitle", DEFAULT.runningTitle),
          nextCueAt = root.template("nextCueAt", DEFAULT.nextCueAt),
          resumesAt = root.template("resumesAt", DEFAULT.resumesAt),
          sessionEndsAt = root.template("sessionEndsAt", DEFAULT.sessionEndsAt),
          stopTimerAction = root.text("stopTimerAction", DEFAULT.stopTimerAction),
          mainEventTitle = root.text("mainEventTitle", DEFAULT.mainEventTitle),
          bellEventTitle = root.text("bellEventTitle", DEFAULT.bellEventTitle),
          cueEventTitle = root.text("cueEventTitle", DEFAULT.cueEventTitle),
          eventBody = root.text("eventBody", DEFAULT.eventBody),
          alarmTitle = root.text("alarmTitle", DEFAULT.alarmTitle),
          alarmBody = root.text("alarmBody", DEFAULT.alarmBody),
          stopAlarmAction = root.text("stopAlarmAction", DEFAULT.stopAlarmAction),
        )
      }.getOrDefault(DEFAULT)
    }

    private fun JSONObject.text(key: String, fallback: String): String {
      val value = optString(key).trim()
      return value.takeIf { it.isNotEmpty() && it.codePointCount(0, it.length) <= MAX_TEXT_CODE_POINTS } ?: fallback
    }

    private fun JSONObject.template(key: String, fallback: String): String {
      val value = text(key, fallback)
      return value.takeIf { it.contains("{time}") } ?: fallback
    }
  }
}
