package expo.modules.chandastimerservice

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone
import kotlin.math.max

data class TimerV2Event(
  val at: Long,
  val logicalId: String,
  val boundary: TimerV2Boundary,
  val candidates: List<TimerV2Candidate>,
  val winner: TimerV2Candidate,
  val completesRun: Boolean = false,
)

data class TimerV2IterationEnd(val logicalId: String, val at: Long)

enum class TimerV2Boundary(val value: String) {
  PATTERN_MAIN("pattern-main"),
  PATTERN_OFFSET("pattern-offset"),
  SEQUENCE_STEP("sequence-step"),
  SEQUENCE_CYCLE("sequence-cycle"),
  RUN_COMPLETE("run-complete"),
}

data class TimerV2Candidate(
  val cueId: String,
  val kind: String,
  val soundId: String,
  val volume: Float,
  val trackOrder: Int? = null,
)

/** Native mirror of src/lib/timeline.ts. It intentionally schedules only one future event. */
object TimerV2Timeline {
  private const val MINUTE = 60_000L
  private const val TIMEZONE_TRANSITION_SCAN_STEP_MS = 6L * 60L * 60L * 1_000L
  private const val TIMEZONE_TRANSITION_LOOKAHEAD_MS = 5L * 366L * 24L * 60L * 60L * 1_000L
  private const val SCHEMA_VERSION = 2
  private const val MAX_TRACKS = 5
  private const val MAX_STEPS = 20
  private const val MAX_DURATION_MINUTES = 240
  private const val MAX_RUN_CYCLES = 999
  private const val MAX_RUN_DURATION_SECONDS = 1_295_999L
  private const val MAX_PROGRAM_CHARACTERS = 262_144
  private const val MAX_ID_CHARACTERS = 200
  private const val MAX_URI_CHARACTERS = 8_192
  private val builtInSoundIds = setOf(
    "temple-gong", "clear-bell", "bloom", "boxing-bell", "bubble", "champagne", "cymbal", "handpan", "heartbeat",
    "ice", "instamatic", "mouse-click", "page", "sine-bass", "sine-high", "sine-low", "water-drop", "wind",
    // Active sessions from binaries that exposed the placeholder names remain recoverable.
    "soft-bowl", "wood-block", "bright-chime",
  )

  fun isValid(serialized: String): Boolean = runCatching {
    if (serialized.length > MAX_PROGRAM_CHARACTERS) return@runCatching false
    val root = JSONObject(serialized)
    if (root.optInt("schemaVersion", -1) != SCHEMA_VERSION) return@runCatching false
    when (root.optString("mode")) {
      "pattern" -> validatePattern(root)
      "sequence" -> validateSequence(root)
      else -> false
    }
  }.getOrDefault(false)

  fun next(serialized: String, anchor: Long, now: Long, startedAt: Long = anchor, fixedEndsAt: Long = 0L): TimerV2Event? = runCatching {
    val root = JSONObject(serialized)
    val endAt = fixedEndsAt.takeIf { it > 0L } ?: runEndAt(root, anchor, startedAt)
    if (endAt != null && now >= endAt) return@runCatching null
    val natural = when (root.optString("mode")) {
      "pattern" -> nextPattern(root, anchor, now)
      "sequence" -> nextSequence(root, anchor, now)
      else -> null
    }
    if (natural == null || endAt == null || natural.at < endAt) return@runCatching natural
    if (natural.at == endAt) {
      val custom = customCompletionCandidate(root)
      return@runCatching if (custom == null) natural.copy(completesRun = true) else natural.copy(
        candidates = listOf(custom),
        winner = custom,
        completesRun = true,
      )
    }
    val winner = completionCandidate(root) ?: return@runCatching null
    TimerV2Event(
      at = endAt,
      logicalId = "${root.optString("mode")}:$anchor:complete:$startedAt:$endAt",
      boundary = TimerV2Boundary.RUN_COMPLETE,
      candidates = listOf(winner),
      winner = winner,
      completesRun = true,
    )
  }.getOrNull()

  fun runEndAt(serialized: String, anchor: Long, startedAt: Long): Long? = runCatching {
    runEndAt(JSONObject(serialized), anchor, startedAt)
  }.getOrNull()

  fun iterationEnd(serialized: String, anchor: Long, now: Long, count: Int): TimerV2IterationEnd? = runCatching {
    val root = JSONObject(serialized)
    val iterations = count.coerceIn(1, 99)
    when (root.optString("mode")) {
      "pattern" -> {
        val duration = root.optInt("mainMinutes", 0).toLong() * MINUTE
        if (duration <= 0L) null else {
          val current = cycleAt(now, anchor, duration)
          val ending = current + iterations - 1
          TimerV2IterationEnd("pattern:$anchor:$ending:main", anchor + (ending + 1L) * duration)
        }
      }
      "sequence" -> {
        val steps = root.optJSONArray("steps") ?: return@runCatching null
        val duration = sequenceDuration(steps)
        if (duration <= 0L) null else {
          val current = cycleAt(now, anchor, duration)
          val ending = current + iterations - 1
          TimerV2IterationEnd("sequence:$anchor:$ending:step:${steps.length() - 1}", anchor + (ending + 1L) * duration)
        }
      }
      else -> null
    }
  }.getOrNull()

  /** Rebuilds a local-clock Pattern phase after timezone or wall-clock changes. */
  fun alignedAnchor(serialized: String, now: Long): Long? = runCatching {
    val root = JSONObject(serialized)
    if (root.optString("mode") != "pattern") return@runCatching null
    val alignment = root.optJSONObject("alignment") ?: return@runCatching null
    if (alignment.optString("kind") != "local-clock") return@runCatching null
    val mainMinutes = root.optInt("mainMinutes", 0)
    if (mainMinutes <= 0) return@runCatching null
    val calendar = Calendar.getInstance().apply { timeInMillis = now }
    val minuteOfDay = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    val offset = alignment.optInt("offsetMinutes", 0)
    val elapsedMinutes = ((minuteOfDay - offset) % mainMinutes + mainMinutes) % mainMinutes
    now - elapsedMinutes * MINUTE - calendar.get(Calendar.SECOND) * 1_000L - calendar.get(Calendar.MILLISECOND)
  }.getOrNull()

  fun isLocalClock(serialized: String): Boolean = runCatching {
    val root = JSONObject(serialized)
    root.optString("mode") == "pattern" && root.optJSONObject("alignment")?.optString("kind") == "local-clock"
  }.getOrDefault(false)

  fun cycleDuration(serialized: String): Long? = runCatching {
    val root = JSONObject(serialized)
    when (root.optString("mode")) {
      "pattern" -> root.optInt("mainMinutes", 0).toLong().times(MINUTE).takeIf { it > 0L }
      "sequence" -> sequenceDuration(root.optJSONArray("steps") ?: return@runCatching null).takeIf { it > 0L }
      else -> null
    }
  }.getOrNull()

  /** Main cue scalar used while a Pattern continuous alarm is already ringing. */
  fun mainCueVolume(serialized: String): Float = runCatching {
    val root = JSONObject(serialized)
    if (root.optString("mode") == "pattern") cueVolume(root.optJSONObject("mainCue")) else 1f
  }.getOrDefault(1f)

  fun mainCueSound(serialized: String): String = runCatching {
    val root = JSONObject(serialized)
    if (root.optString("mode") == "pattern") cueSound(root.optJSONObject("mainCue")) else "temple-gong"
  }.getOrDefault("temple-gong")

  /** Exact seasonal-offset boundary so local-clock patterns can realign even on pre-API 37 Android. */
  fun nextTimezoneTransition(now: Long): Long? {
    val timezone = TimeZone.getDefault()
    val currentOffset = timezone.getOffset(now)
    val horizon = now + TIMEZONE_TRANSITION_LOOKAHEAD_MS
    var before = now

    while (before < horizon) {
      val after = minOf(before + TIMEZONE_TRANSITION_SCAN_STEP_MS, horizon)
      if (timezone.getOffset(after) != currentOffset) {
        // Find the first millisecond with the new offset. A short scan step prevents
        // two real-world timezone transitions from being hidden between samples.
        var low = before
        var high = after
        while (high - low > 1L) {
          val midpoint = low + (high - low) / 2L
          if (timezone.getOffset(midpoint) == currentOffset) low = midpoint else high = midpoint
        }
        return high
      }
      before = after
    }
    return null
  }

  private fun nextPattern(root: JSONObject, anchor: Long, now: Long): TimerV2Event? {
    val mainMinutes = root.optInt("mainMinutes", 0)
    val duration = mainMinutes.toLong() * MINUTE
    if (duration <= 0L) return null
    val tracks = root.optJSONArray("tracks") ?: JSONArray()
    var cycle = cycleAt(now, anchor, duration)
    while (cycle < Long.MAX_VALUE / 2) {
      val start = anchor + cycle * duration
      val candidates = mutableMapOf<Long, MutableList<Candidate>>()
      candidates.getOrPut(start + duration) { mutableListOf() }.add(Candidate("main", "pattern-main", true, -1, cueSound(root.optJSONObject("mainCue")), cueVolume(root.optJSONObject("mainCue"))))
      for (trackIndex in 0 until tracks.length()) {
        val track = tracks.optJSONObject(trackIndex) ?: continue
        if (!track.optBoolean("enabled", true)) continue
        val offsets = track.optJSONArray("selectedOffsetsMinutes") ?: continue
        for (offsetIndex in 0 until offsets.length()) {
          val offset = offsets.optInt(offsetIndex, -1)
          if (offset <= 0 || offset >= mainMinutes) continue
          candidates.getOrPut(start + offset * MINUTE) { mutableListOf() }.add(Candidate(track.optString("id", "track:$trackIndex"), "pattern-track", false, trackIndex, cueSound(track), cueVolume(track)))
        }
      }
      val at = candidates.keys.filter { it > now }.minOrNull()
      if (at != null) {
        val items = candidates.getValue(at)
        val main = items.firstOrNull { it.main }
        val winner = main ?: items.minBy { it.trackOrder }
        val boundary = if (winner.main) "main" else "offset:${(at - start) / MINUTE}"
        val resolved = items.map { it.toPublic() }
        return TimerV2Event(
          at,
          "pattern:$anchor:$cycle:$boundary",
          if (winner.main) TimerV2Boundary.PATTERN_MAIN else TimerV2Boundary.PATTERN_OFFSET,
          resolved,
          winner.toPublic(),
        )
      }
      cycle += 1
    }
    return null
  }

  private fun nextSequence(root: JSONObject, anchor: Long, now: Long): TimerV2Event? {
    val steps = root.optJSONArray("steps") ?: return null
    val duration = sequenceDuration(steps)
    if (duration <= 0L) return null
    var cycle = cycleAt(now, anchor, duration)
    while (cycle < Long.MAX_VALUE / 2) {
      val start = anchor + cycle * duration
      var elapsed = 0L
      for (index in 0 until steps.length()) {
        val step = steps.optJSONObject(index) ?: continue
        elapsed += step.optInt("durationMinutes", 0).toLong() * MINUTE
        if (start + elapsed > now) {
          val winner = TimerV2Candidate(step.optString("id", "step:$index"), "sequence-step", cueSound(step), cueVolume(step))
          return TimerV2Event(
            start + elapsed,
            "sequence:$anchor:$cycle:step:$index",
            if (index == steps.length() - 1) TimerV2Boundary.SEQUENCE_CYCLE else TimerV2Boundary.SEQUENCE_STEP,
            listOf(winner),
            winner,
          )
        }
      }
      cycle += 1
    }
    return null
  }

  private fun sequenceDuration(steps: JSONArray): Long = (0 until steps.length()).sumOf { index -> steps.optJSONObject(index)?.optInt("durationMinutes", 0)?.toLong()?.times(MINUTE) ?: 0L }
  private fun cycleAt(now: Long, anchor: Long, duration: Long): Long = max(0L, Math.floorDiv(now - anchor, duration))
  private fun cueSound(cue: JSONObject?): String {
    val sound = cue?.optJSONObject("sound") ?: return "clear-bell"
    return if (sound.optString("kind") == "builtin") sound.optString("id", "clear-bell") else sound.optString("uri", "clear-bell")
  }
  private fun cueVolume(cue: JSONObject?): Float = cue?.optDouble("volume", 1.0)?.toFloat()?.coerceIn(0f, 1f) ?: 1f
  private data class Candidate(val cueId: String, val kind: String, val main: Boolean, val trackOrder: Int, val soundId: String, val volume: Float) {
    fun toPublic() = TimerV2Candidate(cueId, kind, soundId, volume, trackOrder.takeUnless { main })
  }

  private fun runEndAt(root: JSONObject, anchor: Long, startedAt: Long): Long? {
    val policy = root.optJSONObject("runPolicy") ?: return null
    return when (policy.optString("kind", "continuous")) {
      "duration" -> {
        val seconds = policy.optLong("durationSeconds", 0L)
        if (seconds !in 1L..MAX_RUN_DURATION_SECONDS || startedAt <= 0L || startedAt > Long.MAX_VALUE - seconds * 1_000L) null else startedAt + seconds * 1_000L
      }
      "cycles" -> {
        val count = policy.optInt("cycleCount", 0)
        val duration = when (root.optString("mode")) {
          "pattern" -> root.optInt("mainMinutes", 0).toLong() * MINUTE
          "sequence" -> sequenceDuration(root.optJSONArray("steps") ?: return null)
          else -> return null
        }
        if (count !in 1..MAX_RUN_CYCLES || duration <= 0L || startedAt <= 0L) return null
        val firstIndex = Math.floorDiv(startedAt - anchor, duration) + 1L
        val terminalIndex = firstIndex + count - 1L
        if (terminalIndex < 0L || terminalIndex > (Long.MAX_VALUE - anchor) / duration) null else anchor + terminalIndex * duration
      }
      else -> null
    }
  }

  private fun completionCandidate(root: JSONObject): TimerV2Candidate? {
    customCompletionCandidate(root)?.let { return it }
    return when (root.optString("mode")) {
      "pattern" -> TimerV2Candidate("completion", "run-complete", cueSound(root.optJSONObject("mainCue")), cueVolume(root.optJSONObject("mainCue")))
      "sequence" -> {
        val steps = root.optJSONArray("steps") ?: return null
        val step = steps.optJSONObject(steps.length() - 1) ?: return null
        TimerV2Candidate("completion", "run-complete", cueSound(step), cueVolume(step))
      }
      else -> null
    }
  }

  private fun customCompletionCandidate(root: JSONObject): TimerV2Candidate? {
    val cue = root.optJSONObject("completionCue") ?: return null
    return TimerV2Candidate("completion", "run-complete", cueSound(cue), cueVolume(cue))
  }

  private fun validOptionalCompletionCue(root: JSONObject): Boolean =
    !root.has("completionCue") || root.isNull("completionCue") || validCue(root.optJSONObject("completionCue"))

  private fun validatePattern(root: JSONObject): Boolean {
    val mainMinutes = root.optInt("mainMinutes", -1)
    if (mainMinutes !in 1..MAX_DURATION_MINUTES || !validCue(root.optJSONObject("mainCue")) || !validOptionalCompletionCue(root)) return false
    val tracks = root.optJSONArray("tracks") ?: return false
    if (tracks.length() > MAX_TRACKS) return false
    val trackIds = mutableSetOf<String>()
    for (index in 0 until tracks.length()) {
      val track = tracks.optJSONObject(index) ?: return false
      val trackId = track.optString("id")
      if (trackId.isBlank() || trackId.length > MAX_ID_CHARACTERS || !trackIds.add(trackId) || !validCue(track)) return false
      val cadence = track.optInt("cadenceMinutes", -1)
      if (cadence !in 1..MAX_DURATION_MINUTES) return false
      val offsets = track.optJSONArray("selectedOffsetsMinutes") ?: return false
      if (offsets.length() > MAX_DURATION_MINUTES - 1) return false
      val seenOffsets = mutableSetOf<Int>()
      for (offsetIndex in 0 until offsets.length()) {
        val offset = offsets.optInt(offsetIndex, -1)
        if (offset !in 1 until mainMinutes || offset % cadence != 0 || !seenOffsets.add(offset)) return false
      }
    }
    val alignment = root.optJSONObject("alignment") ?: return false
    val alignmentValid = when (alignment.optString("kind")) {
      "elapsed" -> true
      "local-clock" -> alignment.optInt("offsetMinutes", -1) in 0..59
      else -> false
    }
    return alignmentValid && validRunPolicy(root)
  }

  private fun validateSequence(root: JSONObject): Boolean {
    val steps = root.optJSONArray("steps") ?: return false
    if (steps.length() !in 1..MAX_STEPS) return false
    val stepIds = mutableSetOf<String>()
    for (index in 0 until steps.length()) {
      val step = steps.optJSONObject(index) ?: return false
      val id = step.optString("id")
      val label = step.optString("label")
      if (id.isBlank() || id.length > MAX_ID_CHARACTERS || !stepIds.add(id) || label.isBlank() || label.codePointCount(0, label.length) > 60 || step.optInt("durationMinutes", -1) !in 1..MAX_DURATION_MINUTES || !validCue(step)) return false
    }
    return validOptionalCompletionCue(root) && validRunPolicy(root)
  }

  private fun validRunPolicy(root: JSONObject): Boolean {
    val policy = root.optJSONObject("runPolicy") ?: return true // pre-feature V2 sessions are continuous
    val cycleCount = policy.optInt("cycleCount", -1)
    val durationSeconds = policy.optLong("durationSeconds", -1L)
    if (cycleCount !in 1..MAX_RUN_CYCLES || durationSeconds !in 1L..MAX_RUN_DURATION_SECONDS) return false
    return policy.optString("kind") in setOf("continuous", "cycles", "duration")
  }

  private fun validCue(cue: JSONObject?): Boolean {
    cue ?: return false
    val volume = cue.optDouble("volume", Double.NaN)
    if (!volume.isFinite() || volume !in 0.0..1.0) return false
    val sound = cue.optJSONObject("sound") ?: return false
    return when (sound.optString("kind")) {
      "builtin" -> sound.optString("id") in builtInSoundIds
      "android", "document" -> {
        val uri = sound.optString("uri")
        val title = sound.optString("title")
        uri.isNotBlank() && uri.length <= MAX_URI_CHARACTERS && title.isNotBlank() && title.codePointCount(0, title.length) <= 60
      }
      else -> false
    }
  }
}
