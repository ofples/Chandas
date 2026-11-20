import Foundation

@main
struct NativeKernelSmoke {
  static func main() throws {
    let source = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
    let kernel = try ChandasKernel(source: source)
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))) as! [String: Any]
    let plan = try kernel.invoke(fixture) as! [String: Any]
    let batches = plan["batches"] as! [[[String: Any]]]
    precondition(batches.count == 56, "Background queue must be bounded")
    for (index, batch) in batches.enumerated() {
      let event = batch[0]
      precondition(flag(event["alarm"]) == (index % 2 == 0), "Alarm leaked into the non-alarm step")
      precondition(flag(event["winner"]), "Expected an audible event")
    }
    print("Native JavaScriptCore: 28 alarm/non-alarm rounds and queue limit passed")
    let now = chandasNow()
    precondition(now == now.rounded(.down), "Host clock must match integer Date.now timestamps")
    var run = (fixture["runs"] as! [[String: Any]])[0]
    var config = run["config"] as! [String: Any]
    config["timerV2Anchor"] = now; config["timerV2StartedAt"] = now
    run["config"] = config
    let paused = try kernel.invoke(["method": "action", "run": run, "action": "pause", "now": now + 1000]) as! [String: Any]
    let resumed = try kernel.invoke(["method": "action", "run": paused, "action": "resume", "now": now + 11000]) as! [String: Any]
    let valid = try kernel.invoke(["method": "validate", "run": resumed]) as? Bool
    precondition(valid == true, "Native pause/resume must preserve a schedulable run")
    let afterResume = try kernel.invoke(["method": "plan", "runs": [resumed], "after": now + 11000, "limit": 2]) as! [String: Any]
    precondition((afterResume["batches"] as! [[[String: Any]]]).count == 2, "Resumed timer lost its next bells")
    print("Native host clock: integer timestamps and pause/resume scheduling passed")
  }
}
