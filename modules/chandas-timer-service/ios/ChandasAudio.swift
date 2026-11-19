import AVFoundation
import UIKit
import CryptoKit

final class ChandasAudio: NSObject, AVAudioPlayerDelegate {
  private var player: AVAudioPlayer?
  private var finish: (() -> Void)?
  var mixMode: String {
    get { UserDefaults.standard.string(forKey: "chandas.audioMix") ?? "default" }
    set { UserDefaults.standard.set(newValue, forKey: "chandas.audioMix") }
  }
  private var directory: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Chandas/Sounds") }
  private var notificationDirectory: URL { FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Sounds") }
  private func safeID(_ id: String) -> String { SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined() }
  func source(_ id: String) -> URL? {
    if id.hasPrefix("file://"), let url = URL(string: id), FileManager.default.fileExists(atPath: url.path) { return url }
    let key = UserDefaults.standard.string(forKey: "chandas.sound.\(id)")
    return key.map { directory.appendingPathComponent($0) }.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
  }
  func backgroundName(_ id: String) -> String? {
    let name = "chandas-\(safeID(id)).wav"
    return FileManager.default.fileExists(atPath: notificationDirectory.appendingPathComponent(name).path) ? name : nil
  }
  /// Preserve full source playback; make a separate system-alert excerpt, never >29s.
  func prepare(_ id: String, uri: String) throws {
    guard let url = URL(string: uri), url.isFileURL else { throw ChandasError.invalid("Only local audio files are supported on iPhone") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: notificationDirectory, withIntermediateDirectories: true)
    let name = "\(safeID(id)).\(url.pathExtension.isEmpty ? "audio" : url.pathExtension)"
    let target = directory.appendingPathComponent(name)
    let handle = try FileHandle(forReadingFrom: url)
    let length = try handle.seekToEnd(); try handle.close()
    guard length <= 50 * 1024 * 1024 else { throw ChandasError.invalid("Audio file is larger than 50 MB") }
    let data = try Data(contentsOf: url)
    if url != target { try data.write(to: target, options: .atomic) }
    let input = try AVAudioFile(forReading: target)
    let format = input.processingFormat
    let count = AVAudioFrameCount(min(input.length, AVAudioFramePosition(format.sampleRate * 29)))
    guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count) else { throw ChandasError.invalid("Audio file is empty") }
    try input.read(into: buffer, frameCount: count)
    let output = notificationDirectory.appendingPathComponent("chandas-\(safeID(id)).wav")
    let temporary = notificationDirectory.appendingPathComponent(UUID().uuidString + ".wav")
    let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
    do {
      let file = try AVAudioFile(forWriting: temporary, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
      try file.write(from: buffer)
    }
    if FileManager.default.fileExists(atPath: output.path) { _ = try FileManager.default.replaceItemAt(output, withItemAt: temporary) }
    else { try FileManager.default.moveItem(at: temporary, to: output) }
    UserDefaults.standard.set(name, forKey: "chandas.sound.\(id)")
  }
  func play(_ id: String, volume: Double, alarm: Bool = false, completion: (() -> Void)? = nil) -> Bool {
    stop()
    guard let url = source(id) else { return false }
    do {
      let session = AVAudioSession.sharedInstance()
      var options: AVAudioSession.CategoryOptions = []
      if mixMode == "mix" || mixMode == "default" && !alarm { options = .mixWithOthers }
      else if mixMode == "duck" { options = [.mixWithOthers, .duckOthers] }
      try session.setCategory(.playback, mode: .default, options: options)
      try session.setActive(true)
      let value = try AVAudioPlayer(contentsOf: url)
      value.delegate = self; value.volume = Float(max(0, min(1, volume)))
      value.numberOfLoops = 0; player = value; finish = completion
      return value.play()
    } catch { stop(); return false }
  }
  func stop() {
    guard player != nil || finish != nil else { return }
    let callback = finish
    player?.stop(); player = nil; finish = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    callback?()
  }
  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    stop()
  }
}
