// swift-tools-version: 5.10
import PackageDescription

/// The macOS Experience Foundation (Phase 2.1, docs/decisions/0009-macos-
/// experience-foundation.md): a thin SwiftUI presentation layer over
/// `AIMACore` (../Shared/AIMACore) — no business logic, no direct database
/// or AI-provider access, matching every other AIMA client's rule
/// (docs/TECHNICAL_ARCHITECTURE.md §2). An executable target rather than an
/// `.xcodeproj` so the project stays plain-text and diffable; open this
/// folder's `Package.swift` directly in Xcode ("File > Open...") to build,
/// run, and preview it — Xcode treats a `swift-tools-version` manifest as a
/// first-class project.
///
/// This target imports SwiftUI/AppKit and therefore can only be built on
/// macOS with Xcode — it is not buildable in this repository's Linux CI/dev
/// environment. `AIMACore` (models, networking, view models) is the part of
/// this app that's cross-platform and Linux-testable; see its own
/// `Package.swift`.
let package = Package(
    name: "AIMA",
    platforms: [
        .macOS(.v14),
    ],
    dependencies: [
        .package(path: "../Shared/AIMACore"),
    ],
    targets: [
        .executableTarget(
            name: "AIMA",
            dependencies: [
                .product(name: "AIMACore", package: "AIMACore"),
            ],
            path: "Sources/AIMA"
        ),
    ]
)
