import Foundation

struct WindowCoordinates {
    let pid: Int32
    let windowID: Int
    let frame: CGRect
    let pixels: CGSize

    func point(x: Double, y: Double, foregroundPID: Int32?, windowID: Int, frame: CGRect) throws -> CGPoint {
        guard foregroundPID == pid else { throw ComputerUseError.backgroundInputUnsupported }
        guard windowID == self.windowID, frame == self.frame,
              pixels.width > 0, pixels.height > 0,
              x.isFinite, y.isFinite, x >= 0, y >= 0,
              x < pixels.width, y < pixels.height else { throw ComputerUseError.staleReference }
        return CGPoint(x: frame.minX + x * frame.width / pixels.width,
                       y: frame.minY + y * frame.height / pixels.height)
    }
}
