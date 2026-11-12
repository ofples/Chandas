package expo.modules.chandastimerservice

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Removes Android's file-level loop request without changing audio packets. */
internal object OneShotOgg {
  private const val MAX_HEADERS = 1024 * 1024
  private val capture = "OggS".encodeToByteArray()
  private val vorbisComment = "\u0003vorbis".encodeToByteArray()
  private val opusComment = "OpusTags".encodeToByteArray()
  private val crcTable = IntArray(256) { value ->
    var crc = value shl 24
    repeat(8) { crc = (crc shl 1) xor (if (crc < 0) 0x04c11db7 else 0) }
    crc
  }

  private data class Span(val page: ByteArray, val offset: Int, val length: Int)

  /** Returns the amended prefix. Everything after it can be read directly from the file. */
  fun rewrite(read: (offset: Int, length: Int) -> ByteArray?): ByteArray? {
    var offset = 0
    var packetIndex = 0
    val pages = mutableListOf<ByteArray>()
    val commentSpans = mutableListOf<Span>()
    val comment = ByteArrayOutputStream()

    while (offset < MAX_HEADERS) {
      val header = read(offset, 27) ?: return null
      if (capture.indices.any { header[it] != capture[it] } || header[4].toInt() != 0) return null
      val laces = read(offset + header.size, header[26].toInt() and 255) ?: return null
      val bodySize = laces.sumOf { it.toInt() and 255 }
      val pageSize = header.size + laces.size + bodySize
      if (offset + pageSize > MAX_HEADERS) return null
      val page = read(offset, pageSize) ?: return null
      pages.add(page)
      offset += pageSize
      var bodyOffset = header.size + laces.size

      for (lace in laces) {
        val length = lace.toInt() and 255
        if (packetIndex == 1) {
          comment.write(page, bodyOffset, length)
          commentSpans.add(Span(page, bodyOffset, length))
          if (length < 255) {
            val changed = comment.toByteArray()
            if (!disableAutoLoop(changed)) return null
            var copied = 0
            for (span in commentSpans) {
              changed.copyInto(span.page, span.offset, copied, copied + span.length)
              copied += span.length
            }
            val prefix = ByteArray(offset)
            var pageOffset = 0
            for (part in pages) {
              updateChecksum(part)
              part.copyInto(prefix, pageOffset)
              pageOffset += part.size
            }
            return prefix
          }
        }
        if (length < 255) packetIndex++
        bodyOffset += length
      }
    }
    return null
  }

  private fun disableAutoLoop(packet: ByteArray): Boolean {
    val prefix = listOf(vorbisComment, opusComment).firstOrNull { signature ->
      packet.size >= signature.size && signature.indices.all { packet[it] == signature[it] }
    } ?: return false
    val input = ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN)
    input.position(prefix.size)
    if (input.remaining() < 4) return false
    val vendorLength = input.int
    if (vendorLength < 0 || vendorLength > input.remaining() - 4) return false
    input.position(input.position() + vendorLength)
    val count = input.int
    if (count !in 0..(input.remaining() / 4)) return false
    var changed = false
    repeat(count) {
      if (input.remaining() < 4) return false
      val length = input.int
      if (length !in 0..input.remaining()) return false
      val start = input.position()
      if (length == 17 && packet.decodeToString(start, start + length).equals("ANDROID_LOOP=true", ignoreCase = true)) {
        // Rename the tag in place so packet lengths and audio offsets stay identical.
        packet[start] = 'X'.code.toByte()
        changed = true
      }
      input.position(start + length)
    }
    return changed
  }

  private fun updateChecksum(page: ByteArray) {
    val bytes = ByteBuffer.wrap(page).order(ByteOrder.LITTLE_ENDIAN)
    bytes.putInt(22, 0)
    var crc = 0
    for (byte in page) {
      crc = (crc shl 8) xor crcTable[(crc ushr 24) xor (byte.toInt() and 255)]
    }
    bytes.putInt(22, crc)
  }
}
