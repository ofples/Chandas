package expo.modules.chandastimerservice

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/**
 * Durable bridge from Expo Update assets to the native alarm scheduler.
 *
 * Expo owns the temporary downloaded asset. We copy it atomically into the
 * app's files directory so cache eviction, a process restart, or suspended
 * JavaScript cannot take a scheduled timer's sound away.
 */
object TimerSoundCache {
  private const val DIRECTORY = "timer-sounds"
  private const val PREFS = "chandas-sound-cache"
  private const val MAX_SOUND_BYTES = 25L * 1024L * 1024L
  private val md5Revision = Regex("^[0-9a-fA-F]{32}$")

  @Synchronized
  fun install(context: Context, id: String, sourceUri: String, revision: String): Boolean {
    val canonicalId = TimerSoundIds.canonical(id)
    if (!TimerSoundIds.isValid(canonicalId)) return false
    if (sourceUri.length !in 1..8_192 || revision.length > 512) return false

    val destination = fileFor(context, canonicalId)
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (revision.isNotBlank() &&
      preferences.getString(canonicalId, null) == revision &&
      destination.isFile && destination.length() in 1..MAX_SOUND_BYTES
    ) return true

    val directory = destination.parentFile ?: return false
    if (!directory.isDirectory && !directory.mkdirs()) return false
    val atomicFile = AtomicFile(destination)
    var output: FileOutputStream? = null
    return try {
      openSource(context, sourceUri).use { input ->
        val stream = atomicFile.startWrite()
        output = stream
        val copiedHash = copyBounded(input, stream)
        if (md5Revision.matches(revision) && !revision.equals(copiedHash, ignoreCase = true)) {
          throw IOException("Sound asset hash does not match")
        }
        atomicFile.finishWrite(stream)
        output = null
      }
      if (revision.isBlank()) preferences.edit().remove(canonicalId).commit()
      else preferences.edit().putString(canonicalId, revision).commit()
    } catch (_: Exception) {
      output?.let { runCatching { atomicFile.failWrite(it) } }
      false
    }
  }

  fun resolve(context: Context, id: String): File? {
    val canonicalId = TimerSoundIds.canonical(id.removePrefix("builtin:"))
    if (!TimerSoundIds.isValid(canonicalId)) return null
    return fileFor(context, canonicalId).takeIf { it.isFile && it.length() in 1..MAX_SOUND_BYTES }
  }

  private fun fileFor(context: Context, id: String): File =
    File(File(context.filesDir, DIRECTORY), "$id.audio")

  private fun openSource(context: Context, sourceUri: String): InputStream {
    val uri = Uri.parse(sourceUri)
    return when (uri.scheme?.lowercase()) {
      "file" -> {
        val source = File(requireNotNull(uri.path)).canonicalFile
        val cache = context.cacheDir.canonicalFile
        val files = context.filesDir.canonicalFile
        if (!source.isFile || (!source.isWithin(cache) && !source.isWithin(files))) {
          throw IOException("Sound source is outside app storage")
        }
        FileInputStream(source)
      }
      "content", "android.resource" ->
        context.contentResolver.openInputStream(uri) ?: throw IOException("Sound source is unavailable")
      else -> throw IOException("Unsupported sound source")
    }
  }

  private fun File.isWithin(directory: File): Boolean =
    path == directory.path || path.startsWith(directory.path + File.separator)

  private fun copyBounded(input: InputStream, output: FileOutputStream): String {
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    val digest = MessageDigest.getInstance("MD5")
    var total = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      if (total > MAX_SOUND_BYTES) throw IOException("Sound asset is too large")
      output.write(buffer, 0, read)
      digest.update(buffer, 0, read)
    }
    if (total == 0L) throw IOException("Sound asset is empty")
    output.fd.sync()
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }
}
