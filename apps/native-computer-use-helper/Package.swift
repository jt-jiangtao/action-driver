// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ActionDriverComputerUse",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "actiondriver-computer-use", targets: ["ComputerUseHelper"])],
    targets: [
        .target(name: "ComputerUseCore"),
        .executableTarget(name: "ComputerUseHelper", dependencies: ["ComputerUseCore"]),
        .testTarget(name: "ComputerUseCoreTests", dependencies: ["ComputerUseCore"])
    ]
)
