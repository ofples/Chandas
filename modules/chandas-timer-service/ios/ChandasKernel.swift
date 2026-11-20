import Foundation
import JavaScriptCore

enum ChandasError: LocalizedError {
  case invalid(String)
  var errorDescription: String? { switch self { case .invalid(let reason): return reason } }
}

/// Used only on the host's serialized main queue. No Hermes/RN runtime dependency.
final class ChandasKernel {
  private let context: JSContext
  init(source: String? = nil) throws {
    guard let context = JSContext() else { throw ChandasError.invalid("Cannot create timer kernel") }
    self.context = context
    let own = Bundle(for: ChandasKernel.self)
    let resource = own.url(forResource: "ChandasTimerService", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? own
    let text: String
    if let source = source { text = source }
    else if let url = resource.url(forResource: "ChandasKernel", withExtension: "js") { text = try String(contentsOf: url, encoding: .utf8) }
    else { throw ChandasError.invalid("Bundled timer kernel is missing") }
    context.evaluateScript(text)
    if let error = context.exception { throw ChandasError.invalid(error.toString()) }
  }
  func invoke(_ request: [String: Any]) throws -> Any {
    context.exception = nil
    let data = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
    guard let input = String(data: data, encoding: .utf8),
          let fn = context.objectForKeyedSubscript("ChandasKernel")?.objectForKeyedSubscript("invokeIOSKernel"),
          let result = fn.call(withArguments: [input])?.toString() else { throw ChandasError.invalid("Timer kernel returned no result") }
    if let error = context.exception { throw ChandasError.invalid(error.toString()) }
    guard let output = result.data(using: .utf8) else { throw ChandasError.invalid("Invalid timer result") }
    return try JSONSerialization.jsonObject(with: output, options: [.fragmentsAllowed])
  }
}

// Match Date.now(): canonical anchors and persisted deadlines are integer ms.
func chandasNow() -> Double { (Date().timeIntervalSince1970 * 1000).rounded(.down) }
func number(_ value: Any?) -> Double { (value as? NSNumber)?.doubleValue ?? 0 }
func flag(_ value: Any?) -> Bool { (value as? NSNumber)?.boolValue ?? false }
func chandasOnMain<T>(_ block: () throws -> T) rethrows -> T {
  if Thread.isMainThread { return try block() }
  return try DispatchQueue.main.sync(execute: block)
}
