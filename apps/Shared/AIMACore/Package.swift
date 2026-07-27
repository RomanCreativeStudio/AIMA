// swift-tools-version: 5.10
import PackageDescription

/// The platform-agnostic half of every AIMA client (Phase 2.1,
/// docs/decisions/0009-macos-experience-foundation.md): typed API models,
/// the networking layer, and view models. Deliberately has no dependency on
/// SwiftUI/AppKit/UIKit — everything here is plain Swift + Foundation, so it
/// builds and tests the same way on macOS, iOS, tvOS, or (for CI/dev-machine
/// verification without Xcode) Linux. `apps/macos/`, and later `apps/ios/`
/// and `apps/tvos/`, each depend on this package and add only their own
/// platform-specific SwiftUI views and app entry point.
let package = Package(
    name: "AIMACore",
    platforms: [
        // Minimum versions with Observation framework support (`@Observable`) -
        // used by every view model here instead of Combine's `ObservableObject`,
        // since Combine has no Linux implementation and this package must build
        // and test on Linux (see Package.swift's doc comment above).
        .macOS(.v14),
        .iOS(.v17),
        .tvOS(.v17),
    ],
    products: [
        .library(name: "AIMACore", targets: ["AIMACore"]),
    ],
    targets: [
        .target(
            name: "AIMACore",
            path: "Sources/AIMACore"
        ),
        .testTarget(
            name: "AIMACoreTests",
            dependencies: ["AIMACore"],
            path: "Tests/AIMACoreTests"
        ),
    ]
)
