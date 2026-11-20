import ExpoModulesCore
import UIKit

public final class ChandasTimerServiceModule: Module {
  private var engine: ChandasTimerEngine { ChandasTimerEngine.shared }
  private let legacyID = "legacy"
  public func definition() -> ModuleDefinition {
    Name("ChandasTimerService")
    Events("onAlarmStateChanged", "onControlStateChanged", "onTimerEventFired", "onTimerStateChanged", "onFocusStateChanged", "onSoundPreviewFinished", "onIOSSystemStatus")
    OnCreate { [weak self] in chandasOnMain {
      guard let self = self else { return }
      self.engine.emit = { [weak self] name, value in self?.sendEvent(name, value) }
    } }
    OnDestroy { [weak self] in chandasOnMain { self?.engine.emit = nil; self?.engine.previewAudio.stop() } }
    Function("getCapabilities") { chandasOnMain { self.engine.capabilities() } }
    Function("getRunIds") { chandasOnMain { self.engine.runIds() } }
    Function("getRunState") { (id: String) in chandasOnMain { self.engine.state(id) } }
    Function("startRun") { (id: String, name: String, config: [String: Any]) in chandasOnMain { self.engine.start(id: id, name: name, config: config) } }
    Function("updateRun") { (id: String, config: [String: Any]) in chandasOnMain { self.engine.update(id: id, patch: config) } }
    Function("runAction") { (id: String, action: String, amount: Double) in chandasOnMain { self.engine.action(id: id, name: action, amount: amount) } }
    Function("focusRun") { (id: String) in chandasOnMain { self.engine.focus(id) } }
    Function("consumeRunDestination") { () -> [String: String]? in chandasOnMain {
      guard let id = self.engine.destination else { return nil }; self.engine.destination = nil; return ["id": id, "panel": "clock"]
    } }
    Function("start") { (config: [String: Any]) in chandasOnMain { self.engine.start(id: self.legacyID, name: "Current timer", config: config) } }
    Function("update") { (config: [String: Any]) in chandasOnMain { self.engine.update(id: self.legacyID, patch: config) } }
    Function("getState") { chandasOnMain { self.engine.state(self.legacyID) } }
    Function("stop") { () throws in try chandasOnMain {
      let result = self.engine.action(id: self.legacyID, name: "stop", amount: 0)
      if !flag(result["success"]) && flag(self.engine.state(self.legacyID)["active"]) { throw ChandasError.invalid("Timer cleanup failed") }
    } }
    Function("isRinging") { chandasOnMain { flag(self.engine.state(self.legacyID)["ringing"]) } }
    Function("stopAlarm") { chandasOnMain { flag(self.engine.action(id: self.legacyID, name: "dismiss", amount: 0)["success"]) } }
    Function("toggleAlarmOnce") { chandasOnMain { _ = self.engine.action(id: self.legacyID, name: "alarm-once", amount: 0) } }
    Function("muteForIterations") { (count: Double) in chandasOnMain { _ = self.engine.action(id: self.legacyID, name: "mute-iterations", amount: count) } }
    Function("muteForMinutes") { (minutes: Double) in chandasOnMain { _ = self.engine.action(id: self.legacyID, name: "mute-seconds", amount: minutes * 60) } }
    Function("muteForSeconds") { (seconds: Double) in chandasOnMain { _ = self.engine.action(id: self.legacyID, name: "mute-seconds", amount: seconds) } }
    Function("setMuteUntil") { (id: String?, deadline: Double) in chandasOnMain { self.engine.setMute(id: id ?? self.legacyID, until: deadline) } }
    Function("clearMute") { chandasOnMain { _ = self.engine.action(id: self.legacyID, name: "clear-mute", amount: 0) } }
    Function("canScheduleExactAlarms") { true }
    Function("canUseFullScreenIntent") { chandasOnMain { self.engine.alarms.authorized } }
    Function("areNotificationsEnabled") { chandasOnMain { flag(self.engine.systemStatus()["notifications"]) } }
    Function("getIOSSystemStatus") { chandasOnMain { self.engine.systemStatus() } }
    AsyncFunction("prepareForStart") { (config: [String: Any]) async throws -> Bool in
      try await Task { @MainActor in try await self.engine.prepare(config) }.value
    }
    Function("openNotificationSettings") { Self.openSettings() }
    Function("openExactAlarmSettings") { Self.openSettings() }
    Function("openFullScreenIntentSettings") { Self.openSettings() }
    Function("openNotificationPolicySettings") { Self.openSettings() }
    Function("openFocusRuleSettings") { Self.openSettings() }
    Function("hasNotificationPolicyAccess") { false }
    Function("isFocusModeActive") { false }
    Function("getFocusState") { ["policyAccess": false, "automationEnabled": false, "ruleExists": false, "ruleEnabled": false, "actual": "inactive", "reason": "off"] as [String: Any] }
    Function("refreshFocusMode") { }
    Function("setFocusModeEnabled") { (_: Bool) in }
    Function("getAudioMixMode") { chandasOnMain { self.engine.audio.mixMode } }
    Function("setAudioMixMode") { (mode: String) in chandasOnMain { () -> Bool in
      guard ["default", "mix", "duck", "pause"].contains(mode) else { return false }; self.engine.audio.mixMode = mode; return true
    } }
    AsyncFunction("cacheBuiltInSound") { (id: String, uri: String, _: String) throws -> Bool in
      try chandasOnMain { try self.engine.audio.prepare(id, uri: uri); return true }
    }
    AsyncFunction("previewSound") { (id: String, _: String, volume: Double) in chandasOnMain { self.engine.previewAudio.play(id, volume: volume) } }
    AsyncFunction("previewSoundForUse") { (id: String, _: String, volume: Double, alarm: Bool, request: Int) in chandasOnMain {
      self.engine.previewAudio.play(id, volume: volume, alarm: alarm) { [weak self] in self?.sendEvent("onSoundPreviewFinished", ["request": request]) }
    } }
    Function("stopSoundPreview") { chandasOnMain { self.engine.previewAudio.stop() } }
    Function("isSoundAvailable") { (id: String) in chandasOnMain { self.engine.audio.source(id) != nil } }
  }
  private static func openSettings() {
    DispatchQueue.main.async { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
  }
}

public final class ChandasAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    DispatchQueue.main.async { _ = ChandasTimerEngine.shared }
    return true
  }
}
