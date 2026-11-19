import Foundation
import UIKit
import UserNotifications
import ExpoNotifications
import CryptoKit
import AVFoundation

/// Main-queue owner; system APIs may suspend, so every async result has a revision.
final class ChandasTimerEngine: NSObject, NotificationDelegate {
  static let shared = ChandasTimerEngine()
  let ledger = ChandasLedger()
  let audio = ChandasAudio()
  let previewAudio = ChandasAudio()
  let alarms = ChandasAlarms()
  private let activity = ChandasLiveActivity()
  private var kernel: ChandasKernel?
  private var timer: Timer?
  private var revision = 0
  private var lastTick = chandasNow()
  private var lastRefresh = 0.0
  private var scheduling: Task<Void, Never>?
  private var notificationAccess = false
  private var ringing = Set<String>()
  private(set) var coverage = 0.0
  private(set) var lastError: String?
  var emit: ((String, [String: Any]) -> Void)?
  var destination: String?
  private override init() {
    super.init()
    do { kernel = try ChandasKernel() } catch { lastError = error.localizedDescription }
    if let failure = ledger.failure { lastError = failure }
    NotificationCenterManager.shared.addDelegate(self)
    alarms.changed = { [weak self] values in self?.alarmChanged(values) }
    alarms.observe()
    NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(wentBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
    timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.tick() }
    refreshAccess()
    reconcilePast()
    requestSchedule()
  }
  private func invoke(_ input: [String: Any]) throws -> Any {
    guard let kernel = kernel else { throw ChandasError.invalid(lastError ?? "Timer kernel unavailable") }
    return try kernel.invoke(input)
  }
  func runIds() -> [String] { ledger.runs.keys.sorted() }
  func state(_ id: String) -> [String: Any] {
    guard let run = ledger.runs[id] else { return ["active": false, "ringing": false] }
    do {
      var value = try invoke(["method": "state", "run": run, "now": chandasNow()]) as? [String: Any] ?? [:]
      value["ringing"] = ledger.delivery.contains { ringing.contains($0.key) && $0.value["runId"] as? String == id }
      value["sessionGeneration"] = run["generation"]
      value["backgroundScheduledThrough"] = coverage
      return value
    } catch { lastError = error.localizedDescription; return ["active": true, "ringing": false, "recoveryRequired": true] }
  }
  private func save(_ runs: [String: [String: Any]], focused: String? = nil) throws {
    try ledger.save(runs: runs, focused: focused ?? ledger.focused)
  }
  func start(id: String, name: String, config: [String: Any]) -> Bool {
    let run: [String: Any] = ["id": id, "name": name, "config": config, "generation": UUID().uuidString, "scheduleVersion": UUID().uuidString]
    do {
      guard try invoke(["method": "validate", "run": run]) as? Bool == true else { return false }
      if requiresAlarm(config) && !alarms.authorized { lastError = "Interval alarms require iOS 26 and alarm access"; return false }
      guard notificationAccess else { lastError = "Allow notifications before starting background bells"; return false }
      revision += 1
      if ledger.runs[id] != nil { try cancelOwned(id: id) }
      var runs = ledger.runs; runs[id] = run
      try save(runs, focused: id)
      lastTick = max(lastTick, chandasNow() - 1)
      requestSchedule(); emitState(id); return true
    } catch { lastError = error.localizedDescription; return false }
  }
  func update(id: String, patch: [String: Any]) {
    guard var run = ledger.runs[id], var config = run["config"] as? [String: Any] else { return }
    do {
      for (key, value) in patch { config[key] = value }
      run["config"] = config
      run["scheduleVersion"] = UUID().uuidString
      guard try invoke(["method": "validate", "run": run]) as? Bool == true else { throw ChandasError.invalid("Invalid timer update") }
      guard !requiresAlarm(config) || alarms.authorized else { throw ChandasError.invalid("Allow Chandas alarms in Settings") }
      var runs = ledger.runs; runs[id] = run; try save(runs)
      requestSchedule(); emitState(id)
    } catch { fail(error) }
  }
  func action(id: String, name: String, amount: Double) -> [String: Any] {
    guard let run = ledger.runs[id] else { return ["success": false] }
    do {
      if name == "dismiss" { try cancelOwned(id: id, onlyRinging: true); return ["success": true] }
      if name == "stop" {
        revision += 1
        try cancelOwned(id: id)
        var runs = ledger.runs; runs.removeValue(forKey: id); try save(runs, focused: ledger.focused == id ? runs.keys.sorted().first : ledger.focused)
        audio.stop(); requestSchedule(); emitState(id)
        return ["success": true]
      }
      let result = try invoke(["method": "action", "run": run, "action": name, "amount": amount, "now": chandasNow()])
      guard var next = result as? [String: Any] else { return ["success": false] }
      next["generation"] = run["generation"]
      next["scheduleVersion"] = UUID().uuidString
      var runs = ledger.runs; runs[id] = next; try save(runs)
      if name == "pause" { try cancelOwned(id: id); audio.stop() }
      requestSchedule(); emitState(id); return ["success": true]
    } catch { fail(error); return ["success": false, "error": error.localizedDescription] }
  }
  func focus(_ id: String) { guard ledger.runs[id] != nil else { return }; do { try save(ledger.runs, focused: id); updateActivity() } catch { fail(error) } }
  func setMute(id: String, until: Double) { update(id: id, patch: ["mutedUntil": until, "mutedIterationEndAt": 0, "mutedIterationCount": 0, "mutedIterationEndId": ""]) }
  func requiresAlarm(_ config: [String: Any]) -> Bool {
    if flag(config["alarmModeEnabled"]) || flag(config["alarmOnceArmed"]) { return true }
    guard let text = config["timerV2Program"] as? String, let data = text.data(using: .utf8),
          let program = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    return (program["steps"] as? [[String: Any]] ?? []).contains { flag($0["endAlarmEnabled"]) }
  }
  func prepare(_ config: [String: Any]) async throws -> Bool {
    let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge, .timeSensitive])
    notificationAccess = allowed
    guard allowed else { throw ChandasError.invalid("Allow notifications in iPhone Settings to hear background bells") }
    if requiresAlarm(config) {
      guard alarms.supported else { throw ChandasError.invalid("Interval alarms require iOS 26 or later. Turn off Alarm to use ordinary bells.") }
      guard try await alarms.request() else { throw ChandasError.invalid("Allow Chandas alarms in iPhone Settings") }
    }
    return true
  }
  func systemStatus() -> [String: Any] {
    ["platform": "ios", "notifications": notificationAccess, "alarmKit": alarms.supported,
     "alarmsAuthorized": alarms.authorized, "backgroundScheduledThrough": coverage,
     "activeCount": ledger.runs.count, "error": lastError ?? NSNull(), "recoveryRequired": ledger.failure != nil]
  }
  private func refreshAccess() {
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in DispatchQueue.main.async {
      self?.notificationAccess = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
      self?.emit?("onIOSSystemStatus", self?.systemStatus() ?? [:])
    } }
  }
  private func fail(_ error: Error) { lastError = error.localizedDescription; emit?("onIOSSystemStatus", systemStatus()) }
  private func emitState(_ id: String) {
    let value = state(id)
    emit?("onTimerStateChanged", ["runId": id, "active": flag(value["active"]), "timerV2Anchor": value["timerV2Anchor"] ?? 0, "nextEventAt": value["nextEventAt"] ?? 0, "nextLogicalId": value["nextLogicalId"] ?? "", "exactTimingAvailable": true])
    emit?("onControlStateChanged", value.merging(["runId": id]) { _, new in new })
  }
  @objc private func becameActive() { reconcilePast(); lastTick = chandasNow(); refreshAccess(); alarmChanged(alarms.ringing()); requestSchedule() }
  @objc private func wentBackground() { audio.stop(); requestSchedule() }
  @objc private func interrupted() { audio.stop() }
  @objc private func routeChanged() { audio.stop() }
  private func alarmChanged(_ values: Set<String>) {
    ringing = values
    for id in ledger.runs.keys { emit?("onAlarmStateChanged", ["runId": id, "ringing": flag(state(id)["ringing"])]) }
  }
  private func tick() {
    guard UIApplication.shared.applicationState == .active, kernel != nil else { return }
    let now = chandasNow()
    do {
      let plan = try invoke(["method": "plan", "runs": Array(ledger.runs.values), "after": lastTick, "limit": 64, "through": now]) as? [String: Any] ?? [:]
      let batches = plan["batches"] as? [[[String: Any]]] ?? []
      for batch in batches { for item in batch {
        guard let id = item["runId"] as? String, var run = ledger.runs[id], let event = item["event"] as? [String: Any] else { continue }
        run["config"] = item["nextConfig"]
        if flag(item["winner"]) && !flag(item["alarm"]) { run["soundState"] = item["nextSoundState"] }
        var runs = ledger.runs; runs[id] = run; try save(runs)
        let fresh = now - number(event["at"]) <= 1000
        if fresh && flag(item["winner"]) && !flag(item["alarm"]) {
          _ = audio.play(item["soundId"] as? String ?? "", volume: number(item["volume"]))
        }
        var signal = event; signal["runId"] = id; signal["firedAt"] = now; signal["suppressed"] = !flag(item["winner"]) || !fresh
        signal["winnerCueId"] = (event["winner"] as? [String: Any])?["cueId"] ?? ""; signal["suppressionReason"] = "none"
        emit?("onTimerEventFired", signal)
        emitState(id)
        if flag(event["completesRun"]) { _ = action(id: id, name: "stop", amount: 0) }
      } }
      lastTick = now
      if !batches.isEmpty || now - lastRefresh >= 30_000 { requestSchedule() }
    } catch { lastTick = now; fail(error) }
  }
  private func reconcilePast() {
    // Future plans contain pure gate transitions; replay metadata, never audio.
    var runs = ledger.runs
    let now = chandasNow()
    for record in ledger.delivery.values.sorted(by: { number($0["at"]) < number($1["at"]) }) where number(record["at"]) <= now {
      guard let id = record["runId"] as? String, var run = runs[id], run["generation"] as? String == record["generation"] as? String,
            run["scheduleVersion"] as? String == record["scheduleVersion"] as? String,
            var c = run["config"] as? [String: Any], let next = record["nextConfig"] as? [String: Any] else { continue }
      for key in ["alarmOnceArmed", "mutedUntil", "mutedIterationEndId", "mutedIterationEndAt", "mutedIterationCount"] { c[key] = next[key] }
      run["config"] = c; runs[id] = run
      if flag(record["winner"]) && !flag(record["alarm"]) { run["soundState"] = record["nextSoundState"]; runs[id] = run }
    }
    do { try save(runs) } catch { fail(error) }
  }
  private func identifier(_ text: String) -> String {
    var bytes = Array(SHA256.hash(data: Data(text.utf8)).prefix(16)); bytes[6] = (bytes[6] & 15) | 0x40; bytes[8] = (bytes[8] & 63) | 0x80
    return UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15])).uuidString
  }
  private func cancelOwned(id: String, onlyRinging: Bool = false) throws {
    let owned = ledger.delivery.filter { $0.value["runId"] as? String == id && (!onlyRinging || ringing.contains($0.key)) }
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: owned.keys.map { "chandas.\($0)" })
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: owned.keys.map { "chandas.\($0)" })
    for (key, record) in owned { if flag(record["alarm"]) { try alarms.cancel(key) }; ledger.delivery.removeValue(forKey: key) }
    try save(ledger.runs); alarmChanged(alarms.ringing())
  }
  private func requestSchedule() {
    revision += 1; let ticket = revision
    scheduling?.cancel()
    scheduling = Task { @MainActor [weak self] in await self?.schedule(ticket) }
  }
  private func schedule(_ ticket: Int) async {
    lastRefresh = chandasNow()
    guard ledger.failure == nil else { return }
    let now = chandasNow(), center = UNUserNotificationCenter.current()
    do {
      let plan = try invoke(["method": "plan", "runs": Array(ledger.runs.values), "after": now, "limit": 56]) as? [String: Any] ?? [:]
      let batches = plan["batches"] as? [[[String: Any]]] ?? []
      var desired: [String: [String: Any]] = [:]
      for batch in batches { for var item in batch {
        guard let runId = item["runId"] as? String, let run = ledger.runs[runId], let event = item["event"] as? [String: Any] else { continue }
        let key = identifier("\(runId):\(run["scheduleVersion"] ?? ""):\(event["logicalId"] ?? "")")
        item["at"] = event["at"]; item["generation"] = run["generation"]; item["scheduleVersion"] = run["scheduleVersion"]
        desired[key] = item
      } }
      let live = try alarms.scheduled()
      let pending = Set(await center.pendingNotificationRequests().map(\.identifier))
      guard ticket == revision, !Task.isCancelled else { return }
      for (key, old) in ledger.delivery where desired[key] == nil && !ringing.contains(key) {
        center.removePendingNotificationRequests(withIdentifiers: ["chandas.\(key)"])
        if flag(old["alarm"]) && live.contains(key) { try alarms.cancel(key) }
      }
      var accepted: [String: [String: Any]] = ledger.delivery.filter { ringing.contains($0.key) }
      var scheduledThrough = now
      for (key, item) in desired.sorted(by: { number($0.value["at"]) < number($1.value["at"]) }) {
        guard ticket == revision, !Task.isCancelled else { return }
        if flag(item["winner"]) {
          guard let sound = audio.backgroundName(item["soundId"] as? String ?? "") else { throw ChandasError.invalid("A background sound is unavailable. Choose an included or supported audio file.") }
          // Journal intent before handing ownership to an asynchronous OS API.
          ledger.delivery[key] = item; try save(ledger.runs)
          if flag(item["alarm"]) {
            if !live.contains(key) {
              try await alarms.schedule(id: key, runId: item["runId"] as? String ?? "", logicalId: (item["event"] as? [String: Any])?["logicalId"] as? String ?? "", name: "\(item["name"] ?? "Chandas") · \(item["label"] ?? "Alarm")", at: number(item["at"]), sound: sound)
              if ticket != revision || Task.isCancelled { try alarms.cancel(key); return }
            }
          } else if !pending.contains("chandas.\(key)") {
            let content = UNMutableNotificationContent()
            content.title = item["name"] as? String ?? "Chandas"; content.body = item["label"] as? String ?? "Bell"
            content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: sound))
            content.threadIdentifier = "chandas.timers"; content.interruptionLevel = .timeSensitive
            content.userInfo = ["chandasRunId": item["runId"] ?? ""]
            try await center.add(UNNotificationRequest(identifier: "chandas.\(key)", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, (number(item["at"]) - chandasNow()) / 1000), repeats: false)))
            if ticket != revision || Task.isCancelled { center.removePendingNotificationRequests(withIdentifiers: ["chandas.\(key)"]); return }
          }
        }
        accepted[key] = item; scheduledThrough = max(scheduledThrough, number(item["at"]))
      }
      guard ticket == revision, !Task.isCancelled else { return }
      ledger.delivery = accepted; coverage = ledger.runs.isEmpty ? 0 : scheduledThrough
      try save(ledger.runs)
      center.removePendingNotificationRequests(withIdentifiers: ["chandas.coverage"])
      if !ledger.runs.isEmpty && flag(plan["truncated"]) && coverage > now {
        let reminder = UNMutableNotificationContent(); reminder.title = "Keep your bells scheduled"; reminder.body = "Open Chandas to schedule the next timer bells."; reminder.threadIdentifier = "chandas.timers"
        try await center.add(UNNotificationRequest(identifier: "chandas.coverage", content: reminder, trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, (coverage - now) / 1000 - 30), repeats: false)))
      }
      lastError = nil; updateActivity(); emit?("onIOSSystemStatus", systemStatus())
    } catch { coverage = now; fail(error) }
  }
  private func updateActivity() {
    let id = ledger.focused.flatMap { ledger.runs[$0] != nil ? $0 : nil } ?? ledger.runs.keys.sorted().first
    activity.update(run: id.flatMap { ledger.runs[$0] }, state: id.map(state), count: ledger.runs.count, coverage: coverage)
  }
  func willPresent(_ notification: UNNotification, completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) -> Bool {
    guard notification.request.identifier.hasPrefix("chandas.") else { return false }
    completionHandler([]); return true // Foreground driver owns normal cue playback.
  }
  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    guard let id = response.notification.request.content.userInfo["chandasRunId"] as? String else { return false }
    DispatchQueue.main.async { self.destination = id; self.focus(id) }
    return true
  }
}
