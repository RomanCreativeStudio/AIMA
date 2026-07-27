import Foundation

/// A minimal, order-preserving-where-it-matters representation of arbitrary
/// JSON — used for the backend's freeform JSONB fields (`preferences`,
/// `assistantBehavior`, `metadata`, memory/document `payload`) where a fixed
/// Swift type would either be wrong or would need constant updating to
/// track whatever shape the backend happens to store. Everywhere the shape
/// *is* known (e.g. a `Workspace`'s own typed fields), a concrete `Codable`
/// struct is used instead — this type exists only for the "we don't know,
/// and don't need to know, the shape" cases.
public enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    /// Convenience accessor for the common "shallow string dictionary" case (e.g. rendering `assistantBehavior` in a settings list).
    public var stringValue: String? {
        switch self {
        case .string(let value): return value
        case .number(let value): return String(value)
        case .bool(let value): return String(value)
        case .null: return nil
        case .object, .array: return nil
        }
    }

    /// A readable, recursive rendering for display purposes (e.g. an
    /// approval's `payload` in the Approvals detail view, Phase 2.2) — not
    /// meant to be valid JSON, just human-scannable text. Object keys are
    /// sorted for stable, deterministic output.
    public var displayString: String {
        switch self {
        case .string(let value): return value
        case .number(let value): return String(value)
        case .bool(let value): return String(value)
        case .null: return "null"
        case .object(let value):
            let entries = value.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value.displayString)" }
            return "{ " + entries.joined(separator: ", ") + " }"
        case .array(let value):
            return "[" + value.map { $0.displayString }.joined(separator: ", ") + "]"
        }
    }
}
