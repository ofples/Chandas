package expo.modules.chandastimerservice

import android.content.Context
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.util.concurrent.Executors

/** Playback decisions for local prototype diagnostics. No names or sound URIs are retained. */
internal object TimerPlaybackTrace {
  private const val MAX_FILE_BYTES = 512 * 1024
  private const val FILE_NAME = "timer-playback.log"
  private val writer by lazy { Executors.newSingleThreadExecutor() }
  private val fileLock = Any()

  fun record(context: Context, message: () -> String) {
    if (!context.packageName.endsWith(".prototype")) return
    val line = "run=${TimerRuns.id(context) ?: "legacy"} ${message()}"
    val timestamp = System.currentTimeMillis()
    Log.i("ChandasPlayback", line)
    val app = context.applicationContext
    writer.execute {
      runCatching {
        synchronized(fileLock) {
          val current = File(app.filesDir, FILE_NAME)
          if (current.length() >= MAX_FILE_BYTES) {
            val previous = File(app.filesDir, "$FILE_NAME.previous")
            if (previous.exists()) previous.delete()
            if (!current.renameTo(previous)) current.delete()
          }
          current.appendText("$timestamp $line\n")
        }
      }
    }
  }

  fun dump(context: Context, output: PrintWriter) {
    if (!context.packageName.endsWith(".prototype")) return
    synchronized(fileLock) {
      for (name in listOf("$FILE_NAME.previous", FILE_NAME)) {
        val file = File(context.filesDir, name)
        if (file.isFile) file.useLines { lines -> lines.forEach(output::println) }
      }
    }
  }

  fun sound(id: String): String = when {
    id.contains("://") -> "device-sound"
    id.startsWith("builtin:") -> "bundled-fallback"
    else -> id.take(48)
  }
}
