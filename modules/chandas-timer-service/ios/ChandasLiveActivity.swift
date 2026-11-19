import Foundation
import ActivityKit
import UIKit

final class ChandasLiveActivity {
  private var revision = 0
  func update(run: [String: Any]?, state: [String: Any]?, count: Int, coverage: Double) {
    revision += 1
    let ticket = revision
    Task { @MainActor [weak self] in
      guard let self = self else { return }
      let activities = Activity<ChandasActivityAttributes>.activities
      guard let run = run, let state = state, ActivityAuthorizationInfo().areActivitiesEnabled else {
        for activity in activities { await activity.end(nil, dismissalPolicy: .immediate) }
        return
      }
      let name = run["name"] as? String ?? "Chandas"
      let paused = number(state["timerV2PausedAt"]) > 0
      let end = number(state["timerV2EndsAt"])
      let content = ChandasActivityAttributes.ContentState(name: name, runId: run["id"] as? String ?? "", activeCount: count,
        startedAt: Date(timeIntervalSince1970: number(state["timerV2StartedAt"]) / 1000),
        endsAt: end > 0 ? Date(timeIntervalSince1970: end / 1000) : nil, paused: paused, pausedText: "Paused",
        coverageUntil: coverage > 0 ? Date(timeIntervalSince1970: coverage / 1000) : nil)
      let value = ActivityContent(state: content, staleDate: end > 0 ? Date(timeIntervalSince1970: end / 1000) : nil)
      if let first = activities.first {
        await first.update(value)
        for extra in activities.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
      } else if ticket == self.revision && UIApplication.shared.applicationState == .active {
        _ = try? Activity.request(attributes: ChandasActivityAttributes(installation: "chandas"), content: value, pushType: nil)
      }
    }
  }
}
