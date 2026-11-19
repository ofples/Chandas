import Foundation

/// Atomic, versioned native authority. Unreadable/future ledgers fail closed.
final class ChandasLedger {
  private let url: URL
  private(set) var runs: [String: [String: Any]] = [:]
  private(set) var focused: String?
  private(set) var failure: String?
  var delivery: [String: [String: Any]] = [:]
  init(url: URL? = nil) {
    self.url = url ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Chandas/runs-v1.json")
    guard FileManager.default.fileExists(atPath: self.url.path) else { return }
    do {
      let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: self.url)) as? [String: Any]
      guard let raw = raw, number(raw["version"]) == 1, let runs = raw["runs"] as? [String: [String: Any]] else { throw ChandasError.invalid("Unrecognized saved timer state") }
      self.runs = runs; focused = raw["focused"] as? String; delivery = raw["delivery"] as? [String: [String: Any]] ?? [:]
    } catch { failure = error.localizedDescription }
  }
  func save(runs: [String: [String: Any]], focused: String?) throws {
    guard failure == nil else { throw ChandasError.invalid("Saved iPhone timers need recovery: \(failure!)") }
    let value: [String: Any] = ["version": 1, "runs": runs, "focused": focused ?? NSNull(), "delivery": delivery]
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    self.runs = runs; self.focused = focused
  }
}
