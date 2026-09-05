package expo.modules.chandastimerservice

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.PowerManager
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Single alarm-routed one-shot and preview player with safe URI fallback. */
object TimerSoundPlayer {
  private val players = mutableSetOf<MediaPlayer>()
  private val cancellationGeneration = AtomicLong(0L)
  private var stopPreviewPlayback: (() -> Unit)? = null

  fun play(
    context: Context,
    soundId: String,
    fallbackResId: Int,
    volume: Float,
    onLaunched: () -> Unit,
  ): () -> Unit {
    if (volume <= 0f) {
      onLaunched()
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
        runCatching { player.release() }
      }
      signalLaunched()
    }

    fun start(source: String, mayFallback: Boolean) {
      if (finished.get()) return
      val player = MediaPlayer()
      current = player
      synchronized(players) { players.add(player) }

      fun fail() {
        synchronized(players) { players.remove(player) }
        runCatching { player.release() }
        if (current === player) current = null
        if (mayFallback && cancellationGeneration.get() == generation) start("builtin:$fallbackResId", false) else finish()
      }

      try {
        player.setAudioAttributes(alarmAttributes())
        player.setWakeMode(context.applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
        setDataSource(context, player, source)
        val level = volume.coerceIn(0f, 1f)
        player.setVolume(level, level)
        player.setOnCompletionListener { finish() }
        player.setOnErrorListener { _, _, _ -> fail(); true }
        player.setOnPreparedListener { it.start() }
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
  fun preview(context: Context, soundId: String, fallbackResId: Int, volume: Float) {
    stopPreviewPlayback?.invoke()
    stopPreviewPlayback = play(context, soundId, fallbackResId, volume) {}
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
    snapshot.forEach { player -> runCatching { player.release() } }
  }

  fun canOpen(context: Context, soundId: String): Boolean = runCatching {
    if (!soundId.contains("://")) {
      return@runCatching builtInResource(soundId) != null || TimerSoundCache.resolve(context, soundId) != null
    }
    context.contentResolver.openAssetFileDescriptor(Uri.parse(soundId), "r")?.use { true } ?: false
  }.getOrDefault(false)

  fun builtInResource(soundId: String): Int? = when (soundId.removePrefix("builtin:")) {
    "temple-gong" -> R.raw.gong
    "clear-bell" -> R.raw.bell
    else -> soundId.removePrefix("builtin:").toIntOrNull()
  }

  fun alarmAttributes(): AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ALARM)
    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
    .build()

  fun setDataSource(context: Context, player: MediaPlayer, soundId: String) {
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
      java.io.FileInputStream(cached).use { stream -> player.setDataSource(stream.fd) }
    } else {
      player.setDataSource(context, Uri.parse(soundId))
    }
  }
}
