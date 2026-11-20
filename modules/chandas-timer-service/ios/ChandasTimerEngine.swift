import Foundation
import UIKit
import UserNotifications
import CryptoKit
import AVFoundation

/// Main-queue owner; system APIs may suspend, so every async result has a revision.
final class ChandasTimerEngine: NSObject, UNUserNotificationCenterDelegate {
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
  private var backgroundTask = UIBackgroundTaskIdentifier.invalid
  private var notificationAccess = false
  private var previousNotificationDelegate: UNUserNotificationCenterDelegate?
  private var ringing = Set<String>()
  private(set) var coverage = 0.0
  private(set) var lastError: String?
  var emit: ((String, [String: Any]) -> Void)?
  var destination: String?
  private override init() {
    super.init()
    do { kernel = try ChandasKernel() } catch { lastError = error.localizedDescription }
    if let failure = ledger.failure { lastError = failure }
    let center = UNUserNotificationCenter.current()
    previousNotificationDelegate = center.delegate
    center.delegate = self
    if ledger.failure != nil || kernel == nil {
      // Preserve unreadable source records, but fail closed at the OS too.
      // AlarmManager exposes this app's alarms only; notification cleanup is
      // restricted to our namespace and leaves other Expo notifications alone.
      center.getPendingNotificationRequests { requests in
        center.removePendingNotificationRequests(withIdentifiers: requests.map(\.identifier).filter { $0.hasPrefix("chandas.") })
      }
      if let owned = try? alarms.scheduled() { for id in owned { try? alarms.cancel(id) } }
    }
    alarms.changed = { [weak self] values in self?.alarmChanged(values) }
    alarms.observe()
    NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(wentBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.significantTimeChangeNotification, object: nil)
    let driver = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in self?.tick() }
    RunLoop.main.add(driver, forMode: .common); timer = driver
    refreshAccess()
    reconcilePast()
    requestSchedule()
  }
  private func invoke(_ input: [String: Any]) throws -> Any {
    guard let kernel = kernel else { throw ChandasError.invalid(lastError ?? "Timer kernel unavailable") }
    return try kernel.invoke(input)
  }
  func runIds() -> [String] { ledger.runs.keys.sorted() }
  func capabilities() -> [String: Any] {
    // Limits come from the same bundled parser that admits accepted programs.
    // An unavailable kernel must never advertise a usable native contract.
    (try? invoke(["method": "capabilities"]) as? [String: Any]) ?? ["contractVersion": 0, "programSchemaMin": 0, "programSchemaMax": 0]
  }
  func state(_ id: String) -> [String: Any] {
    guard let run = ledger.runs[id] else { return ["active": false, "ringing": false] }
    do {
      var value = try invoke(["method": "state", "run": run, "now": chandasNow()]) as? [String: Any] ?? [:]
      let liveRinging = alarms.ringing()
      value["ringing"] = ledger.delivery.contains { liveRinging.contains($0.key) && $0.value["runId"] as? String == id }
      // A terminal system alarm keeps its run available for dismissal. Never
      // cancel the final alarm merely because its logical countdown reached zero.
      if !flag(value["active"]) {
        let live = (try? alarms.scheduled()) ?? []
        if ledger.delivery.contains(where: { $0.value["runId"] as? String == id && flag($0.value["alarm"]) && flag($0.value["winner"]) && number($0.value["at"]) <= chandasNow() && live.contains($0.key) }) { value["active"] = true }
      }
      value["sessionGeneration"] = run["generation"]
      value["backgroundScheduledThrough"] = coverage
      return value
    } catch { lastError = error.localizedDescription; return ["active": true, "ringing": false, "recoveryRequired": true] }
  }
  private func save(_ runs: [String: [String: Any]], focused: String? = nil) throws {
    try ledger.save(runs: runs, focused: focused ?? ledger.focused)
  }
  func start(id: String, name: String, config: [String: Any]) -> Bool {
    let run: [String: Any] = ["id": id, "name": name, "config": config, "generation": UUID().uuidString, "scheduleVersion": UUID().uuidString, "viewedAt": ledger.runs[id]?["viewedAt"] ?? 0]
    do {
      guard try invoke(["method": "validate", "run": run]) as? Bool == true else { return false }
      if requiresAlarm(config) && !alarms.authorized { lastError = "Interval alarms require iOS 26 and alarm access"; return false }
      guard notificationAccess else { lastError = "Allow notifications before starting background bells"; return false }
      revision += 1
      if ledger.runs[id] != nil { try cancelOwned(id: id) }
      var runs = ledger.runs; runs[id] = run
      let focus = ledger.focused.flatMap { runs[$0] != nil ? $0 : nil } ?? id
      try save(runs, focused: focus)
      updateActivity(); requestSchedule(); emitState(id); return true
    } catch { lastError = error.localizedDescription; return false }
  }
  func update(id: String, patch: [String: Any]) {
    guard var run = ledger.runs[id], var config = run["config"] as? [String: Any] else { return }
    do {
      for (key, value) in patch { config[key] = value }
      run["config"] = config
      run["scheduleVersion"] = UUID().uuidString
      run["effectiveFrom"] = chandasNow()
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
      if name == "stop" || name == "complete" {
        revision += 1
        try cancelOwned(id: id)
        var runs = ledger.runs; runs.removeValue(forKey: id)
        try ledger.save(runs: runs, focused: ledger.focused == id ? preferredRun(runs) : ledger.focused)
        if name == "stop" { audio.stop() }; requestSchedule(); emitState(id)
        return ["success": true]
      }
      let result = try invoke(["method": "action", "run": run, "action": name, "amount": amount, "now": chandasNow()])
      guard var next = result as? [String: Any] else { return ["success": false] }
      next["generation"] = run["generation"]
      next["scheduleVersion"] = UUID().uuidString
      next["effectiveFrom"] = chandasNow()
      var runs = ledger.runs; runs[id] = next; try save(runs)
      if name == "pause" { try cancelOwned(id: id); audio.stop() }
      requestSchedule(); emitState(id); return ["success": true]
    } catch { fail(error); return ["success": false, "error": error.localizedDescription] }
  }
  func focus(_ id: String) {
    guard var run = ledger.runs[id] else { return }
    do {
      run["viewedAt"] = chandasNow(); var runs = ledger.runs; runs[id] = run
      try save(runs, focused: id); updateActivity()
    } catch { fail(error) }
  }
  func setMute(id: String, until: Double) { update(id: id, patch: ["mutedUntil": until, "mutedIterationEndAt": 0, "mutedIterationCount": 0, "mutedIterationEndId": ""]) }
  func requiresAlarm(_ config: [String: Any]) -> Bool {
    guard let text = config["timerV2Program"] as? String, let data = text.data(using: .utf8),
          let program = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    // Infinity keeps the old ending-cue settings for switching back. Hidden
    // step flags must not require AlarmKit for a bells-only timer on iOS 18.
    if flag(program["noMainInterval"]) { return false }
    if flag(config["alarmModeEnabled"]) || flag(config["alarmOnceArmed"]) { return true }
    return (program["steps"] as? [[String: Any]] ?? []).contains { flag($0["endAlarmEnabled"]) }
  }
  func prepare(_ config: [String: Any]) async throws -> Bool {
    do { return try await prepareAuthorized(config) }
    catch { fail(error); throw error }
  }
  private func prepareAuthorized(_ config: [String: Any]) async throws -> Bool {
    var ids = Set<String>()
    func visit(_ value: Any) {
      if let record = value as? [String: Any] {
        if record["kind"] as? String == "builtin", let id = record["id"] as? String { ids.insert(id) }
        if ["document", "android"].contains(record["kind"] as? String ?? ""), let uri = record["uri"] as? String { ids.insert(uri) }
        for child in record.values { visit(child) }
      } else if let list = value as? [Any] { for child in list { visit(child) } }
    }
    if let text = config["timerV2Program"] as? String, let data = text.data(using: .utf8), let program = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
      func audibleCue(_ cue: [String: Any]) { if !flag(cue["soundMuted"]) && number(cue["volume"]) > 0 { visit(cue) } }
      for step in program["steps"] as? [[String: Any]] ?? [] {
        if !flag(program["noMainInterval"]), let cue = step["endCue"] as? [String: Any] { audibleCue(cue) }
        if flag(step["subBellsEnabled"]) { for track in step["subBellTracks"] as? [[String: Any]] ?? [] where flag(track["enabled"]) { audibleCue(track) } }
      }
      if let cue = program["completionCue"] as? [String: Any] { audibleCue(cue) }
    }
    if requiresAlarm(config), let id = config["alarmSoundId"] as? String { ids.insert(id) }
    for id in ids {
      guard let source = audio.source(id) else { throw ChandasError.invalid("A selected sound is unavailable on this iPhone. Choose an included sound or import its audio file.") }
      if audio.backgroundName(id) == nil { try audio.prepare(id, uri: source.absoluteString) }
    }
    let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
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
     "activeCount": ledger.runs.count, "error": lastError as Any? ?? NSNull(), "recoveryRequired": ledger.failure != nil]
  }
  private func refreshAccess() {
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in DispatchQueue.main.async {
      self?.notificationAccess = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
      if let self = self, !self.notificationAccess && !self.ledger.runs.isEmpty {
        self.coverage = 0; self.lastError = "Notifications are disabled. Background bells cannot sound."
      }
      self?.emit?("onIOSSystemStatus", self?.systemStatus() ?? [:])
    } }
  }
  private func fail(_ error: Error) { lastError = error.localizedDescription; emit?("onIOSSystemStatus", systemStatus()) }
  private func emitState(_ id: String) {
    let value = state(id)
    emit?("onTimerStateChanged", ["runId": id, "active": flag(value["active"]), "timerV2Anchor": value["timerV2Anchor"] ?? 0, "nextEventAt": value["nextEventAt"] ?? 0, "nextLogicalId": value["nextLogicalId"] ?? "", "exactTimingAvailable": true])
    emit?("onControlStateChanged", value.merging(["runId": id]) { _, new in new })
  }
  @objc private func becameActive() {
    reconcilePast(); lastTick = chandasNow(); refreshAccess(); alarms.observe(); alarmChanged(alarms.ringing()); requestSchedule()
    UNUserNotificationCenter.current().getDeliveredNotifications { values in
      let ids = values.map { $0.request.identifier }.filter { $0.hasPrefix("chandas.") }
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
    }
  }
  @objc private func wentBackground() { audio.stop(); previewAudio.stop(); requestSchedule() }
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
        var config = run["config"] as? [String: Any] ?? [:]
        for (key, value) in item["nextConfig"] as? [String: Any] ?? [:] { config[key] = value }
        run["config"] = config
        if flag(item["winner"]) && !flag(item["alarm"]) { run["soundState"] = item["nextSoundState"] }
        var runs = ledger.runs; runs[id] = run; try save(runs)
        let fresh = now - number(event["at"]) <= 1000
        if fresh && flag(item["winner"]) && !flag(item["alarm"]) {
          previewAudio.stop()
          _ = audio.play(item["soundId"] as? String ?? "", volume: number(item["volume"]))
        }
        var signal = event; signal["runId"] = id; signal["firedAt"] = now; signal["suppressed"] = !flag(item["winner"]) || !fresh
        signal["winnerCueId"] = (event["winner"] as? [String: Any])?["cueId"] ?? ""; signal["suppressionReason"] = "none"
        emit?("onTimerEventFired", signal)
        emitState(id)
        if flag(event["completesRun"]) && !flag(state(id)["active"]) { _ = action(id: id, name: "complete", amount: 0) }
      } }
      lastTick = now
      for id in Array(ledger.runs.keys) where !flag(state(id)["active"]) { _ = action(id: id, name: "complete", amount: 0) }
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
    for id in Array(ledger.runs.keys) where !flag(state(id)["active"]) { _ = action(id: id, name: "complete", amount: 0) }
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
    revision += 1
    if UIApplication.shared.applicationState == .background && backgroundTask == .invalid {
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Finish timer scheduling") { [weak self] in
        guard let self = self else { return }
        self.coverage = 0; self.lastError = "Reopen Chandas to finish updating background bells."
        self.endBackgroundWork()
      }
    }
    guard scheduling == nil else { return }
    scheduling = Task { @MainActor [weak self] in
      guard let self = self else { return }
      // Coalesce mutations through one worker. Never overlap two OS transactions
      // for the same request ID across an await (including stop/start races).
      while !Task.isCancelled {
        let ticket = self.revision
        await self.schedule(ticket)
        if ticket == self.revision { break }
      }
      self.scheduling = nil; self.endBackgroundWork()
    }
  }
  private func endBackgroundWork() {
    if backgroundTask != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid
    }
  }
  private func schedule(_ ticket: Int) async {
    lastRefresh = chandasNow()
    guard ledger.failure == nil else { return }
    let now = chandasNow(), center = UNUserNotificationCenter.current()
    do {
      let pending = Set(await center.pendingNotificationRequests().map(\.identifier))
      guard ticket == revision, !Task.isCancelled else { return }
      let otherRequests = pending.filter { !$0.hasPrefix("chandas.") }.count
      let repeating = try invoke(["method": "repeating", "runs": Array(ledger.runs.values), "now": now]) as? [[String: Any]]
      let useRepeating = repeating != nil && repeating!.count + otherRequests <= 63
      let plan = try invoke(["method": "plan", "runs": Array(ledger.runs.values), "after": now, "limit": max(1, min(56, 63 - otherRequests)), "background": true]) as? [String: Any] ?? [:]
      let batches = useRepeating ? repeating!.map { [$0] } : plan["batches"] as? [[[String: Any]]] ?? []
      if !useRepeating && batches.isEmpty && flag(plan["truncated"]) {
        throw ChandasError.invalid("This bell pattern exceeds iPhone background planning capacity. Simplify its muted cues or keep Chandas open.")
      }
      // Keep due, still-owned terminal alarms through a foreground replan, even
      // before AlarmKit's asynchronous alerting update reaches our observer.
      let liveAtStart = try alarms.scheduled()
      var desired = ledger.delivery.filter { flag($0.value["alarm"]) && number($0.value["at"]) <= now && liveAtStart.contains($0.key) }
      for batch in batches { for var item in batch {
        guard let runId = item["runId"] as? String, let run = ledger.runs[runId], let event = item["event"] as? [String: Any] else { continue }
        let eventKey = useRepeating ? "hour:\(Int(number(event["at"]).truncatingRemainder(dividingBy: 3_600_000) / 1000))" : "\(event["logicalId"] ?? "")"
        let key = identifier("\(runId):\(run["scheduleVersion"] ?? ""):\(eventKey)")
        item["at"] = event["at"]; item["generation"] = run["generation"]; item["scheduleVersion"] = run["scheduleVersion"]
        item["repeating"] = useRepeating
        desired[key] = item
      } }
      let live = try alarms.scheduled()
      guard ticket == revision, !Task.isCancelled else { return }
      for (key, old) in ledger.delivery where desired[key] == nil && !ringing.contains(key) {
        center.removePendingNotificationRequests(withIdentifiers: ["chandas.\(key)"])
        if flag(old["alarm"]) && live.contains(key) { try alarms.cancel(key) }
      }
      var accepted: [String: [String: Any]] = ledger.delivery.filter { ringing.contains($0.key) || flag($0.value["alarm"]) && number($0.value["at"]) <= now && liveAtStart.contains($0.key) }
      var scheduledThrough = now
      for (key, item) in desired.sorted(by: { number($0.value["at"]) < number($1.value["at"]) }) {
        guard ticket == revision, !Task.isCancelled else { return }
        if !useRepeating && number(item["at"]) <= chandasNow() { continue }
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
            content.threadIdentifier = "chandas.timers"; content.interruptionLevel = .active
            content.userInfo = ["chandasRunId": item["runId"] ?? ""]
            let trigger: UNNotificationTrigger
            if flag(item["repeating"]) {
              var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
              var components = calendar.dateComponents([.minute, .second], from: Date(timeIntervalSince1970: number(item["at"]) / 1000))
              components.timeZone = calendar.timeZone
              let repeatingTrigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
              guard repeatingTrigger.nextTriggerDate() != nil else { throw ChandasError.invalid("iPhone could not resolve a repeating bell") }
              trigger = repeatingTrigger
            } else {
              trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, (number(item["at"]) - chandasNow()) / 1000), repeats: false)
            }
            try await center.add(UNNotificationRequest(identifier: "chandas.\(key)", content: content, trigger: trigger))
            if ticket != revision || Task.isCancelled { center.removePendingNotificationRequests(withIdentifiers: ["chandas.\(key)"]); return }
          }
        }
        accepted[key] = item; scheduledThrough = max(scheduledThrough, number(item["at"]))
      }
      guard ticket == revision, !Task.isCancelled else { return }
      let actualPending = Set(await center.pendingNotificationRequests().map(\.identifier))
      let actualAlarms = try alarms.scheduled()
      guard ticket == revision, !Task.isCancelled else { return }
      for (key, item) in accepted where flag(item["winner"]) && (flag(item["repeating"]) || number(item["at"]) > chandasNow() + 1_000) {
        guard flag(item["alarm"]) ? actualAlarms.contains(key) : actualPending.contains("chandas.\(key)") else {
          throw ChandasError.invalid("iPhone did not retain the complete bell schedule. Reopen Chandas to retry.")
        }
      }
      ledger.delivery = accepted; coverage = ledger.runs.isEmpty ? 0 : useRepeating ? -1 : scheduledThrough > now ? scheduledThrough : 0
      try save(ledger.runs)
      center.removePendingNotificationRequests(withIdentifiers: ["chandas.coverage"])
      if !ledger.runs.isEmpty && flag(plan["truncated"]) && coverage > now {
        let reminder = UNMutableNotificationContent(); reminder.title = "Keep your bells scheduled"; reminder.body = "Open Chandas to schedule the next timer bells."; reminder.threadIdentifier = "chandas.timers"
        try await center.add(UNNotificationRequest(identifier: "chandas.coverage", content: reminder, trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, (coverage - now) / 1000 - 30), repeats: false)))
      }
      lastError = nil; updateActivity(); emit?("onIOSSystemStatus", systemStatus())
    } catch { if ticket == revision { coverage = now; fail(error) } }
  }
  private func updateActivity() {
    let id = ledger.focused.flatMap { ledger.runs[$0] != nil ? $0 : nil } ?? preferredRun(ledger.runs)
    activity.update(run: id.flatMap { ledger.runs[$0] }, state: id.map(state), count: ledger.runs.count, coverage: coverage)
  }
  private func preferredRun(_ runs: [String: [String: Any]]) -> String? {
    runs.keys.sorted { left, right in
      let l = max(number(runs[left]?["viewedAt"]), number((runs[left]?["config"] as? [String: Any])?["timerV2StartedAt"]))
      let r = max(number(runs[right]?["viewedAt"]), number((runs[right]?["config"] as? [String: Any])?["timerV2StartedAt"]))
      return l == r ? left < right : l > r
    }.first
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    if notification.request.identifier.hasPrefix("chandas.") { completionHandler([]) }
    else if let previous = previousNotificationDelegate, previous.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
      previous.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
    } else { completionHandler([]) }
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if let id = response.notification.request.content.userInfo["chandasRunId"] as? String {
      DispatchQueue.main.async { self.destination = id; self.focus(id) }; completionHandler()
    } else if let previous = previousNotificationDelegate, previous.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
      previous.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
    } else { completionHandler() }
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, openSettingsFor notification: UNNotification?) {
    previousNotificationDelegate?.userNotificationCenter?(center, openSettingsFor: notification)
  }
}
