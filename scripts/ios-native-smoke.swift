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
  }
}
