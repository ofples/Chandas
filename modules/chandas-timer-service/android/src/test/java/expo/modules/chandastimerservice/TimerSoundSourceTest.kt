package expo.modules.chandastimerservice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimerSoundSourceTest {
  @Test fun onlyDurableLocalSoundUrisCrossTheNativeBoundary() {
    assertTrue(TimerSoundSource.isPersistentUri("android", "content://media/alarm/1"))
    assertTrue(TimerSoundSource.isPersistentUri("android", "android.resource://android/raw/tone"))
    assertTrue(TimerSoundSource.isPersistentUri("document", "content://documents/audio/1"))
    assertFalse(TimerSoundSource.isPersistentUri("document", "android.resource://android/raw/tone"))
    assertFalse(TimerSoundSource.isPersistentUri("android", "https://example.com/tone.mp3"))
    assertFalse(TimerSoundSource.isPersistentUri("document", "file:///sdcard/tone.mp3"))
  }

  @Test fun runtimeIdsAcceptOtaNamesButNotPathsOrNetworkLocations() {
    assertTrue(TimerSoundSource.isRuntimeSoundId("future-ota-sound"))
    assertTrue(TimerSoundSource.isRuntimeSoundId("content://media/alarm/1"))
    assertFalse(TimerSoundSource.isRuntimeSoundId("https://example.com/tone.mp3"))
    assertFalse(TimerSoundSource.isRuntimeSoundId("../tone"))
  }
}
