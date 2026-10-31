package expo.modules.chandastimerservice

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.max

data class UnifiedTimelineCandidate(
  val cueId: String,
  val sourceCueId: String,
  val stepId: String,
  val trackId: String?,
  val kind: String,
  val alarmEnabled: Boolean,
  val soundId: String,
  val volume: Float,
  val soundIds: List<String>,
  val soundMode: String,
  val hapticOverride: HapticProfileConfig?,
  val hapticsOff: Boolean,
  val showOnWatchFace: Boolean,
  val cadenceSeconds: Long?,
  val cadencePriority: Long,
  val trackOrder: Int?,
)

data class UnifiedTimelineEvent(
  val at: Long,
  val logicalId: String,
  val roundIndex: Long,
  val cycleIndex: Long,
  val stepIndex: Int,
  val stepId: String,
  val offsetSeconds: Long?,
  val boundary: String,
  val isRoundEnd: Boolean,
  val candidates: List<UnifiedTimelineCandidate>,
  val winner: UnifiedTimelineCandidate,
  val collision: Boolean,
  val completesRun: Boolean,
  val showOnWatchFace: Boolean,
)

data class UnifiedTimelinePosition(
  val anchor: Long,
  val randomSeed: Long,
  val roundIndex: Long,
  val cycleIndex: Long,
  val roundProgress: Float,
  val currentStepIndex: Int,
  val currentStepId: String,
  val stepProgress: Float,
  val nextEvent: UnifiedTimelineEvent?,
)

data class UnifiedTimelineIterationEnd(val logicalId: String, val at: Long, val iterations: Int)
data class UnifiedTimelineSkipTarget(val anchor: Long, val startedAt: Long, val terminalAt: Long?, val completesRun: Boolean)

/** Schema-4 timing mirror for src/lib/unified-timeline.ts; not used to negotiate native support yet. */
object UnifiedTimerTimeline {
  private const val SECOND = 1_000L
  private const val MAX_STEPS = 20
  private const val MAX_TRACKS = 5
  private const val MAX_DURATION_SECONDS = 14_400L
  private const val MAX_RUN_CYCLES = 999
  private const val MAX_RUN_DURATION_SECONDS = 359L * 3_600L + 59L * 60L + 59L
  private const val MAX_PROGRAM_CYCLE_MS = NativeTimerContract.MAX_PROGRAM_CYCLE_MS
  private const val MAX_ITERATIONS = 99
  private const val MAX_RANDOM_EVENTS = 4_096
  private const val MAX_ID_CHARACTERS = 200
  private val BUILTIN_SOUND_IDS = setOf("alarm-tone", "temple-gong", "clear-bell", "bloom", "boxing-bell", "bubble", "champagne", "cymbal", "handpan", "heartbeat", "ice", "instamatic", "mouse-click", "page", "sine-bass", "sine-high", "sine-low", "water-drop", "wind")

  fun isValid(serialized: String): Boolean = runCatching {
    if (serialized.length > NativeTimerContract.MAX_PROGRAM_CHARACTERS) return@runCatching false
    val root = JSONObject(serialized)
    if (exactLong(root, "schemaVersion") != 4L || root.opt("mode") != "unified") return@runCatching false
    val steps = root.optJSONArray("steps") ?: return@runCatching false
    if (steps.length() !in 1..MAX_STEPS || !root.has("completionCue") || !root.has("runPolicy") || !validRunPolicy(root.optJSONObject("runPolicy"))) return@runCatching false
    val alignment = root.optJSONObject("alignment") ?: return@runCatching false
    val alignmentKind = alignment.opt("kind") as? String ?: return@runCatching false
    if (alignmentKind !in setOf("elapsed", "local-clock") || (alignmentKind == "local-clock" && (exactLong(alignment, "offsetMinutes") ?: return@runCatching false) !in 0L..59L)) return@runCatching false
    if (!root.isNull("completionCue") && root.has("completionCue") && !validCue(root.optJSONObject("completionCue"))) return@runCatching false
    val ids = mutableSetOf<String>()
    var total = 0L
    for (index in 0 until steps.length()) {
      val step = steps.optJSONObject(index) ?: return@runCatching false
      val id = step.opt("id") as? String ?: return@runCatching false
      val label = step.opt("label") as? String ?: return@runCatching false
      val duration = exactLong(step, "durationSeconds") ?: return@runCatching false
      if (!validId(id) || !ids.add(id) || !step.has("label") || label.codePointCount(0, label.length) > 60 || duration !in 1L..MAX_DURATION_SECONDS || !validBoolean(step, "endAlarmEnabled") || !validBoolean(step, "subBellsEnabled") || !validCue(step.optJSONObject("endCue")) || (step.has("labelIsCustom") && !validBoolean(step, "labelIsCustom"))) return@runCatching false
      total += duration * SECOND
      val tracks = step.optJSONArray("subBellTracks") ?: return@runCatching false
      if (tracks.length() > MAX_TRACKS) return@runCatching false
      val trackIds = mutableSetOf<String>()
      for (trackIndex in 0 until tracks.length()) {
        val track = tracks.optJSONObject(trackIndex) ?: return@runCatching false
        val trackId = track.opt("id") as? String ?: return@runCatching false
        val cadence = exactLong(track, "cadenceSeconds") ?: return@runCatching false
        val label = track.opt("label") as? String ?: return@runCatching false
        if (!validId(trackId) || !trackIds.add(trackId) || !track.has("label") || label.codePointCount(0, label.length) > 60 || cadence !in 1L..MAX_DURATION_SECONDS || !validCue(track) || !validBoolean(track, "enabled") || !validBoolean(track, "showOnWatchFace") || !validBoolean(track, "repeatEnabled")) return@runCatching false
        if (track.has("color") && (track.opt("color") as? String)?.let { it in setOf("violet", "blue", "cyan", "teal", "green", "lime", "amber", "orange", "coral", "rose") } != true) return@runCatching false
        val offsets = track.optJSONArray("selectedOffsetsSeconds") ?: return@runCatching false
        for (offsetIndex in 0 until offsets.length()) if (exactLong(offsets, offsetIndex)?.let { it in 1L..MAX_DURATION_SECONDS } != true) return@runCatching false
        if (track.has("afterStartSeconds") && exactLong(track, "afterStartSeconds")?.let { it in 1L..MAX_DURATION_SECONDS } != true) return@runCatching false
        if (track.has("beforeEndSeconds") && exactLong(track, "beforeEndSeconds")?.let { it in 1L..MAX_DURATION_SECONDS } != true) return@runCatching false
        val random = track.optJSONObject("randomRepeat")
        if (track.has("randomRepeat") && random == null) return@runCatching false
        if (random != null) {
          val minimum = exactLong(random, "minSeconds") ?: return@runCatching false
          val maximum = exactLong(random, "maxSeconds") ?: return@runCatching false
          if (minimum !in 5L..MAX_DURATION_SECONDS || maximum !in minimum..MAX_DURATION_SECONDS) return@runCatching false
        }
      }
    }
    total in 1L..MAX_PROGRAM_CYCLE_MS
  }.getOrDefault(false)

  fun roundDuration(serialized: String): Long? = runCatching { duration(JSONObject(serialized)) }.getOrNull()?.takeIf { it > 0L }

  fun alignedAnchor(serialized: String, now: Long): Long? = runCatching {
    val root = JSONObject(serialized)
    val alignment = root.optJSONObject("alignment") ?: return@runCatching null
    if (alignment.optString("kind") != "local-clock") return@runCatching null
    val length = duration(root)
    if (length <= 0L) return@runCatching null
    val calendar = Calendar.getInstance().apply { timeInMillis = now }
    val localMs = (((calendar.get(Calendar.HOUR_OF_DAY) * 60L + calendar.get(Calendar.MINUTE)) * 60L + calendar.get(Calendar.SECOND)) * 1_000L) + calendar.get(Calendar.MILLISECOND)
    val phase = alignment.optInt("offsetMinutes", 0).toLong() * 60_000L
    now - Math.floorMod(localMs - phase, length)
  }.getOrNull()

  fun runEndAt(serialized: String, anchor: Long, startedAt: Long): Long? = runCatching {
    val root = JSONObject(serialized)
    val policy = root.optJSONObject("runPolicy") ?: return@runCatching null
    val length = duration(root)
    when (policy.optString("kind")) {
      "duration" -> (exactLong(policy, "durationSeconds") ?: return@runCatching null).let { startedAt + it * SECOND }
      "cycles" -> {
        val count = (exactLong(policy, "cycleCount") ?: return@runCatching null).toInt()
        if (count !in 1..MAX_RUN_CYCLES || length <= 0L) return@runCatching null
        val first = Math.floorDiv(startedAt - anchor, length) + 1L
        val terminalRound = first + count - 1L
        if (terminalRound < 0L) null else Math.addExact(anchor, Math.multiplyExact(terminalRound, length))
      }
      else -> null
    }
  }.getOrNull()

  fun next(serialized: String, anchor: Long, now: Long, startedAt: Long = anchor, terminalAt: Long? = runEndAt(serialized, anchor, startedAt), randomSeed: Long = anchor, visibleOnly: Boolean = false): UnifiedTimelineEvent? = runCatching {
    val root = JSONObject(serialized)
    if (terminalAt != null && now >= terminalAt) return@runCatching null
    val natural = natural(root, anchor, now, randomSeed, visibleOnly) ?: return@runCatching null
    if (terminalAt == null || natural.at < terminalAt) return@runCatching natural
    if (natural.at == terminalAt) {
      val custom = customCompletion(root)
      return@runCatching if (custom == null) natural.copy(completesRun = true, showOnWatchFace = true) else natural.copy(candidates = listOf(custom), winner = custom, collision = false, completesRun = true, showOnWatchFace = true)
    }
    val candidate = completionCandidate(root) ?: return@runCatching null
    val length = duration(root)
    val round = max(0L, Math.floorDiv(terminalAt - anchor, length))
    UnifiedTimelineEvent(terminalAt, "unified:$anchor:complete:$startedAt:$terminalAt", round, round, root.getJSONArray("steps").length() - 1, root.getJSONArray("steps").getJSONObject(root.getJSONArray("steps").length() - 1).getString("id"), null, "run-complete", false, listOf(candidate), candidate, false, true, true)
  }.getOrNull()

  fun nextVisible(serialized: String, anchor: Long, now: Long, startedAt: Long = anchor, terminalAt: Long? = runEndAt(serialized, anchor, startedAt), randomSeed: Long = anchor): UnifiedTimelineEvent? = next(serialized, anchor, now, startedAt, terminalAt, randomSeed, visibleOnly = true)

  fun position(serialized: String, anchor: Long, now: Long, startedAt: Long = anchor, terminalAt: Long? = runEndAt(serialized, anchor, startedAt), randomSeed: Long = anchor): UnifiedTimelinePosition? = runCatching {
    val root = JSONObject(serialized)
    val steps = root.optJSONArray("steps") ?: return@runCatching null
    val length = duration(root)
    if (length <= 0L) return@runCatching null
    val round = roundAt(now, anchor, length)
    val elapsed = max(0L, now - (anchor + round * length))
    var before = 0L
    var index = steps.length() - 1
    var stepDuration = 0L
    for (i in 0 until steps.length()) {
      val duration = stepDuration(steps.getJSONObject(i))
      if (elapsed < before + duration) { index = i; stepDuration = duration; break }
      before += duration
    }
    val step = steps.getJSONObject(index)
    UnifiedTimelinePosition(anchor, randomSeed, round, round, (elapsed.toDouble() / length).toFloat().coerceIn(0f, 1f), index, step.getString("id"), ((elapsed - before).toDouble() / stepDuration).toFloat().coerceIn(0f, 1f), next(serialized, anchor, now, startedAt, terminalAt, randomSeed))
  }.getOrNull()

  fun iterationEnd(serialized: String, anchor: Long, now: Long, count: Int): UnifiedTimelineIterationEnd? = runCatching {
    val root = JSONObject(serialized)
    val length = duration(root)
    val steps = root.optJSONArray("steps") ?: return@runCatching null
    if (length <= 0L || steps.length() == 0) return@runCatching null
    val iterations = count.coerceIn(1, MAX_ITERATIONS)
    val endingRound = roundAt(now, anchor, length) + iterations - 1L
    val lastId = steps.getJSONObject(steps.length() - 1).getString("id")
    UnifiedTimelineIterationEnd("unified:$anchor:$endingRound:${stepIdentity(lastId)}:end", anchor + (endingRound + 1L) * length, iterations)
  }.getOrNull()

  fun skipTarget(serialized: String, anchor: Long, now: Long, startedAt: Long, terminalAt: Long?, direction: Int): UnifiedTimelineSkipTarget? = runCatching {
    val root = JSONObject(serialized)
    val steps = root.optJSONArray("steps") ?: return@runCatching null
    val length = duration(root)
    if (steps.length() < 2 || direction == 0 || length <= 0L) return@runCatching null
    val current = position(serialized, anchor, now, startedAt, terminalAt) ?: return@runCatching null
    val index = current.currentStepIndex
    if (direction < 0 && index == 0 && current.roundIndex == 0L && terminalAt != null) return@runCatching null
    val roundEnd = anchor + (current.roundIndex + 1L) * length
    if (direction > 0 && index == steps.length() - 1 && terminalAt != null && roundEnd >= terminalAt) return@runCatching UnifiedTimelineSkipTarget(anchor, startedAt, terminalAt, true)
    val target = Math.floorMod(index + if (direction > 0) 1 else -1, steps.length())
    val targetRound = if (direction > 0 && target == 0) current.roundIndex + 1L else if (direction < 0 && index == 0 && current.roundIndex > 0L) current.roundIndex - 1L else current.roundIndex
    var before = 0L
    for (i in 0 until target) before += stepDuration(steps.getJSONObject(i))
    val nextAnchor = now - targetRound * length - before
    val delta = nextAnchor - anchor
    val boundedByCycles = root.optJSONObject("runPolicy")?.optString("kind") == "cycles"
    UnifiedTimelineSkipTarget(nextAnchor, if (boundedByCycles) startedAt + delta else startedAt, if (boundedByCycles && terminalAt != null) terminalAt + delta else terminalAt, false)
  }.getOrNull()

  private fun natural(root: JSONObject, anchor: Long, now: Long, randomSeed: Long, visibleOnly: Boolean): UnifiedTimelineEvent? {
    val steps = root.optJSONArray("steps") ?: return null
    val length = duration(root)
    if (length <= 0L) return null
    var round = roundAt(now, anchor, length)
    while (round < Long.MAX_VALUE / length) {
      val roundStart = anchor + round * length
      var stepStart = roundStart
      for (stepIndex in 0 until steps.length()) {
        val step = steps.optJSONObject(stepIndex) ?: continue
        val duration = stepDuration(step)
        if (stepStart + duration <= now) { stepStart += duration; continue }
        val groups = groups(step, round, stepIndex, stepStart, randomSeed, visibleOnly)
        val at = groups.keys.filter { it > now }.minOrNull()
        if (at != null) {
          val items = groups.getValue(at)
          val winner = items.sortedWith(compareByDescending<UnifiedTimelineCandidate> { it.cadencePriority }.thenBy { it.trackOrder ?: Int.MAX_VALUE }).first()
          val stepId = step.getString("id")
          val isEnd = at == stepStart + duration
          val isRoundEnd = isEnd && stepIndex == steps.length() - 1
          val offset = if (isEnd) null else (at - stepStart) / SECOND
          val semantic = if (isEnd) "$anchor:$round:${stepIdentity(stepId)}:end" else "$anchor:$round:${stepIdentity(stepId)}:$offset"
          return UnifiedTimelineEvent(at, "unified:$semantic", round, round, stepIndex, stepId, offset, if (!isEnd) "step-offset" else if (isRoundEnd) "round-end" else "step-end", isRoundEnd, items, winner, items.size > 1, false, items.any { it.showOnWatchFace })
        }
        stepStart += duration
      }
      round += 1L
    }
    return null
  }

  private fun groups(step: JSONObject, round: Long, stepIndex: Int, start: Long, randomSeed: Long, visibleOnly: Boolean): Map<Long, List<UnifiedTimelineCandidate>> {
    val durationSeconds = step.optLong("durationSeconds")
    val endAt = start + durationSeconds * SECOND
    val groups = mutableMapOf<Long, MutableList<UnifiedTimelineCandidate>>()
    groups.getOrPut(endAt) { mutableListOf() }.add(candidate(step.optJSONObject("endCue"), step.getString("id"), step.getString("id"), null, "step-end", step.optBoolean("endAlarmEnabled"), true, null, 0L, null))
    if (!step.optBoolean("subBellsEnabled")) return groups
    val tracks = step.optJSONArray("subBellTracks") ?: return groups
    for (trackOrder in 0 until tracks.length()) {
      val track = tracks.optJSONObject(trackOrder) ?: continue
      val visible = track.optBoolean("showOnWatchFace", true)
      if (!track.optBoolean("enabled", true) || (visibleOnly && !visible)) continue
      val offsets = mutableSetOf<Long>()
      if (track.optBoolean("repeatEnabled", true)) {
        val selected = track.optJSONArray("selectedOffsetsSeconds") ?: JSONArray()
        for (index in 0 until selected.length()) selected.optLong(index, -1L).takeIf { it > 0L && it < durationSeconds }?.let(offsets::add)
      }
      track.optLong("afterStartSeconds", -1L).takeIf { it > 0L && it < durationSeconds }?.let(offsets::add)
      track.optLong("beforeEndSeconds", -1L).takeIf { it > 0L && it < durationSeconds }?.let { offsets.add(durationSeconds - it) }
      track.optJSONObject("randomRepeat")?.let { range -> offsets.addAll(randomOffsets(track.optString("id"), range.optLong("minSeconds"), range.optLong("maxSeconds"), durationSeconds, round, randomSeed)) }
      val cadence = track.optLong("cadenceSeconds")
      for (offset in offsets) {
        val at = start + offset * SECOND
        groups.getOrPut(at) { mutableListOf() }.add(candidate(track, track.getString("id"), step.getString("id"), track.getString("id"), "sub-bell", false, visible, cadence, if (track.optBoolean("repeatEnabled", true)) cadence else 0L, trackOrder))
      }
    }
    return groups
  }

  private fun candidate(cue: JSONObject?, sourceCueId: String, stepId: String, trackId: String?, kind: String, alarm: Boolean, visible: Boolean, cadence: Long?, priority: Long, order: Int?): UnifiedTimelineCandidate {
    val soundIds = cueSoundIds(cue)
    val rawOverride = cue?.opt("hapticOverride")
    val off = rawOverride == "off"
    val haptic = (rawOverride as? JSONObject)?.let { HapticProfileConfig.normalized(it.optString("pattern", "single"), it.optString("strength", "balanced"), HapticProfileConfig("single", "balanced")) }
    val mode = cue?.optString("soundMode", "single") ?: "single"
    val cueId = when {
      kind == "run-complete" -> "run-complete"
      trackId == null -> stepIdentity(stepId)
      else -> trackIdentity(stepId, trackId)
    }
    return UnifiedTimelineCandidate(cueId, sourceCueId, stepId, trackId, kind, alarm, cueSound(cue), cue?.optDouble("volume", 1.0)?.toFloat()?.coerceIn(0f, 1f) ?: 1f, soundIds, mode, haptic, off, visible, cadence, priority, order)
  }

  private fun completionCandidate(root: JSONObject): UnifiedTimelineCandidate? {
    customCompletion(root)?.let { return it }
    val steps = root.optJSONArray("steps") ?: return null
    val last = steps.optJSONObject(steps.length() - 1) ?: return null
    return candidate(last.optJSONObject("endCue"), "run-complete", last.getString("id"), null, "run-complete", false, true, null, 0L, null)
  }

  private fun customCompletion(root: JSONObject): UnifiedTimelineCandidate? {
    val cue = root.optJSONObject("completionCue") ?: return null
    val last = root.optJSONArray("steps")?.optJSONObject((root.optJSONArray("steps")?.length() ?: 1) - 1) ?: return null
    return candidate(cue, "run-complete", last.getString("id"), null, "run-complete", false, true, null, 0L, null)
  }

  private fun randomOffsets(trackId: String, minimum: Long, maximum: Long, durationSeconds: Long, round: Long, randomSeed: Long): List<Long> {
    if (minimum < 1L || maximum < minimum) return emptyList()
    var seed = randomSeed.toInt() xor round.toInt()
    for (character in trackId) seed = seed * 31 + character.code
    val offsets = mutableListOf<Long>()
    var offset = 0L
    var count = 0
    while (offset < durationSeconds && count < MAX_RANDOM_EVENTS) {
      seed = seed * 1_664_525 + 1_013_904_223
      offset += minimum + ((seed.toLong() and 0xffff_ffffL) % (maximum - minimum + 1L))
      if (offset > 0L && offset < durationSeconds) offsets.add(offset)
      count++
    }
    return offsets
  }

  private fun cueSound(cue: JSONObject?): String {
    val sound = cue?.optJSONObject("sound") ?: return "clear-bell"
    return if (sound.optString("kind") == "builtin") sound.optString("id", "clear-bell") else sound.optString("uri", "clear-bell")
  }

  private fun cueSoundIds(cue: JSONObject?): List<String> {
    val primary = cueSound(cue)
    val sounds = cue?.optJSONArray("sounds") ?: return listOf(primary)
    val values = (0 until sounds.length()).mapNotNull { index ->
      val sound = sounds.optJSONObject(index) ?: return@mapNotNull null
      if (sound.optString("kind") == "builtin") sound.optString("id").takeIf(TimerSoundIds::isValid)
      else sound.optString("uri").takeIf { it.isNotBlank() && TimerSoundSource.isPersistentUri(sound.optString("kind"), it) }
    }
    return values.ifEmpty { listOf(primary) }
  }

  private fun validRunPolicy(policy: JSONObject?): Boolean {
    if (policy == null) return false
    val cycles = exactLong(policy, "cycleCount") ?: return false
    val seconds = exactLong(policy, "durationSeconds") ?: return false
    if (cycles !in 1L..MAX_RUN_CYCLES.toLong() || seconds !in 1L..MAX_RUN_DURATION_SECONDS) return false
    return when (policy.opt("kind")) {
      "continuous", "cycles", "duration" -> true
      else -> false
    }
  }

  private fun validCue(cue: JSONObject?): Boolean {
    if (cue == null) return false
    val sound = cue.optJSONObject("sound") ?: return false
    val volume = (cue.opt("volume") as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: return false
    if (!validSoundRef(sound) || volume !in 0.0..1.0) return false
    if (cue.has("sounds")) {
      val sounds = cue.optJSONArray("sounds") ?: return false
      if (sounds.length() < 1) return false
      for (index in 0 until sounds.length()) if (!validSoundRef(sounds.optJSONObject(index))) return false
    }
    if (cue.has("soundMode") && (cue.opt("soundMode") as? String)?.let { it in setOf("single", "sequence", "random") } != true) return false
    if (cue.has("hapticOverride")) {
      when (val override = cue.opt("hapticOverride")) {
        "off" -> Unit
        is JSONObject -> if ((override.opt("pattern") as? String)?.let { it in setOf("single", "double", "triple") } != true || (override.opt("strength") as? String)?.let { it in setOf("gentle", "balanced", "strong") } != true) return false
        else -> return false
      }
    }
    return true
  }

  private fun validSoundRef(sound: JSONObject?): Boolean {
    if (sound == null) return false
    val kind = sound.opt("kind") as? String ?: return false
    return when (kind) {
      "builtin" -> (sound.opt("id") as? String)?.let { it in BUILTIN_SOUND_IDS } == true
      "android", "document" -> {
        val title = sound.opt("title") as? String ?: return false
        val uri = sound.opt("uri") as? String ?: return false
        if (title.codePointCount(0, title.length) > 60 || uri.length > 8_192 || !TimerSoundSource.isPersistentUri(kind, uri)) return false
        if (kind == "android" && (sound.opt("ringtoneType") as? String)?.let { it in setOf("alarm", "notification", "unknown") } != true) return false
        !sound.has("mimeType") || (kind == "document" && sound.opt("mimeType") is String)
      }
      else -> false
    }
  }

  private fun validBoolean(objectValue: JSONObject, key: String): Boolean = objectValue.opt(key) is Boolean
  private fun exactLong(objectValue: JSONObject, key: String): Long? = exactLong(objectValue.opt(key))
  private fun exactLong(array: JSONArray, index: Int): Long? = exactLong(array.opt(index))
  private fun exactLong(value: Any?): Long? {
    val number = value as? Number ?: return null
    val double = number.toDouble()
    if (!double.isFinite() || double % 1.0 != 0.0 || double < Long.MIN_VALUE.toDouble() || double > Long.MAX_VALUE.toDouble()) return null
    return number.toLong()
  }

  private fun validId(value: String): Boolean = value.isNotEmpty() && value.length <= MAX_ID_CHARACTERS
  private fun stepIdentity(id: String): String = "step:${id.length}:$id"
  private fun trackIdentity(stepId: String, trackId: String): String = "track:${stepId.length}:$stepId${trackId.length}:$trackId"
  private fun duration(root: JSONObject): Long {
    val steps = root.optJSONArray("steps") ?: return 0L
    return (0 until steps.length()).sumOf { index -> steps.optJSONObject(index)?.let(::stepDuration) ?: 0L }
  }
  private fun stepDuration(step: JSONObject): Long = step.optLong("durationSeconds", 0L) * SECOND
  private fun roundAt(now: Long, anchor: Long, length: Long): Long = max(0L, Math.floorDiv(now - anchor, length))
}
