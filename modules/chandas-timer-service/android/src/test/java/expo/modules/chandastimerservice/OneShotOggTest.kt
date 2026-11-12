package expo.modules.chandastimerservice

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OneShotOggTest {
  @Test fun loopCommentSpanningPagesIsDisabledWithoutChangingAudio() {
    val original = stream("aNdRoId_LoOp=TrUe")
    val prefix = requireNotNull(rewrite(original))
    val rewritten = prefix + original.copyOfRange(prefix.size, original.size)
    val expected = stream("XNdRoId_LoOp=TrUe")

    assertEquals(original.size, rewritten.size)
    assertArrayEquals(expected, rewritten)
    assertNull(rewrite(rewritten))
  }

  @Test fun normalSoundsDoNotNeedAmendedHeaders() {
    assertNull(rewrite(stream("ANDROID_LOOP=false")))
    assertNull(rewrite("not an Ogg".encodeToByteArray()))
  }

  private fun rewrite(bytes: ByteArray): ByteArray? = OneShotOgg.rewrite { offset, count ->
    if (offset + count > bytes.size) null else bytes.copyOfRange(offset, offset + count)
  }

  private fun stream(tag: String): ByteArray {
    val vendor = ByteArray(230) { 'a'.code.toByte() }
    val comment = ByteBuffer.allocate(8 + 12 + vendor.size + tag.length).order(ByteOrder.LITTLE_ENDIAN)
      .put("OpusTags".encodeToByteArray()).putInt(vendor.size).put(vendor)
      .putInt(1).putInt(tag.length).put(tag.encodeToByteArray()).array()
    return page(0, 2, "OpusHead".encodeToByteArray()) +
      page(1, 0, comment.copyOfRange(0, 255)) +
      page(2, 1, comment.copyOfRange(255, comment.size)) +
      page(3, 4, byteArrayOf(8, 3, 9))
  }

  private fun page(index: Int, flags: Int, data: ByteArray): ByteArray {
    val page = ByteBuffer.allocate(28 + data.size).order(ByteOrder.LITTLE_ENDIAN)
    page.put("OggS".encodeToByteArray()).put(0).put(flags.toByte()).putLong(0)
      .putInt(42).putInt(index).putInt(0).put(1).put(data.size.toByte()).put(data)
    // Ogg's bitwise CRC, used here to compare the complete expected pages.
    var crc = 0
    for (byte in page.array()) {
      crc = crc xor ((byte.toInt() and 255) shl 24)
      repeat(8) { crc = (crc shl 1) xor (if (crc < 0) 0x04c11db7 else 0) }
    }
    return page.putInt(22, crc).array()
  }
}
