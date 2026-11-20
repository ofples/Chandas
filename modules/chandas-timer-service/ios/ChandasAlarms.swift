import Foundation
import AlarmKit
import SwiftUI
import ActivityKit

@available(iOS 26.0, *)
private struct ChandasAlarmMetadata: AlarmMetadata {
  var runId: String
  var logicalId: String
}

final class ChandasAlarms {
  private var observer: Task<Void, Never>?
  var changed: ((Set<String>) -> Void)?
  var supported: Bool { if #available(iOS 26.0, *) { return true }; return false }
  var authorized: Bool {
    if #available(iOS 26.0, *) { return AlarmManager.shared.authorizationState == .authorized }
    return false
  }
  func request() async throws -> Bool {
    if #available(iOS 26.0, *) { return try await AlarmManager.shared.requestAuthorization() == .authorized }
    return false
  }
  func observe() {
    guard observer == nil else { return }
    if #available(iOS 26.0, *) {
      observer = Task { @MainActor [weak self] in
        for await alarms in AlarmManager.shared.alarmUpdates {
          guard !Task.isCancelled else { return }
          self?.changed?(Set(alarms.filter { $0.state == .alerting }.map { $0.id.uuidString }))
        }
      }
    }
  }
  func ringing() -> Set<String> {
    if #available(iOS 26.0, *), let alarms = try? AlarmManager.shared.alarms { return Set(alarms.filter { $0.state == .alerting }.map { $0.id.uuidString }) }
    return []
  }
  func scheduled() throws -> Set<String> {
    if #available(iOS 26.0, *), authorized { return Set(try AlarmManager.shared.alarms.map { $0.id.uuidString }) }
    return []
  }
  func cancel(_ id: String) throws {
    if #available(iOS 26.0, *), authorized, let uuid = UUID(uuidString: id) {
      // Missing alarms have already been stopped by the person/system.
      if try AlarmManager.shared.alarms.contains(where: { $0.id == uuid }) { try AlarmManager.shared.cancel(id: uuid) }
    }
  }
  func schedule(id: String, runId: String, logicalId: String, name: String, at: Double, sound: String) async throws {
    guard #available(iOS 26.0, *) else { throw ChandasError.invalid("Interval alarms require iOS 26 or later") }
    guard authorized, let uuid = UUID(uuidString: id) else { throw ChandasError.invalid("Allow Chandas alarms in iPhone Settings") }
    let button = AlarmButton(text: "Dismiss", textColor: .white, systemImageName: "stop.fill")
    let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: name), stopButton: button)
    let attributes = AlarmAttributes(presentation: AlarmPresentation(alert: alert), metadata: ChandasAlarmMetadata(runId: runId, logicalId: logicalId), tintColor: Color.purple)
    // Fixed alerts deliberately omit countdown UI: no phantom countdown alarm.
    let configuration = AlarmManager.AlarmConfiguration.alarm(schedule: .fixed(Date(timeIntervalSince1970: at / 1000)), attributes: attributes, sound: .named(sound))
    _ = try await AlarmManager.shared.schedule(id: uuid, configuration: configuration)
  }
}
