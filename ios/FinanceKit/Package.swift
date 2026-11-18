// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "FinanceKit",
    platforms: [.iOS("26.0"), .macOS("15.0")],
    products: [
        .library(name: "FinanceKit", targets: ["FinanceKit"]),
    ],
    targets: [
        .target(name: "FinanceKit"),
        .testTarget(name: "FinanceKitTests", dependencies: ["FinanceKit"]),
    ],
    swiftLanguageModes: [.v6]
)
