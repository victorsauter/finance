# powersync-swift6 spike

Compile-level check: can the PowerSync Swift SDK (`powersync-swift` 1.17.0, commit
`04a26e6388ca60ba4105573ac0cf2f087f6c142d`) be used from Swift 6 language mode with strict
concurrency? No server, no sign-in, nothing is run.

Two targets contain the same code (schema, database, connector conformers as class / actor /
`@MainActor`, `watch` consumed from a `@MainActor @Observable` store, sync status, database held in an
actor and used from detached tasks):

- `SyncCheck`: Swift 6 mode, default nonisolated isolation.
- `SyncCheckMainActor`: Swift 6 mode + `.defaultIsolation(MainActor.self)`.

## Run

    swift build
    xcodebuild -scheme SyncCheck -destination 'generic/platform=iOS' build
    xcodebuild -scheme SyncCheckMainActor -destination 'generic/platform=iOS Simulator' build

## Result (Xcode 26.3, Swift 6.2.4)

Passes cleanly: zero concurrency errors or warnings, no workaround needed (no `@unchecked Sendable`,
`@preconcurrency`, `nonisolated`, `sending`) on macOS, iOS device and iOS Simulator, in both targets.
The SDK's own package builds as Swift 6 (tools 6.1). It downloads one 140 MB binary
xcframework (`powersync-sqlite-core` 0.5.4).
