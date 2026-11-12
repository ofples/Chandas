package expo.modules.chandastimerservice

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Single alarm-routed one-shot and preview player with safe URI fallback. */
object TimerSoundPlayer {
  private const val SHORT_CUE_MS = 2_000L
  private const val FADE_MS = 250L
  private const val FADE_FRAME_MS = 25L
  private const val COMPLETION_GRACE_MS = 750L
  private val completionHandler by lazy { Handler(Looper.getMainLooper()) }
  private val players = mutableSetOf<MediaPlayer>()
  private val cancellationGeneration = AtomicLong(0L)
  private var stopPreviewPlayback: (() -> Unit)? = null

  fun play(
    context: Context,
    soundId: String,
    fallbackResId: Int,
    volume: Float,
    playbackKind: String = "one-shot-fallback",
    shortenLooping: Boolean = true,
    onFinished: () -> Unit = {},
    onLaunched: () -> Unit,
  ): () -> Unit {
    if (volume <= 0f) {
      onLaunched()
      onFinished()
      return {}
    }

    val launched = AtomicBoolean(false)
    val finished = AtomicBoolean(false)
    val generation = cancellationGeneration.get()
    var current: MediaPlayer? = null

    fun signalLaunched() {
      if (launched.compareAndSet(false, true)) onLaunched()
    }

    fun finish() {
      if (!finished.compareAndSet(false, true)) return
      val player = current
      current = null
      if (player != null) {
        synchronized(players) { players.remove(player) }
        releaseOneShot(player)
      }
      signalLaunched()
      onFinished()
    }

    fun start(source: String, mayFallback: Boolean) {
      if (finished.get()) return
      val player = MediaPlayer()
      current = player
      synchronized(players) { players.add(player) }

      fun fail() {
        synchronized(players) { players.remove(player) }
        releaseOneShot(player)
        if (current === player) current = null
        if (mayFallback && cancellationGeneration.get() == generation) start("builtin:$fallbackResId", false) else finish()
      }

      try {
        player.setAudioAttributes(alarmAttributes())
        player.setWakeMode(context.applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
        val wasLooping = setDataSource(context, player, source, oneShot = true)
        val level = volume.coerceIn(0f, 1f)
        val output = TimerAudioOutput.Playback(context, player, level)
        player.setOnCompletionListener { finish() }
        player.setOnErrorListener { _, _, _ -> fail(); true }
        player.setOnPreparedListener {
          if (finished.get() || cancellationGeneration.get() != generation) {
            finish()
          } else runCatching {
            startOneShot(context, player, output, source, playbackKind, wasLooping && shortenLooping, ::finish)
          }.onFailure { fail() }
        }
        player.prepareAsync()
        // BroadcastReceiver.goAsync must finish promptly even when the chosen
        // document is long or its provider prepares slowly. MediaPlayer's own
        // wake lock and listeners now own the rest of playback lifecycle.
        signalLaunched()
      } catch (_: Exception) {
        fail()
      }
    }

    // Any OTA-provided file can disappear or fail to decode. Always retain one
    // attempt with the packaged fallback before giving up on the cue.
    start(soundId, true)
    return { finish() }
  }

  @Synchronized
  fun preview(context: Context, soundId: String, fallbackResId: Int, volume: Float, shortenLooping: Boolean = true, onFinished: () -> Unit = {}) {
    stopPreviewPlayback?.invoke()
    stopPreviewPlayback = play(context, soundId, fallbackResId, volume, "preview", shortenLooping, onFinished) {}
  }

  @Synchronized
  fun stopPreview() {
    stopPreviewPlayback?.invoke()
    stopPreviewPlayback = null
  }

  fun stopAll() {
    cancellationGeneration.incrementAndGet()
    stopPreview()
    val snapshot = synchronized(players) { players.toList().also { players.clear() } }
    snapshot.forEach(::releaseOneShot)
  }

  internal fun startOneShot(
    context: Context,
    player: MediaPlayer,
    output: TimerAudioOutput.Playback,
    soundId: String,
    playbackKind: String,
    shorten: Boolean,
    finish: () -> Unit,
  ) {
    val duration = runCatching { player.duration }.getOrDefault(-1)
    val clip = if (shorten) minOf(SHORT_CUE_MS, duration.takeIf { it > 0 }?.toLong() ?: SHORT_CUE_MS) else 0L
    output.start()
    val startedAt = SystemClock.uptimeMillis()
    TimerPlaybackTrace.record(context) {
      "start $playbackKind sound=${TimerPlaybackTrace.sound(soundId)} durationMs=$duration clipMs=$clip"
    }
    if (clip > 0L) {
      val endsAt = startedAt + clip
      val fade = minOf(FADE_MS, clip)
      val fadeOut = object : Runnable {
        override fun run() {
          val remaining = (endsAt - SystemClock.uptimeMillis()).coerceIn(0L, fade)
          output.setFadeGain(remaining.toFloat() / fade)
          if (remaining > 0L) {
            completionHandler.postAtTime(this, player, minOf(endsAt, SystemClock.uptimeMillis() + FADE_FRAME_MS))
          } else {
            TimerPlaybackTrace.record(context) { "stop $playbackKind reason=cue-fade clipMs=$clip" }
            finish()
          }
        }
      }
      completionHandler.postAtTime(fadeOut, player, endsAt - fade)
    } else if (duration > 0) {
      // Some Android sources loop internally and never deliver onCompletion.
      completionHandler.postAtTime({
        TimerPlaybackTrace.record(context) { "stop $playbackKind reason=deadline sound=${TimerPlaybackTrace.sound(soundId)} durationMs=$duration" }
        finish()
      }, player, startedAt + duration + COMPLETION_GRACE_MS)
    }
  }

  internal fun releaseOneShot(player: MediaPlayer) {
    completionHandler.removeCallbacksAndMessages(player)
    runCatching { player.release() }
  }

  fun canOpen(context: Context, soundId: String): Boolean = runCatching {
    if (!TimerSoundSource.isRuntimeSoundId(soundId)) return@runCatching false
    if (!soundId.contains("://")) {
      return@runCatching builtInResource(soundId) != null || TimerSoundCache.resolve(context, soundId) != null
    }
    context.contentResolver.openAssetFileDescriptor(Uri.parse(soundId), "r")?.use { true } ?: false
  }.getOrDefault(false)

  fun builtInResource(soundId: String): Int? = when (soundId.removePrefix("builtin:")) {
    "alarm-tone" -> R.raw.alarm
    "temple-gong" -> R.raw.gong
    "clear-bell" -> R.raw.bell
    else -> soundId.removePrefix("builtin:").toIntOrNull()
  }

  fun alarmAttributes(): AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ALARM)
    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
    .build()

  /** Returns true if an embedded loop flag was stripped for one-shot playback. */
  fun setDataSource(context: Context, player: MediaPlayer, soundId: String, oneShot: Boolean = false): Boolean {
    val resource = builtInResource(soundId)
    if (resource != null) {
      context.resources.openRawResourceFd(resource).use { descriptor ->
        player.setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.length)
      }
    } else if (!soundId.contains("://")) {
      val cached = TimerSoundCache.resolve(context, soundId) ?: throw java.io.FileNotFoundException(soundId)
      // App-private files are not guaranteed to be readable by the media
      // process when passed as paths. MediaPlayer duplicates the descriptor,
      // so it is safe to close our stream as soon as setDataSource returns.
      FileInputStream(cached).use { stream -> player.setDataSource(stream.fd) }
    } else {
      val uri = Uri.parse(soundId)
      if (oneShot) setOneShotUri(context, player, uri)?.let { return it }
      player.setDataSource(context, uri)
    }
    return false
  }

  private fun setOneShotUri(context: Context, player: MediaPlayer, uri: Uri): Boolean? {
    val descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r") ?: return null
    val start = descriptor.startOffset
    val length = descriptor.length
    val stream = try {
      descriptor.createInputStream()
    } catch (error: Exception) {
      descriptor.close()
      throw error
    }
    var transferred = false
    try {
      val channel = stream.channel
      val prefix = if (length > 0L) OneShotOgg.rewrite { position, size ->
        if (position.toLong() + size > length) return@rewrite null
        val target = ByteBuffer.allocate(size)
        while (target.hasRemaining()) {
          if (channel.read(target, start + position + target.position()) <= 0) return@rewrite null
        }
        target.array()
      } else null
      if (prefix == null) {
        if (length < 0L) return null
        player.setDataSource(stream.fd, start, length)
      } else {
        // Android honors ANDROID_LOOP even with MediaPlayer.isLooping=false on STREAM_ALARM.
        // Give it amended headers while keeping the original file, alarm routing and cue audio.
        player.setDataSource(object : MediaDataSource() {
          override fun getSize(): Long = length

          override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
            if (size == 0) return 0
            if (position >= length) return -1
            val fromPrefix = if (position < prefix.size) minOf(size, prefix.size - position.toInt()) else 0
            if (fromPrefix > 0) prefix.copyInto(buffer, offset, position.toInt(), position.toInt() + fromPrefix)
            val count = minOf(size.toLong(), length - position).toInt() - fromPrefix
            if (count == 0) return fromPrefix
            val read = channel.read(ByteBuffer.wrap(buffer, offset + fromPrefix, count), start + position + fromPrefix)
            return if (fromPrefix == 0) read else fromPrefix + read.coerceAtLeast(0)
          }

          override fun close() = stream.close()
        })
        transferred = true
        TimerPlaybackTrace.record(context) { "removed embedded one-shot loop flag" }
      }
      return transferred
    } finally {
      if (!transferred) stream.close()
    }
  }
}
