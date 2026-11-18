// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "powersync-swift6",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SyncCheck", targets: ["SyncCheck"]),
        .library(name: "SyncCheckMainActor", targets: ["SyncCheckMainActor"]),
    ],
    dependencies: [
        .package(url: "https://github.com/powersync-ja/powersync-swift.git", exact: "1.17.0"),
    ],
    targets: [
        .target(
            name: "SyncCheck",
            dependencies: [.product(name: "PowerSync", package: "powersync-swift")],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .target(
            name: "SyncCheckMainActor",
            dependencies: [.product(name: "PowerSync", package: "powersync-swift")],
            swiftSettings: [.swiftLanguageMode(.v6), .defaultIsolation(MainActor.self)]
        ),
    ]
)
