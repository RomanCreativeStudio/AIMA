import Foundation

/// Every failure mode the networking layer can surface to a ViewModel.
/// Deliberately a closed, typed set rather than passing raw `Error` through —
/// so a view can pattern-match and show a specific message (e.g. "check
/// your backend connection in Settings" for `.network`) instead of a generic
/// "something went wrong."
public enum APIError: Error, Equatable, Sendable {
    case invalidURL
    case network(String)
    case decoding(String)
    case server(statusCode: Int, message: String?)

    public var userMessage: String {
        switch self {
        case .invalidURL:
            return "The backend address is invalid. Check your connection settings."
        case .network(let message):
            return "Could not reach the backend: \(message)"
        case .decoding:
            return "The backend returned a response this app didn't understand."
        case .server(let statusCode, let message):
            return message ?? "The backend returned an error (status \(statusCode))."
        }
    }
}
