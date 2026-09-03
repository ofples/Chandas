package expo.modules.chandastimerservice

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.max

data class TimerV2Event(
  val at: Long,
  val logicalId: String,
  val mainBoundary: Boolean,
  val soundId: String,
  val volume: Float,
)

data class TimerV2IterationEnd(val logicalId: String, val at: Long)

/** Native mirror of src/lib/timeline.ts. It intentionally schedules only one future event. */
object TimerV2Timeline {
  private const val MINUTE = 60_000L

  fun next(serialized: String, anchor: Long, now: Long): TimerV2Event? = runCatching {
    val root = JSONObject(serialized)
    when (root.optString("mode")) {
      "pattern" -> nextPattern(root, anchor, now)
      "sequence" -> nextSequence(root, anchor, now)
      else -> null
    }
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

  private fun nextPattern(root: JSONObject, anchor: Long, now: Long): TimerV2Event? {
    val mainMinutes = root.optInt("mainMinutes", 0)
    val duration = mainMinutes.toLong() * MINUTE
    if (duration <= 0L) return null
    val tracks = root.optJSONArray("tracks") ?: JSONArray()
    var cycle = cycleAt(now, anchor, duration)
    while (cycle < Long.MAX_VALUE / 2) {
      val start = anchor + cycle * duration
      val candidates = mutableMapOf<Long, MutableList<Candidate>>()
      candidates.getOrPut(start + duration) { mutableListOf() }.add(Candidate(true, -1, cueSound(root.optJSONObject("mainCue")), cueVolume(root.optJSONObject("mainCue"))))
      for (trackIndex in 0 until tracks.length()) {
        val track = tracks.optJSONObject(trackIndex) ?: continue
        if (!track.optBoolean("enabled", true)) continue
        val offsets = track.optJSONArray("selectedOffsetsMinutes") ?: continue
        for (offsetIndex in 0 until offsets.length()) {
          val offset = offsets.optInt(offsetIndex, -1)
          if (offset <= 0 || offset >= mainMinutes) continue
          candidates.getOrPut(start + offset * MINUTE) { mutableListOf() }.add(Candidate(false, trackIndex, cueSound(track), cueVolume(track)))
        }
      }
      val at = candidates.keys.filter { it > now }.minOrNull()
      if (at != null) {
        val items = candidates.getValue(at)
        val main = items.firstOrNull { it.main }
        val winner = main ?: items.minBy { it.trackOrder }
        val boundary = if (winner.main) "main" else "offset:${(at - start) / MINUTE}"
        return TimerV2Event(at, "pattern:$anchor:$cycle:$boundary", winner.main, winner.soundId, winner.volume)
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
        if (start + elapsed > now) return TimerV2Event(start + elapsed, "sequence:$anchor:$cycle:step:$index", index == steps.length() - 1, cueSound(step), cueVolume(step))
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
  private data class Candidate(val main: Boolean, val trackOrder: Int, val soundId: String, val volume: Float)
}
