package expo.modules.chandastimerservice

import android.bluetooth.BluetoothClass.Device
import android.bluetooth.BluetoothManager
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRouting
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper

/** App-wide routing for alarm, cue and preview players. */
internal object TimerAudioOutput {
  private const val PREFS = "chandas-audio-output"
  private const val OUTPUTS = "outputs"
  private val priority = listOf("headphones", "external", "phone")

  fun get(context: Context): List<String>? {
    if (Build.VERSION.SDK_INT < 28) return null
    val selected = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getStringSet(OUTPUTS, emptySet()).orEmpty()
    return priority.filter(selected::contains)
  }

  fun set(context: Context, outputs: List<String>): Boolean {
    if (Build.VERSION.SDK_INT < 28 || outputs.any { it !in priority }) return false
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putStringSet(OUTPUTS, outputs.toSet()).apply()
    return true
  }

  class Playback(context: Context, private val player: MediaPlayer, private var level: Float) {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private var allowed = emptyList<String>()
    private var listening = false
    private var fadeGain = 1f

    fun start() {
      allowed = get(app).orEmpty()
      if (allowed.isNotEmpty() && Build.VERSION.SDK_INT >= 28) {
        if (!listening) {
          player.addOnRoutingChangedListener(AudioRouting.OnRoutingChangedListener {
            runCatching { preferAllowedDevice() }
            refreshVolume()
          }, handler)
          listening = true
        }
        preferAllowedDevice()
        player.setVolume(0f, 0f)
      } else {
        if (listening && Build.VERSION.SDK_INT >= 28) player.setPreferredDevice(null)
        player.setVolume(level * fadeGain, level * fadeGain)
      }
      player.start()
      if (allowed.isNotEmpty()) {
        refreshVolume()
        // Some devices publish the actual route asynchronously after start.
        handler.postDelayed({ refreshVolume() }, 50L)
      }
    }

    fun setVolume(value: Float) {
      level = value
      refreshVolume()
    }

    fun setFadeGain(gain: Float) {
      fadeGain = gain
      refreshVolume()
    }

    private fun preferAllowedDevice() {
      if (Build.VERSION.SDK_INT < 28 || allowed.isEmpty()) return
      val devices = app.getSystemService(AudioManager::class.java)
        .getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      val preferred = allowed.firstNotNullOfOrNull { category ->
        devices.firstOrNull { categories(app, it).let { types -> category in types && allowed.containsAll(types) } }
      }
      if (player.preferredDevice?.id != preferred?.id) player.setPreferredDevice(preferred)
    }

    private fun refreshVolume() {
      runCatching {
        val audible = if (allowed.isEmpty() || Build.VERSION.SDK_INT < 28) true else {
          val routed = if (Build.VERSION.SDK_INT >= 36) player.routedDevices else listOfNotNull(player.routedDevice)
          routed.isNotEmpty() && routed.all { device ->
            val types = categories(app, device)
            types.isNotEmpty() && allowed.containsAll(types)
          }
        }
        val volume = if (audible) level * fadeGain else 0f
        player.setVolume(volume, volume)
      }
    }
  }

  private fun categories(context: Context, device: AudioDeviceInfo): List<String> = when (device.type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> listOf("phone")
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID -> listOf("headphones")
    AudioDeviceInfo.TYPE_AUX_LINE, AudioDeviceInfo.TYPE_LINE_ANALOG, AudioDeviceInfo.TYPE_LINE_DIGITAL,
    AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, AudioDeviceInfo.TYPE_HDMI_EARC,
    AudioDeviceInfo.TYPE_DOCK, AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_ACCESSORY,
    AudioDeviceInfo.TYPE_BLE_SPEAKER -> listOf("external")
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> when (bluetoothClass(context, device)) {
      Device.AUDIO_VIDEO_HEADPHONES, Device.AUDIO_VIDEO_WEARABLE_HEADSET -> listOf("headphones")
      Device.AUDIO_VIDEO_LOUDSPEAKER, Device.AUDIO_VIDEO_HIFI_AUDIO, Device.AUDIO_VIDEO_CAR_AUDIO,
      Device.AUDIO_VIDEO_VIDEO_DISPLAY_AND_LOUDSPEAKER -> listOf("external")
      else -> listOf("headphones", "external")
    }
    else -> emptyList()
  }

  private fun bluetoothClass(context: Context, device: AudioDeviceInfo): Int? {
    if (Build.VERSION.SDK_INT < 28) return null
    return runCatching {
      context.getSystemService(BluetoothManager::class.java)?.adapter
        ?.getRemoteDevice(device.address)?.bluetoothClass?.deviceClass
    }.getOrNull()
  }
}
