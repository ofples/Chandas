import WidgetKit
import SwiftUI
import ActivityKit

private struct TimerStatus: View {
  let state: ChandasActivityAttributes.ContentState
  var body: some View {
    if state.paused { Text(state.pausedText) }
    else if let end = state.endsAt, end > Date() {
      Text(timerInterval: Date()...end, countsDown: true).monospacedDigit()
    } else if state.endsAt != nil { Text("Complete") }
    else { Text(state.startedAt, style: .timer).monospacedDigit() }
  }
}

struct ChandasTimerActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ChandasActivityAttributes.self) { context in
      HStack(spacing: 14) {
        Image(systemName: context.state.paused ? "pause.circle" : "timer").font(.title2).foregroundStyle(.purple)
        VStack(alignment: .leading, spacing: 4) {
          Text(context.state.name).font(.headline).lineLimit(1)
          Text(context.state.endsAt == nil ? "Elapsed" : "Remaining").font(.caption).foregroundStyle(.secondary)
          if context.state.activeCount > 1 { Text("\(context.state.activeCount) timers active").font(.caption).foregroundStyle(.secondary) }
        }
        Spacer(minLength: 4)
        TimerStatus(state: context.state).font(.title2).lineLimit(1).minimumScaleFactor(0.6)
      }
      .padding(16).activityBackgroundTint(Color.black.opacity(0.85)).activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "chandas://run/\(context.state.runId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "")"))
      .accessibilityElement(children: .combine)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Image(systemName: "timer").foregroundStyle(.purple) }
        DynamicIslandExpandedRegion(.center) { Text(context.state.name).lineLimit(1) }
        DynamicIslandExpandedRegion(.trailing) { TimerStatus(state: context.state).frame(maxWidth: 120) }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text(context.state.endsAt == nil ? "Elapsed" : "Remaining").foregroundStyle(.secondary)
            Spacer()
            if context.state.activeCount > 1 { Text("\(context.state.activeCount) timers") }
          }.font(.caption)
        }
      } compactLeading: { Image(systemName: context.state.paused ? "pause.fill" : "timer").foregroundStyle(.purple) }
      compactTrailing: { TimerStatus(state: context.state).frame(maxWidth: 90).font(.caption).minimumScaleFactor(0.6) }
      minimal: { Image(systemName: context.state.paused ? "pause.fill" : "timer").foregroundStyle(.purple) }
      .widgetURL(URL(string: "chandas://run/\(context.state.runId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "")"))
    }
  }
}

@main
struct ChandasWidgets: WidgetBundle {
  var body: some Widget { ChandasTimerActivity() }
}
