package expo.modules.chandastimerservice

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
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
data class TimerV2SkipTarget(val anchor: Long, val startedAt: Long, val endsAt: Long, val completesRun: Boolean)

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
  val alarmEnabled: Boolean = false,
  val soundId: String,
  val volume: Float,
  /** False delivers the cue through haptics only, retaining its selected sound. */
  val soundEnabled: Boolean = true,
  /** Schema v3 keeps the legacy primary sound first for old readers. */
  val soundIds: List<String> = listOf(soundId),
  val soundMode: String = "single",
  /** Null inherits the main/sub-bell profile; false explicitly silences vibration. */
  val hapticOverride: HapticProfileConfig? = null,
  val hapticsOff: Boolean = false,
  val cadenceMinutes: Int? = null,
  val cadenceSeconds: Long? = null,
  val trackOrder: Int? = null,
)

/** User-facing identity of the interval that contains [now]. */
data class TimerV2NotificationContext(
  val label: String,
  val compactIdentity: String,
  val currentEndsAt: Long = 0L,
)

/** Native mirror of src/lib/timeline.ts. It intentionally schedules only one future event. */
object TimerV2Timeline {
  private const val MINUTE = 60_000L
  private const val TIMEZONE_TRANSITION_SCAN_STEP_MS = 6L * 60L * 60L * 1_000L
  private const val TIMEZONE_TRANSITION_LOOKAHEAD_MS = 5L * 366L * 24L * 60L * 60L * 1_000L
  private const val SCHEMA_VERSION = NativeTimerContract.PROGRAM_SCHEMA_MAX
  private const val MAX_TRACKS = NativeTimerContract.MAX_PATTERN_TRACKS
  private const val MAX_STEPS = NativeTimerContract.MAX_SEQUENCE_STEPS
  private const val MAX_DURATION_MINUTES = NativeTimerContract.MAX_CUE_DURATION_MINUTES
  private const val MAX_DURATION_SECONDS = NativeTimerContract.MAX_CUE_DURATION_SECONDS
  private const val MAX_RUN_CYCLES = NativeTimerContract.MAX_RUN_CYCLES
  private const val MAX_RUN_DURATION_SECONDS = NativeTimerContract.MAX_RUN_DURATION_SECONDS
  private const val MAX_PROGRAM_CHARACTERS = NativeTimerContract.MAX_PROGRAM_CHARACTERS
  private const val MAX_ID_CHARACTERS = 200
  private const val MAX_URI_CHARACTERS = 8_192

  fun isValid(serialized: String): Boolean = runCatching {
    if (serialized.length > MAX_PROGRAM_CHARACTERS) return@runCatching false
    val root = JSONObject(serialized)
    if (root.optInt("schemaVersion", -1) !in NativeTimerContract.PROGRAM_SCHEMA_MIN..SCHEMA_VERSION) return@runCatching false
    when (root.optString("mode")) {
      "pattern" -> validatePattern(root)
      "sequence" -> validateSequence(root)
      else -> false
    }
  }.getOrDefault(false)

  fun isSequence(serialized: String): Boolean = runCatching { JSONObject(serialized).optString("mode") == "sequence" }.getOrDefault(false)

  fun next(serialized: String, anchor: Long, now: Long, startedAt: Long = anchor, fixedEndsAt: Long = 0L, randomSeed: Long = anchor, visibleOnly: Boolean = false): TimerV2Event? = runCatching {
    val root = JSONObject(serialized)
    val endAt = fixedEndsAt.takeIf { it > 0L } ?: runEndAt(root, anchor, startedAt)
    if (endAt != null && now >= endAt) return@runCatching null
    val natural = when (root.optString("mode")) {
      "pattern" -> nextPattern(root, anchor, now, randomSeed, visibleOnly)
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

  /** Persisted deadlines must be exactly the deadline implied by the run policy. */
  fun hasMatchingRunEnd(serialized: String, anchor: Long, startedAt: Long, fixedEndsAt: Long): Boolean =
    runEndAt(serialized, anchor, startedAt) == fixedEndsAt.takeIf { it > 0L }

  fun iterationEnd(serialized: String, anchor: Long, now: Long, count: Int): TimerV2IterationEnd? = runCatching {
    val root = JSONObject(serialized)
    val iterations = count.coerceIn(1, NativeTimerContract.MAX_MUTE_ITERATIONS)
    when (root.optString("mode")) {
      "pattern" -> {
        val duration = patternDuration(root)
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

  /** Rebuilds a whole-program local-clock phase after timezone or wall-clock changes. */
  fun alignedAnchor(serialized: String, now: Long): Long? = runCatching {
    val root = JSONObject(serialized)
    val alignment = root.optJSONObject("alignment") ?: return@runCatching null
    if (alignment.optString("kind") != "local-clock") return@runCatching null
    val duration = cycleDuration(root)
    if (duration <= 0L) return@runCatching null
    val calendar = Calendar.getInstance().apply { timeInMillis = now }
    val localTimeOfDay = (((calendar.get(Calendar.HOUR_OF_DAY) * 60L + calendar.get(Calendar.MINUTE)) * 60L + calendar.get(Calendar.SECOND)) * 1_000L) + calendar.get(Calendar.MILLISECOND)
    val phase = alignment.optInt("offsetMinutes", 0).toLong() * MINUTE
    now - Math.floorMod(localTimeOfDay - phase, duration)
  }.getOrNull()

  fun isLocalClock(serialized: String): Boolean = runCatching {
    val root = JSONObject(serialized)
    cycleDuration(root) > 0L && root.optJSONObject("alignment")?.optString("kind") == "local-clock"
  }.getOrDefault(false)

  /** Pause leaves wall-clock alignment without changing the realized timeline. */
  fun elapsedAlignment(serialized: String): String? = runCatching {
    if (!isLocalClock(serialized)) return@runCatching serialized
    val root = JSONObject(serialized).put("alignment", JSONObject().put("kind", "elapsed"))
    root.toString().takeIf { isValid(it) }
  }.getOrNull()

  /** Presentation countdown only. Hidden sub-bells remain in the audible scheduler. */
  fun nextVisible(serialized: String, anchor: Long, now: Long, startedAt: Long = anchor, fixedEndsAt: Long = 0L, randomSeed: Long = anchor): TimerV2Event? =
    next(serialized, anchor, now, startedAt, fixedEndsAt, randomSeed, visibleOnly = true)

  fun cycleDuration(serialized: String): Long? = runCatching {
    val root = JSONObject(serialized)
    cycleDuration(root).takeIf { it > 0L }
  }.getOrNull()

  /** Native mirror of sequenceSkipTarget; the caller commits this as one transaction. */
  fun skipSequenceTarget(serialized: String, anchor: Long, now: Long, startedAt: Long, endsAt: Long, direction: Int): TimerV2SkipTarget? = runCatching {
    val root = JSONObject(serialized)
    if (root.optString("mode") != "sequence") return@runCatching null
    val steps = root.optJSONArray("steps") ?: return@runCatching null
    if (steps.length() < 2 || direction == 0) return@runCatching null
    val offsets = mutableListOf<Long>()
    var total = 0L
    for (index in 0 until steps.length()) {
      val step = steps.optJSONObject(index) ?: return@runCatching null
      total += if (step.has("durationSeconds")) step.optLong("durationSeconds") * 1_000L else step.optLong("durationMinutes") * 60_000L
      offsets.add(total)
    }
    if (total <= 0L) return@runCatching null
    val position = Math.floorMod(now - anchor, total)
    val index = offsets.indexOfFirst { position < it }.takeIf { it >= 0 } ?: return@runCatching null
    val cycle = Math.floorDiv(now - anchor, total)
    if (direction < 0 && index == 0 && cycle == 0L && endsAt > 0L) return@runCatching null
    if (direction > 0 && index == steps.length() - 1 && endsAt > 0L && next(serialized, anchor, now, startedAt, endsAt)?.completesRun == true) {
      return@runCatching TimerV2SkipTarget(anchor, startedAt, endsAt, true)
    }
    val target = Math.floorMod(index + if (direction > 0) 1 else -1, steps.length())
    val targetCycle = if (direction > 0 && target == 0) cycle + 1L else if (direction < 0 && index == 0 && cycle > 0L) cycle - 1L else cycle
    val before = if (target == 0) 0L else offsets[target - 1]
    val nextAnchor = now - targetCycle * total - before
    val delta = nextAnchor - anchor
    val cycleBounded = root.optJSONObject("runPolicy")?.optString("kind") == "cycles"
    TimerV2SkipTarget(nextAnchor, if (cycleBounded) startedAt + delta else startedAt, if (cycleBounded && endsAt > 0L) endsAt + delta else endsAt, false)
  }.getOrNull()

  private fun cycleDuration(root: JSONObject): Long = when (root.optString("mode")) {
    "pattern" -> patternDuration(root)
    "sequence" -> root.optJSONArray("steps")?.let(::sequenceDuration) ?: 0L
    else -> 0L
  }

  /** Main cue scalar used while a Pattern continuous alarm is already ringing. */
  fun mainCueVolume(serialized: String): Float = runCatching {
    val root = JSONObject(serialized)
    if (root.optString("mode") == "pattern") cueVolume(root.optJSONObject("mainCue")) else 1f
  }.getOrDefault(1f)

  fun mainCueSound(serialized: String): String = runCatching {
    val root = JSONObject(serialized)
    if (root.optString("mode") == "pattern") cueSound(root.optJSONObject("mainCue")) else "temple-gong"
  }.getOrDefault("temple-gong")

  /** Short, user-authored heading for the system's expanded running notification. */
  fun notificationTitle(serialized: String): String? = runCatching {
    val root = JSONObject(serialized)
    when (root.optString("mode")) {
      "pattern" -> root.optString("label").trim().takeIf { it.isNotEmpty() && it.codePointCount(0, it.length) <= 60 }
      "sequence" -> "Chandas sequence"
      else -> null
    }
  }.getOrNull()

  /**
   * Resolves the interval that is currently in progress, rather than the cue
   * returned by [next]. Sequence cues mark the end of their corresponding
   * steps, so deriving this from the next cue would be ambiguous at a boundary.
   */
  fun notificationContext(serialized: String, anchor: Long, now: Long): TimerV2NotificationContext? = runCatching {
    val root = JSONObject(serialized)
    when (root.optString("mode")) {
      "pattern" -> {
        val label = root.optString("label").trim().ifEmpty { "Main interval" }
        val duration = patternDuration(root)
        TimerV2NotificationContext(label, "", anchor + (cycleAt(now, anchor, duration) + 1L) * duration)
      }
      "sequence" -> currentSequenceContext(root.optJSONArray("steps") ?: return@runCatching null, anchor, now)
      else -> null
    }
  }.getOrNull()

  /** Exact seasonal-offset boundary so local-clock patterns can realign even on pre-API 37 Android. */
  fun nextTimezoneTransition(now: Long, horizon: Long = now + TIMEZONE_TRANSITION_LOOKAHEAD_MS): Long? {
    val timezone = TimeZone.getDefault()
    val currentOffset = timezone.getOffset(now)
    if (horizon <= now) return null
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

  /** Next civil midnight; used as an explicit daily local-clock re-phasing sentinel. */
  fun nextLocalDateBoundary(now: Long): Long = Calendar.getInstance().apply {
    timeInMillis = now
    add(Calendar.DAY_OF_MONTH, 1)
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
  }.timeInMillis

  private fun nextPattern(root: JSONObject, anchor: Long, now: Long, randomSeed: Long, visibleOnly: Boolean): TimerV2Event? {
    val duration = patternDuration(root)
    if (duration <= 0L) return null
    val tracks = root.optJSONArray("tracks") ?: JSONArray()
    var cycle = cycleAt(now, anchor, duration)
    while (cycle < Long.MAX_VALUE / 2) {
      val start = anchor + cycle * duration
      val candidates = mutableMapOf<Long, MutableList<Candidate>>()
      candidates.getOrPut(start + duration) { mutableListOf() }.add(Candidate("main", "pattern-main", true, -1, 0L, root.optJSONObject("mainCue")))
      for (trackIndex in 0 until tracks.length()) {
        val track = tracks.optJSONObject(trackIndex) ?: continue
        if (!track.optBoolean("enabled", true) || (visibleOnly && !track.optBoolean("showOnWatchFace", true))) continue
        val exactOffsets = track.has("selectedOffsetsSeconds")
        val offsets = track.optJSONArray(if (exactOffsets) "selectedOffsetsSeconds" else "selectedOffsetsMinutes") ?: JSONArray()
        val cadenceSeconds = if (track.has("cadenceSeconds")) track.optLong("cadenceSeconds", 0L) else track.optInt("cadenceMinutes", 0).toLong() * 60L
        val selected = mutableSetOf<Long>()
        if (track.optBoolean("repeatEnabled", true)) for (offsetIndex in 0 until offsets.length()) {
          val offsetSeconds = offsets.optLong(offsetIndex, -1L) * if (exactOffsets) 1L else 60L
          if (offsetSeconds > 0L && offsetSeconds * 1_000L < duration) selected.add(offsetSeconds)
        }
        track.optLong("afterStartSeconds", -1L).takeIf { it > 0L && it * 1_000L < duration }?.let(selected::add)
        track.optLong("beforeEndSeconds", -1L).takeIf { it > 0L && it * 1_000L < duration }?.let { selected.add(duration / 1_000L - it) }
        track.optJSONObject("randomRepeat")?.let { range ->
          val minimum = range.optLong("minSeconds", 10L)
          val maximum = range.optLong("maxSeconds", 60L)
          var seed = (randomSeed.toInt() xor cycle.toInt())
          for (character in track.optString("id")) seed = seed * 31 + character.code
          var offset = 0L
          var count = 0
          while (offset < duration / 1_000L && count < 4_096) {
            seed = seed * 1_664_525 + 1_013_904_223
            offset += minimum + ((seed.toLong() and 0xffff_ffffL) % (maximum - minimum + 1L))
            if (offset * 1_000L < duration) selected.add(offset)
            count++
          }
        }
        val priorityCadence = if (track.optBoolean("repeatEnabled", true)) cadenceSeconds else 0L
        selected.forEach { offsetSeconds ->
          candidates.getOrPut(start + offsetSeconds * 1_000L) { mutableListOf() }.add(Candidate(track.optString("id", "track:$trackIndex"), "pattern-track", false, trackIndex, priorityCadence, track))
        }
      }
      val at = candidates.keys.filter { it > now }.minOrNull()
      if (at != null) {
        val items = candidates.getValue(at)
        val main = items.firstOrNull { it.main }
        val winner = main ?: items.sortedWith(compareByDescending<Candidate> { it.cadenceSeconds }.thenBy { it.trackOrder }).first()
        val offsetSeconds = (at - start) / 1_000L
        val boundary = if (winner.main) "main" else if (offsetSeconds % 60L == 0L) "offset:${offsetSeconds / 60L}" else "offset-seconds:$offsetSeconds"
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
        elapsed += stepDuration(step)
        if (start + elapsed > now) {
          val winner = cueCandidate(step.optString("id", "step:$index"), "sequence-step", step)
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

  private fun currentSequenceContext(steps: JSONArray, anchor: Long, now: Long): TimerV2NotificationContext? {
    val duration = sequenceDuration(steps)
    if (duration <= 0L || steps.length() == 0) return null
    val cycle = cycleAt(now, anchor, duration)
    val elapsed = if (now <= anchor) 0L else Math.floorMod(now - anchor, duration)
    var stepEnd = 0L
    for (index in 0 until steps.length()) {
      val step = steps.optJSONObject(index) ?: continue
      stepEnd += stepDuration(step)
      if (elapsed < stepEnd) {
        val label = step.optString("label").trim().ifEmpty { "Step ${index + 1}" }
        return TimerV2NotificationContext(label, compactLabel(label, 4), anchor + cycle * duration + stepEnd)
      }
    }
    return null
  }

  private fun patternDuration(root: JSONObject): Long = if (root.has("mainDurationSeconds")) root.optLong("mainDurationSeconds", 0L) * 1_000L else root.optInt("mainMinutes", 0).toLong() * MINUTE
  private fun stepDuration(step: JSONObject): Long = if (step.has("durationSeconds")) step.optLong("durationSeconds", 0L) * 1_000L else step.optInt("durationMinutes", 0).toLong() * MINUTE
  private fun sequenceDuration(steps: JSONArray): Long = (0 until steps.length()).sumOf { index -> steps.optJSONObject(index)?.let(::stepDuration) ?: 0L }
  private fun cycleAt(now: Long, anchor: Long, duration: Long): Long = max(0L, Math.floorDiv(now - anchor, duration))
  private fun cueSound(cue: JSONObject?): String {
    val sound = cue?.optJSONObject("sound") ?: return "clear-bell"
    return if (sound.optString("kind") == "builtin") sound.optString("id", "clear-bell") else sound.optString("uri", "clear-bell")
  }
  private fun cueVolume(cue: JSONObject?): Float = cue?.optDouble("volume", 1.0)?.toFloat()?.coerceIn(0f, 1f) ?: 1f
  private fun compactLabel(value: String, count: Int): String {
    if (count <= 0 || value.isEmpty()) return ""
    val end = value.offsetByCodePoints(0, minOf(count, value.codePointCount(0, value.length)))
    return value.substring(0, end)
  }
  private fun cueSoundIds(cue: JSONObject?): List<String> {
    val primary = cueSound(cue)
    val sounds = cue?.optJSONArray("sounds") ?: return listOf(primary)
    val values = mutableListOf<String>()
    for (index in 0 until sounds.length()) cueSoundFromRef(sounds.optJSONObject(index))?.let(values::add)
    return (values.ifEmpty { listOf(primary) }).distinct()
  }
  private fun cueSoundFromRef(sound: JSONObject?): String? = when (sound?.optString("kind")) {
    "builtin" -> sound.optString("id").takeIf(TimerSoundIds::isValid)
    "android", "document" -> sound.optString("uri").takeIf { it.isNotBlank() && TimerSoundSource.isPersistentUri(sound.optString("kind"), it) }
    else -> null
  }
  private fun cueCandidate(cueId: String, kind: String, cue: JSONObject?): TimerV2Candidate {
    val sounds = cueSoundIds(cue)
    val rawOverride = cue?.opt("hapticOverride")
    val off = rawOverride == "off"
    val override = (rawOverride as? JSONObject)?.let { HapticProfileConfig.normalized(it.optString("pattern", "single"), it.optString("strength", "balanced"), HapticProfileConfig("single", "balanced")) }
    val rawMode = if (cue == null) "single" else cue.optString("soundMode", "single")
    val mode = if (rawMode == "single" || rawMode == "sequence" || rawMode == "random") rawMode else "single"
    val soundEnabled = cue?.optBoolean("soundEnabled", true) ?: true
    return TimerV2Candidate(
      cueId = cueId,
      kind = kind,
      alarmEnabled = kind == "sequence-step" && cue?.optBoolean("alarmEnabled", false) == true,
      soundId = sounds.first(),
      volume = cueVolume(cue),
      soundEnabled = soundEnabled,
      soundIds = sounds,
      soundMode = if (sounds.size > 1) mode else "single",
      hapticOverride = override,
      hapticsOff = off,
    )
  }
  private data class Candidate(val cueId: String, val kind: String, val main: Boolean, val trackOrder: Int, val cadenceSeconds: Long, val cue: JSONObject?) {
    fun toPublic(): TimerV2Candidate {
      val base = cueCandidate(cueId, kind, cue)
      return base.copy(cadenceMinutes = ((cadenceSeconds + 59L) / 60L).toInt().takeUnless { main }, cadenceSeconds = cadenceSeconds.takeUnless { main }, trackOrder = trackOrder.takeUnless { main })
    }
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
          "pattern" -> patternDuration(root)
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
      "pattern" -> cueCandidate("completion", "run-complete", root.optJSONObject("mainCue"))
      "sequence" -> {
        val steps = root.optJSONArray("steps") ?: return null
        val step = steps.optJSONObject(steps.length() - 1) ?: return null
        cueCandidate("completion", "run-complete", step)
      }
      else -> null
    }
  }

  private fun customCompletionCandidate(root: JSONObject): TimerV2Candidate? {
    val cue = root.optJSONObject("completionCue") ?: return null
    return cueCandidate("completion", "run-complete", cue)
  }

  private fun validOptionalCompletionCue(root: JSONObject): Boolean =
    !root.has("completionCue") || root.isNull("completionCue") || validCue(root.optJSONObject("completionCue"))

  private fun validatePattern(root: JSONObject): Boolean {
    val mainMinutes = root.optInt("mainMinutes", -1)
    val mainDurationSeconds = if (root.has("mainDurationSeconds")) root.optLong("mainDurationSeconds", -1L) else mainMinutes.toLong() * 60L
    val label = root.optString("label")
    if (root.has("label") && (label.isBlank() || label.codePointCount(0, label.length) > 60)) return false
    if (mainMinutes !in 1..MAX_DURATION_MINUTES || mainDurationSeconds !in 1L..MAX_DURATION_SECONDS || mainMinutes != ((mainDurationSeconds + 59L) / 60L).toInt() || !validCue(root.optJSONObject("mainCue")) || !validOptionalCompletionCue(root)) return false
    val tracks = root.optJSONArray("tracks") ?: return false
    if (tracks.length() > MAX_TRACKS) return false
    val trackIds = mutableSetOf<String>()
    for (index in 0 until tracks.length()) {
      val track = tracks.optJSONObject(index) ?: return false
      val trackId = track.optString("id")
      if (trackId.isBlank() || trackId.length > MAX_ID_CHARACTERS || !trackIds.add(trackId) || !validCue(track)) return false
      val cadence = track.optInt("cadenceMinutes", -1)
      val hasExactCadence = track.has("cadenceSeconds")
      val hasExactOffsets = track.has("selectedOffsetsSeconds")
      if (hasExactCadence != hasExactOffsets) return false
      val cadenceSeconds = if (hasExactCadence) track.optLong("cadenceSeconds", -1L) else cadence.toLong() * 60L
      if (cadence !in 1..MAX_DURATION_MINUTES || cadenceSeconds !in 1L..MAX_DURATION_SECONDS || cadence != ((cadenceSeconds + 59L) / 60L).toInt()) return false
      val offsets = track.optJSONArray(if (hasExactOffsets) "selectedOffsetsSeconds" else "selectedOffsetsMinutes") ?: return false
      if (offsets.length().toLong() > MAX_DURATION_SECONDS - 1L) return false
      val seenOffsets = mutableSetOf<Long>()
      for (offsetIndex in 0 until offsets.length()) {
        val storedOffset = offsets.optLong(offsetIndex, -1L)
        val offsetSeconds = storedOffset * if (hasExactOffsets) 1L else 60L
        if (offsetSeconds < 1L || offsetSeconds >= mainDurationSeconds || offsetSeconds % cadenceSeconds != 0L || !seenOffsets.add(offsetSeconds)) return false
      }
      val afterStart = track.optLong("afterStartSeconds", -1L)
      val beforeEnd = track.optLong("beforeEndSeconds", -1L)
      // Preserve valid positive marker intent when a user later shortens the
      // main interval. Compilation omits markers outside the current cycle;
      // rejecting the whole program would make an unrelated edit unstartable.
      if (track.has("afterStartSeconds") && afterStart < 1L) return false
      if (track.has("beforeEndSeconds") && beforeEnd < 1L) return false
      track.optJSONObject("randomRepeat")?.let { range ->
        val minimum = range.optLong("minSeconds", -1L)
        val maximum = range.optLong("maxSeconds", -1L)
        if (minimum !in 5L..MAX_DURATION_SECONDS || maximum !in minimum..MAX_DURATION_SECONDS) return false
      }
      if (track.has("randomRepeat") && track.optJSONObject("randomRepeat") == null) return false
    }
    return validAlignment(root, required = true) && validRunPolicy(root)
  }

  private fun validateSequence(root: JSONObject): Boolean {
    val steps = root.optJSONArray("steps") ?: return false
    if (steps.length() !in 1..MAX_STEPS) return false
    val stepIds = mutableSetOf<String>()
    for (index in 0 until steps.length()) {
      val step = steps.optJSONObject(index) ?: return false
      val id = step.optString("id")
      val label = step.optString("label")
      val durationMinutes = step.optInt("durationMinutes", -1)
      val durationSeconds = if (step.has("durationSeconds")) step.optLong("durationSeconds", -1L) else durationMinutes.toLong() * 60L
      if (id.isBlank() || id.length > MAX_ID_CHARACTERS || !stepIds.add(id) || label.isBlank() || label.codePointCount(0, label.length) > 60 || durationMinutes !in 1..MAX_DURATION_MINUTES || durationSeconds !in 1L..MAX_DURATION_SECONDS || durationMinutes != ((durationSeconds + 59L) / 60L).toInt() || !validCue(step)) return false
    }
    return sequenceDuration(steps) in 1L..NativeTimerContract.MAX_PROGRAM_CYCLE_MS && validAlignment(root, required = false) && validOptionalCompletionCue(root) && validRunPolicy(root)
  }

  private fun validAlignment(root: JSONObject, required: Boolean): Boolean {
    if (!root.has("alignment")) return !required
    val alignment = root.optJSONObject("alignment") ?: return false
    return when (alignment.optString("kind")) {
      "elapsed" -> true
      "local-clock" -> alignment.optInt("offsetMinutes", -1) in 0..59
      else -> false
    }
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
    val primaryValid = when (sound.optString("kind")) {
      "builtin" -> TimerSoundIds.isValid(sound.optString("id"))
      "android", "document" -> {
        val uri = sound.optString("uri")
        val title = sound.optString("title")
        uri.isNotBlank() &&
          uri.length <= MAX_URI_CHARACTERS &&
          TimerSoundSource.isPersistentUri(sound.optString("kind"), uri) &&
          title.isNotBlank() &&
          title.codePointCount(0, title.length) <= 60
      }
      else -> false
    }
    if (!primaryValid) return false
    if (cue.has("sounds")) {
      val sounds = cue.optJSONArray("sounds") ?: return false
      if (sounds.length() < 1) return false
      val seen = mutableSetOf<String>()
      for (index in 0 until sounds.length()) {
        val value = cueSoundFromRef(sounds.optJSONObject(index)) ?: return false
        if (!seen.add(value)) return false
      }
    }
    if (cue.has("soundMode") && cue.optString("soundMode") !in setOf("single", "sequence", "random")) return false
    if (cue.has("soundEnabled") && cue.opt("soundEnabled") !is Boolean) return false
    if (cue.has("hapticOverride") && !cue.isNull("hapticOverride")) {
      val override = cue.opt("hapticOverride")
      if (override != "off") {
        val profile = override as? JSONObject ?: return false
        if (profile.optString("pattern") !in setOf("single", "double", "triple") || profile.optString("strength") !in setOf("gentle", "balanced", "strong")) return false
      }
    }
    return true
  }
}
