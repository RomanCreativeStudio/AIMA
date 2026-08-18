// swift-tools-version: 5.10
import PackageDescription

/// The iOS app (Alpha Launch sprint). Mirrors `apps/macos/Package.swift`
/// exactly — a thin SwiftUI presentation layer over `AIMACore`
/// (../Shared/AIMACore), no business logic of its own, matching every other
/// AIMA client's rule (docs/TECHNICAL_ARCHITECTURE.md §2). A plain
/// `swift-tools-version` executable target rather than an `.xcodeproj`, so
/// the project stays plain-text and diffable — open this folder's
/// `Package.swift` directly in Xcode ("File > Open...") to build, run, and
/// preview it; there is no `.xcodeproj`/`.xcworkspace` anywhere in this repo.
///
/// This target imports SwiftUI and therefore can only be built on macOS with
/// Xcode (targeting an iOS simulator or device) — it is not buildable in
/// this repository's Linux CI/dev environment. `AIMACore` (models,
/// networking, view models) is the part of this app that's cross-platform
/// and Linux-testable; see its own `Package.swift`.
///
/// `.iOS(.v17)` matches macOS's `.v14` choice: both are the OS versions that
/// ship `@Observable` (`Observation`), which every `AIMACore` view model
/// already depends on.
let package = Package(
    name: "AIMA",
    platforms: [
        .iOS(.v17),
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
