// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ProductComputerUse",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "action-driver-computer-use", targets: ["ComputerUseHelper"])],
    targets: [
        .target(name: "ComputerUseCore", resources: [.process("Resources")]),
        .executableTarget(name: "ComputerUseHelper", dependencies: ["ComputerUseCore"]),
        .testTarget(name: "ComputerUseCoreTests", dependencies: ["ComputerUseCore"])
    ]
)
