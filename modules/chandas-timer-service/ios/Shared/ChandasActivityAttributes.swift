import ActivityKit

struct ChandasActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var name: String
    var runId: String
    var activeCount: Int
    var startedAt: Date
    var endsAt: Date?
    var paused: Bool
    var pausedText: String
    var coverageUntil: Date?
  }
  var installation: String
}
